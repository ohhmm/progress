"use strict";

const STORAGE_KEY = "taskflow:v1";
const STATUSES = [
  { id: "backlog", label: "Backlog", short: "Plan" },
  { id: "doing", label: "Doing", short: "Active" },
  { id: "done", label: "Done", short: "Closed" }
];

const state = {
  tasks: loadTasks(),
  query: "",
  priorityFilter: "all",
  sort: "manual",
  selectedTaskId: null,
  editorKind: "task",
  importOpen: false
};

const elements = {};

function initElements() {
  Object.assign(elements, {
    taskManagement: document.getElementById("task-management"),
    goalList: document.getElementById("goal-list"),
    board: document.getElementById("board"),
    search: document.getElementById("search"),
    priorityFilter: document.getElementById("priority-filter"),
    sort: document.getElementById("sort"),
    stats: document.getElementById("stats"),
    totalCount: document.getElementById("total-count"),
    doneCount: document.getElementById("done-count"),
    activeCount: document.getElementById("active-count"),
    progressBar: document.getElementById("progress-bar"),
    progressText: document.getElementById("progress-text"),
    newTaskButton: document.getElementById("new-task"),
    importButton: document.getElementById("import-data"),
    exportButton: document.getElementById("export-data"),
    clearButton: document.getElementById("clear-done"),
    taskDialog: document.getElementById("task-dialog"),
    taskForm: document.getElementById("task-form"),
    taskTitle: document.getElementById("task-title"),
    taskNotes: document.getElementById("task-notes"),
    taskTag: document.getElementById("task-tag"),
    taskPriority: document.getElementById("task-priority"),
    taskDue: document.getElementById("task-due"),
    taskStatus: document.getElementById("task-status"),
    dialogTitle: document.getElementById("dialog-title"),
    importDialog: document.getElementById("import-dialog"),
    importText: document.getElementById("import-text"),
    importSubmit: document.getElementById("import-submit"),
    deleteDialog: document.getElementById("delete-dialog"),
    deleteName: document.getElementById("delete-name"),
    deleteConfirm: document.getElementById("delete-confirm"),
    message: document.getElementById("message")
  });
}

function storageAvailable(storage) {
  if (!storage) return false;
  try {
    const key = "__taskflow_storage_test__";
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch (_error) {
    return false;
  }
}

function primaryStorage() {
  try {
    if (storageAvailable(window.localStorage)) return window.localStorage;
  } catch (_error) {
    // Ignore and try the next option.
  }
  try {
    if (storageAvailable(window.sessionStorage)) return window.sessionStorage;
  } catch (_error) {
    // Ignore and fall through.
  }
  return null;
}

function fallbackStorage() {
  try {
    if (primaryStorage() === window.localStorage && storageAvailable(window.sessionStorage)) {
      return window.sessionStorage;
    }
  } catch (_error) {
    // Ignore and fall through.
  }
  return null;
}

function safeStorage() {
  return primaryStorage();
}

function loadTasks() {
  const storages = [primaryStorage(), fallbackStorage()].filter(Boolean);
  for (const storage of storages) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isValidTask).map(normalizeTask);
      }
    } catch (_error) {
      // Try the next available storage.
    }
  }
  return [];
}

function saveTasks() {
  if (typeof TaskSync !== "undefined") TaskSync.save(state.tasks);
  const storages = [primaryStorage(), fallbackStorage()].filter(Boolean);
  if (storages.length === 0) return;
  const data = JSON.stringify(state.tasks);
  let saved = false;
  let lastError = null;
  for (const storage of storages) {
    try {
      storage.setItem(STORAGE_KEY, data);
      saved = true;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!saved && lastError && typeof showMessage === "function" && elements && elements.message) {
    showMessage("Could not save locally: " + lastError.message, "error");
  }
}

function isValidTask(task) {
  return task && typeof task === "object" && typeof task.id === "string" && typeof task.title === "string";
}

function normalizeTask(task) {
  const status = STATUSES.some((item) => item.id === task.status) ? task.status : "backlog";
  const priority = ["high", "medium", "low"].includes(task.priority) ? task.priority : "medium";
  return {
    ...(task.kind === "goal" && { kind: "goal" }),
    id: task.id,
    title: task.title.trim().slice(0, 120),
    notes: String(task.notes || "").slice(0, 1000),
    tag: String(task.tag || "").trim().slice(0, 32),
    priority,
    due: isDate(task.due) ? task.due : "",
    status,
    created: Number.isFinite(task.created) ? task.created : Date.now(),
    completedAt: Number.isFinite(task.completedAt) ? task.completedAt : null
  };
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function uid() {
  return "t-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function priorityWeight(priority) {
  return priority === "high" ? 0 : priority === "medium" ? 1 : 2;
}

function dueWeight(task) {
  if (!task.due) return Number.MAX_SAFE_INTEGER;
  const time = Date.parse(task.due + "T00:00:00");
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function searchWeight(task) {
  const term = state.query.trim().toLowerCase();
  if (!term) return true;
  return [task.title, task.notes, task.tag, task.status].join(" ").toLowerCase().includes(term);
}

function isGoal(item) {
  return item.kind === "goal";
}

function filteredTasks() {
  let tasks = state.tasks.filter((task) => {
    const matchesPriority = state.priorityFilter === "all" || task.priority === state.priorityFilter;
    return !isGoal(task) && matchesPriority && searchWeight(task);
  });

  const compare = {
    manual: () => 0,
    due: (a, b) => dueWeight(a) - dueWeight(b),
    priority: (a, b) => priorityWeight(a.priority) - priorityWeight(b.priority),
    created: (a, b) => b.created - a.created
  }[state.sort] || (() => 0);

  if (state.sort !== "manual") {
    tasks = [...tasks].sort((a, b) => {
      const result = compare(a, b);
      if (result !== 0) return result;
      return a.title.localeCompare(b.title);
    });
  }

  return tasks;
}

function statusColor(status) {
  return status === "backlog" ? "var(--status-planned)" :
    status === "doing" ? "var(--status-active)" : "var(--status-done)";
}

function showMessage(text, type = "info") {
  elements.message.textContent = text;
  elements.message.dataset.type = type;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    elements.message.textContent = "";
    delete elements.message.dataset.type;
  }, 2600);
}

function render() {
  const tasks = filteredTasks();
  const goals = state.tasks.filter(isGoal);
  elements.goalList.textContent = "";
  for (const goal of goals) elements.goalList.appendChild(card(goal));
  if (!goals.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No goals yet";
    elements.goalList.appendChild(empty);
  }
  const allTasks = state.tasks.filter((item) => !isGoal(item));
  const total = allTasks.length;
  const done = allTasks.filter((task) => task.status === "done").length;
  const active = total - done;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  elements.totalCount.textContent = total;
  elements.doneCount.textContent = done;
  elements.activeCount.textContent = active;
  elements.progressBar.style.width = percent + "%";
  elements.progressText.textContent = percent + "% complete";

  elements.board.querySelectorAll(".column-body").forEach((body) => {
    body.innerHTML = "";
  });

  STATUSES.forEach((status) => {
    const column = document.querySelector(`[data-status="${status.id}"] .column-body`);
    const tasksForStatus = tasks.filter((task) => task.status === status.id);
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = tasksForStatus.length ? "" : `No ${status.label.toLowerCase()} tasks`;
    if (tasksForStatus.length) empty.hidden = true;
    column.appendChild(empty);

    tasksForStatus.forEach((task) => {
      column.appendChild(card(task));
    });
  });

  refreshCounts(tasks);
  saveTasks();
}

function card(task) {
  const article = document.createElement("article");
  article.className = "card";
  article.draggable = !isGoal(task);
  article.dataset.id = task.id;
  article.setAttribute("tabindex", "0");

  const header = document.createElement("div");
  header.className = "card-header";

  const title = document.createElement("h3");
  title.textContent = task.title;
  header.appendChild(title);

  const priority = document.createElement("span");
  priority.className = `priority priority-${task.priority}`;
  priority.textContent = task.priority;
  header.appendChild(priority);

  article.appendChild(header);

  if (task.notes) {
    const notes = document.createElement("p");
    notes.className = "card-notes";
    notes.textContent = task.notes;
    article.appendChild(notes);
  }

  const meta = document.createElement("div");
  meta.className = "card-meta";

  if (task.tag) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = task.tag;
    meta.appendChild(tag);
  }

  if (task.due) {
    const due = document.createElement("span");
    due.className = "due" + (isOverdue(task) ? " overdue" : "");
    due.textContent = `Due ${formatDate(task.due)}`;
    meta.appendChild(due);
  }

  article.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const statusSelect = document.createElement("select");
  statusSelect.className = "status-select";
  statusSelect.setAttribute("aria-label", "Change status");
  STATUSES.forEach((status) => {
    const option = document.createElement("option");
    option.value = status.id;
    option.textContent = status.label;
    option.selected = status.id === task.status;
    statusSelect.appendChild(option);
  });
  statusSelect.addEventListener("change", (event) => {
    updateTask(task.id, { status: event.target.value, completedAt: event.target.value === "done" ? Date.now() : null });
  });
  actions.appendChild(statusSelect);

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "ghost";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => openEditor(task.id));
  actions.appendChild(editButton);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "ghost danger";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => confirmDelete(task.id));
  actions.appendChild(deleteButton);

  article.appendChild(actions);

  article.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", task.id);
    article.classList.add("dragging");
  });
  article.addEventListener("dragend", () => {
    article.classList.remove("dragging");
  });

  return article;
}

function isOverdue(task) {
  if (!task.due || task.status === "done") return false;
  return Date.parse(task.due + "T23:59:59") < Date.now();
}

function formatDate(value) {
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function openEditor(taskId = null, initialStatus = "backlog", kind = "task") {
  state.selectedTaskId = taskId;
  const task = taskId ? state.tasks.find((item) => item.id === taskId) : null;
  state.editorKind = task ? (isGoal(task) ? "goal" : "task") : kind;
  elements.dialogTitle.textContent = (task ? "Edit " : "New ") + state.editorKind;
  elements.taskTitle.value = task ? task.title : "";
  elements.taskNotes.value = task ? task.notes : "";
  elements.taskTag.value = task ? task.tag : "";
  elements.taskPriority.value = task ? task.priority : "medium";
  elements.taskDue.value = task ? task.due : "";
  elements.taskStatus.value = task ? task.status : initialStatus;
  elements.taskDialog.showModal();
  window.setTimeout(() => elements.taskTitle.focus(), 0);
}

function closeEditor() {
  elements.taskDialog.close();
  state.selectedTaskId = null;
}

function upsertTask(event) {
  event.preventDefault();
  const title = elements.taskTitle.value.trim();
  const kind = state.editorKind;
  const label = kind === "goal" ? "Goal" : "Task";
  if (!title) {
    showMessage(`${label} title is required`, "error");
    elements.taskTitle.focus();
    return;
  }

  const patch = {
    title,
    notes: elements.taskNotes.value.trim(),
    tag: elements.taskTag.value.trim(),
    priority: elements.taskPriority.value,
    due: elements.taskDue.value,
    status: elements.taskStatus.value
  };

  if (state.selectedTaskId) {
    const task = state.tasks.find((item) => item.id === state.selectedTaskId);
    if (task) {
      Object.assign(task, patch, { completedAt: patch.status === "done" ? (task.completedAt || Date.now()) : null });
      showMessage(`${label} updated`);
    }
  } else {
    state.tasks.unshift(normalizeTask({ ...patch, kind, id: uid(), created: Date.now(), completedAt: patch.status === "done" ? Date.now() : null }));
    showMessage(`${label} created`);
  }

  saveTasks();
  closeEditor();
  render();
}

function updateTask(id, patch) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  Object.assign(task, patch);
  saveTasks();
  render();
}

function confirmDelete(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  elements.deleteDialog.querySelector("h2").textContent = isGoal(task) ? "Delete goal" : "Delete task";
  elements.deleteName.textContent = task.title;
  elements.deleteConfirm.dataset.id = id;
  elements.deleteDialog.showModal();
}

function deleteTask() {
  const id = elements.deleteConfirm.dataset.id;
  const deleted = state.tasks.find((task) => task.id === id);
  state.tasks = state.tasks.filter((task) => task.id !== id);
  saveTasks();
  elements.deleteDialog.close();
  if (deleted) showMessage(isGoal(deleted) ? "Goal deleted" : "Task deleted");
  render();
}

function exportTasks() {
  elements.importText.value = JSON.stringify(state.tasks.filter((item) => !isGoal(item)), null, 2);
  elements.importDialog.showModal();
  elements.importText.select();
}

function importTasks() {
  let parsed;
  try {
    parsed = JSON.parse(elements.importText.value);
  } catch (_error) {
    showMessage("Invalid JSON", "error");
    return;
  }
  if (!Array.isArray(parsed)) {
    showMessage("JSON must be an array of tasks", "error");
    return;
  }
  const goals = state.tasks.filter(isGoal);
  const goalIds = new Set(goals.map((goal) => goal.id));
  const tasks = parsed.filter(isValidTask).filter((item) => !goalIds.has(item.id) && !isGoal(item)).map(normalizeTask);
  state.tasks = [...goals, ...tasks];
  saveTasks();
  elements.importDialog.close();
  showMessage(`Imported ${tasks.length} tasks`);
  render();
}

function clearDone() {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((task) => task.status !== "done" || isGoal(task));
  saveTasks();
  showMessage(`Removed ${before - state.tasks.length} completed tasks`);
  render();
}

function refreshCounts(tasks) {
  const counts = STATUSES.reduce((result, status) => {
    result[status.id] = tasks.filter((task) => task.status === status.id).length;
    return result;
  }, {});
  document.querySelectorAll("[data-count]").forEach((node) => {
    node.textContent = counts[node.dataset.count] || 0;
  });
}

function setupDragAndDrop() {
  document.querySelectorAll(".column").forEach((column) => {
    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      column.classList.add("drop-target");
    });
    column.addEventListener("dragleave", () => {
      column.classList.remove("drop-target");
    });
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      column.classList.remove("drop-target");
      const id = event.dataTransfer.getData("text/plain");
      const status = column.dataset.status;
      if (id && status) updateTask(id, { status, completedAt: status === "done" ? Date.now() : null });
    });
  });
}

function setupKeyboard() {
  document.addEventListener("keydown", (event) => {
    const tag = event.target && event.target.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target.isContentEditable;
    if (event.key === "Escape") {
      if (elements.taskDialog.open) closeEditor();
      if (elements.importDialog.open) elements.importDialog.close();
      if (elements.deleteDialog.open) elements.deleteDialog.close();
      return;
    }
    if (typing) return;
    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      openEditor();
    }
    if (event.key === "/") {
      event.preventDefault();
      elements.taskManagement.open = true;
      elements.search.focus();
    }
  });
}

function setupEvents() {
  document.getElementById("new-goal").addEventListener("click", () => openEditor(null, "backlog", "goal"));
  elements.newTaskButton.addEventListener("click", () => openEditor());
  elements.exportButton.addEventListener("click", exportTasks);
  elements.importButton.addEventListener("click", () => {
    elements.importText.value = "";
    elements.importDialog.showModal();
  });
  elements.importSubmit.addEventListener("click", (event) => {
    event.preventDefault();
    importTasks();
  });
  elements.clearButton.addEventListener("click", clearDone);

  document.getElementById("cancel-task").addEventListener("click", closeEditor);
  document.getElementById("close-import").addEventListener("click", () => elements.importDialog.close());
  document.getElementById("cancel-delete").addEventListener("click", () => elements.deleteDialog.close());

  document.querySelectorAll("[data-new-status]").forEach((button) => {
    button.addEventListener("click", () => openEditor(null, button.dataset.newStatus));
  });
  elements.taskForm.addEventListener("submit", upsertTask);
  elements.taskDialog.addEventListener("close", () => {
    state.selectedTaskId = null;
  });
  elements.deleteConfirm.addEventListener("click", deleteTask);
  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  elements.priorityFilter.addEventListener("change", (event) => {
    state.priorityFilter = event.target.value;
    render();
  });
  elements.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  setupDragAndDrop();
  setupKeyboard();
}

function initApp() {
  initElements();
  setupEvents();
  render();

  TaskSync.start(state.tasks, (tasks) => {
    state.tasks = tasks.filter(isValidTask).map(normalizeTask);
    render();
  }, document.getElementById("sync-status"));

  window.addEventListener("beforeunload", saveTasks);
  window.addEventListener("pagehide", saveTasks);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveTasks();
  });
}

if (document.readyState !== "loading") {
  initApp();
} else {
  document.addEventListener("DOMContentLoaded", initApp, { once: true });
}
