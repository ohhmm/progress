import { childKind, parentKind } from "./hierarchy.js";
import { compareRank, isRank, rankBetween, rankOf } from "./rank.js";

const STORAGE_KEY = "taskflow:v1";
const STATUSES = [
  { id: "backlog", label: "Backlog", short: "Plan" },
  { id: "doing", label: "Doing", short: "Active" },
  { id: "done", label: "Done", short: "Closed" }
];

const ITEM_LABELS = { idea: "Idea", goal: "Goal", task: "Task" };
let categories = [
  { id: "idea", name: "Ideas" }, { id: "goal", name: "Goals" }, { id: "task", name: "Tasks" }
];
const CATEGORY_SETTINGS_KEY = "taskflow:category-order";
const sections = new Map();
const selectedParents = new Map();

const state = {
  tasks: loadTasks(),
  selectedTaskId: null,
  editorKind: "task"
};

const elements = {};
let draggedItem;

function initElements() {
  Object.assign(elements, {
    taskDialog: document.getElementById("task-dialog"),
    taskForm: document.getElementById("task-form"),
    taskTitle: document.getElementById("task-title"),
    taskNotes: document.getElementById("task-notes"),
    taskTag: document.getElementById("task-tag"),
    taskPriority: document.getElementById("task-priority"),
    taskDue: document.getElementById("task-due"),
    taskStatus: document.getElementById("task-status"),
    taskParent: document.getElementById("task-parent"),
    taskParentLabel: document.getElementById("task-parent-label"),
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
    ...(kindOf(task) !== "task" && { kind: task.kind }),
    ...(isRank(task.rank) && { rank: task.rank }),
    ...(parentKind(kindOf(task)) && typeof task.parentId === "string" && { parentId: task.parentId }),
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

function searchWeight(task, term) {
  if (!term) return true;
  return [task.title, task.notes, task.tag, task.status].join(" ").toLowerCase().includes(term);
}

function kindOf(item) {
  return typeof item.kind === "string" ? item.kind : "task";
}

function itemLabel(kind) {
  return Object.hasOwn(ITEM_LABELS, kind) ? ITEM_LABELS[kind] : "Item";
}

function filteredTasks(items, { search, priorityFilter, sort }) {
  const term = search.value.trim().toLowerCase();
  const priority = priorityFilter.value;
  const tasks = items.filter((task) =>
    (priority === "all" || task.priority === priority) && searchWeight(task, term));

  const compare = {
    manual: compareRank,
    due: (a, b) => dueWeight(a) - dueWeight(b),
    priority: (a, b) => priorityWeight(a.priority) - priorityWeight(b.priority),
    created: (a, b) => b.created - a.created
  }[sort.value] || (() => 0);

  return tasks.sort((a, b) => compare(a, b) || a.title.localeCompare(b.title));
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

function selectedParent(kind) {
  const id = selectedParents.get(kind);
  if (!id) return null;
  const parent = state.tasks.find((item) => item.id === id && kindOf(item) === parentKind(kind));
  if (!parent) selectedParents.delete(kind);
  return parent;
}

function inScope(item, kind, parent) {
  return kindOf(item) === kind && (!parent || item.parentId === parent.id);
}

function selectItem(item) {
  const kind = childKind(kindOf(item));
  const section = sections.get(kind);
  if (!section) return;
  if (kind === "goal") {
    selectedParents.delete("task");
    if (sections.has("task")) sections.get("task").root.open = false;
  }
  selectedParents.set(kind, item.id);
  section.root.open = true;
  render();
  section.scopeTitle.focus({ preventScroll: true });
  section.root.scrollIntoView({ block: "nearest" });
}

function render() {
  for (const [kind, section] of sections) {
    const parent = selectedParent(kind);
    section.scope.hidden = !parent;
    section.scopeTitle.textContent = parent ? `${itemLabel(kindOf(parent))}: ${parent.title}` : "";
    const items = state.tasks.filter((item) => inScope(item, kind, parent));
    const total = items.length;
    const done = items.filter((item) => item.status === "done").length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    section.totalCount.textContent = total;
    section.doneCount.textContent = done;
    section.activeCount.textContent = total - done;
    section.progressBar.style.width = percent + "%";
    section.progressText.textContent = percent + "% complete";
    renderBoard(section.board, filteredTasks(items, section), kind);
  }
  saveTasks();
}

function renderBoard(board, items, kind) {
  for (const column of board.children) {
    const status = column.dataset.status;
    const cards = items.filter((item) => item.status === status);
    const body = column.querySelector(".column-body");
    column.querySelector(".count").textContent = cards.length;
    body.textContent = "";
    if (cards.length) {
      for (const item of cards) body.appendChild(card(item));
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = `No ${status} ${itemLabel(kind).toLowerCase()}s`;
      body.appendChild(empty);
    }
  }
}

function card(task) {
  const article = document.createElement("article");
  article.className = "card";
  article.draggable = true;
  article.dataset.id = task.id;
  article.setAttribute("tabindex", "0");

  const header = document.createElement("div");
  header.className = "card-header";

  const title = document.createElement("h3");
  if (sections.has(childKind(kindOf(task)))) {
    const select = document.createElement("button");
    select.type = "button";
    select.className = "card-title-button";
    select.textContent = task.title;
    select.addEventListener("click", () => selectItem(task));
    article.addEventListener("click", (event) => {
      if (!event.target.closest("button, select, input, a")) selectItem(task);
    });
    title.appendChild(select);
  } else {
    title.textContent = task.title;
  }
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
    draggedItem = task;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    article.classList.add("dragging");
  });
  article.addEventListener("dragend", () => {
    draggedItem = null;
    clearDropMarker();
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
  state.editorKind = task ? kindOf(task) : kind;
  elements.dialogTitle.textContent = (task ? "Edit " : "New ") + itemLabel(state.editorKind).toLowerCase();
  elements.taskTitle.value = task ? task.title : "";
  elements.taskNotes.value = task ? task.notes : "";
  elements.taskTag.value = task ? task.tag : "";
  elements.taskPriority.value = task ? task.priority : "medium";
  elements.taskDue.value = task ? task.due : "";
  elements.taskStatus.value = task ? task.status : initialStatus;
  const parentType = parentKind(state.editorKind);
  elements.taskParentLabel.parentElement.hidden = !sections.has(parentType);
  elements.taskParentLabel.textContent = itemLabel(parentType);
  const parents = state.tasks.filter((item) => kindOf(item) === parentType)
    .sort((a, b) => a.title.localeCompare(b.title));
  elements.taskParent.replaceChildren(new Option("Unlinked", ""), ...parents.map((item) => new Option(item.title, item.id)));
  const parentId = task ? task.parentId : selectedParent(state.editorKind)?.id;
  elements.taskParent.value = parents.some((item) => item.id === parentId) ? parentId : "";
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
  const label = itemLabel(kind);
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
    status: elements.taskStatus.value,
    ...(parentKind(kind) && { parentId: elements.taskParent.value })
  };

  if (state.selectedTaskId) {
    const task = state.tasks.find((item) => item.id === state.selectedTaskId);
    if (task) {
      Object.assign(task, patch, { completedAt: patch.status === "done" ? (task.completedAt || Date.now()) : null });
      showMessage(`${label} updated`);
    }
  } else {
    const first = columnItems(kind, patch.status)[0];
    const rank = rankBetween(null, first ? rankOf(first) : null);
    state.tasks.unshift(normalizeTask({ ...patch, kind, rank, id: uid(), created: Date.now(), completedAt: patch.status === "done" ? Date.now() : null }));
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
  elements.deleteDialog.querySelector("h2").textContent = `Delete ${itemLabel(kindOf(task)).toLowerCase()}?`;
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
  if (deleted) showMessage(`${itemLabel(kindOf(deleted))} deleted`);
  render();
}

function openImportDialog(kind, exporting) {
  const parent = selectedParent(kind);
  elements.importDialog.dataset.kind = kind;
  elements.importDialog.dataset.parentId = parent?.id ?? "";
  elements.importText.value = exporting
    ? JSON.stringify(state.tasks.filter((item) => inScope(item, kind, parent)), null, 2)
    : "";
  elements.importDialog.querySelector("h2").textContent = `Import/export ${sections.get(kind).name}`;
  elements.importDialog.showModal();
  if (exporting) elements.importText.select();
}

function importTasks(kind) {
  let parsed;
  try {
    parsed = JSON.parse(elements.importText.value);
  } catch (_error) {
    showMessage("Invalid JSON", "error");
    return;
  }
  if (!Array.isArray(parsed)) {
    showMessage("JSON must be an array of items", "error");
    return;
  }
  const parentId = elements.importDialog.dataset.parentId;
  const parent = parentId ? selectedParent(kind) : null;
  if (parentId && parent?.id !== parentId) {
    showMessage("The parent selection changed. Reopen the import dialog.", "error");
    return;
  }
  const others = state.tasks.filter((item) => !inScope(item, kind, parent));
  const usedIds = new Set(others.map((item) => item.id));
  const items = [];
  for (const item of parsed) {
    if (isValidTask(item) && kindOf(item) === kind && !usedIds.has(item.id)) {
      usedIds.add(item.id);
      items.push(normalizeTask(parent ? { ...item, parentId: parent.id } : item));
    }
  }
  if (parsed.length && !items.length) {
    showMessage("No importable items for this category", "error");
    return;
  }
  state.tasks = [...others, ...items];
  saveTasks();
  elements.importDialog.close();
  showMessage(`Imported ${items.length} items`);
  render();
}

function clearDone(kind) {
  const before = state.tasks.length;
  const parent = selectedParent(kind);
  state.tasks = state.tasks.filter((item) => item.status !== "done" || !inScope(item, kind, parent));
  saveTasks();
  showMessage(`Removed ${before - state.tasks.length} completed items`);
  render();
}

function setupSection(kind, name) {
  const label = itemLabel(kind);
  const template = document.getElementById("kanban-section");
  const root = template.content.firstElementChild.cloneNode(true);
  root.id = kind + "-management";
  root.dataset.kind = kind;
  root.querySelector("summary").textContent = name;
  const control = (name) => root.querySelector(`[data-control="${name}"]`);
  const section = {
    name,
    root,
    scope: root.querySelector(".parent-scope"),
    scopeTitle: root.querySelector(".parent-scope-title"),
    board: control("board"),
    search: control("search"),
    priorityFilter: control("priority-filter"),
    sort: control("sort"),
    totalCount: control("total-count"),
    activeCount: control("active-count"),
    doneCount: control("done-count"),
    progressBar: control("progress-bar"),
    progressText: control("progress-text")
  };
  sections.set(kind, section);
  const clearScope = section.scope.querySelector("button");
  clearScope.textContent = "Show all " + name.toLowerCase();
  clearScope.addEventListener("click", () => {
    selectedParents.delete(kind);
    if (kind === "goal") selectedParents.delete("task");
    render();
    root.querySelector("summary").focus();
  });

  const create = control("new-task");
  create.textContent = "New " + label.toLowerCase();
  create.addEventListener("click", () => openEditor(null, "backlog", kind));
  section.board.setAttribute("aria-label", name + " board");
  section.search.placeholder = `Search ${name.toLowerCase()} (/)`;
  section.search.setAttribute("aria-label", `Search ${name.toLowerCase()}`);
  section.sort.setAttribute("aria-label", `Sort ${name.toLowerCase()}`);
  control("progress-label").textContent = (label === "Item" ? name : label) + " progress";
  control("export-data").addEventListener("click", () => openImportDialog(kind, true));
  control("import-data").addEventListener("click", () => openImportDialog(kind, false));
  control("clear-done").addEventListener("click", () => clearDone(kind));
  section.search.addEventListener("input", render);
  section.priorityFilter.addEventListener("change", render);
  section.sort.addEventListener("change", render);
  setupBoard(section.board, kind);
}

function loadCategorySettings() {
  try {
    const saved = JSON.parse(safeStorage()?.getItem(CATEGORY_SETTINGS_KEY) ?? "null");
    const order = Array.isArray(saved) ? saved : saved?.order;
    const colors = Object.fromEntries(Object.entries(saved?.colors ?? {}).filter(([, color]) =>
      typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)));
    return { order: Array.isArray(order) ? order : [], colors };
  } catch (_error) {
    return { order: [], colors: {} };
  }
}

function activeOrder(order) {
  const active = categories.map(({ id }) => id);
  return [...new Set([...order.filter((id) => active.includes(id)), ...active])];
}

function applyCategorySettings({ order, colors }, reorder) {
  const container = document.getElementById("board-sections");
  for (const [index, kind] of activeOrder(order).entries()) {
    const { root } = sections.get(kind);
    root.style.setProperty("--category-background", colors[kind] || "");
    if (reorder) {
      root.open = index === 0;
      container.appendChild(root);
    }
  }
}

async function changeCategory(change, status) {
  status.hidden = false;
  status.textContent = "Saving…";
  try {
    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      status.textContent = response.status < 500 ? await response.text() : "Could not save the category. Try again.";
      return false;
    }
    status.hidden = true;
    TaskSync.refresh();
    return true;
  } catch (_error) {
    status.textContent = "Could not save the category. Try again.";
    return false;
  }
}

function setupCategorySettings() {
  const dialog = document.getElementById("category-dialog");
  const form = document.getElementById("category-form");
  const list = document.getElementById("category-order");
  const newName = document.getElementById("new-category-name");
  const add = document.getElementById("add-category");
  const status = document.getElementById("category-status");
  const deleteDialog = document.getElementById("category-delete-dialog");
  const deleteForm = document.getElementById("category-delete-form");
  const destination = document.getElementById("category-destination");
  const deleteStatus = document.getElementById("category-delete-status");
  let deleting;
  let settings = loadCategorySettings();
  let draft;
  applyCategorySettings(settings, true);

  function renderSettings() {
    list.textContent = "";
    for (const [index, kind] of draft.order.entries()) {
      const label = sections.get(kind).name;
      const item = document.createElement("li");
      item.tabIndex = -1;
      const row = document.createElement("div");
      row.className = "category-order-row";
      const name = document.createElement("span");
      name.textContent = label;
      const actions = document.createElement("div");
      actions.className = "category-order-actions";
      for (const [text, offset] of [["Up", -1], ["Down", 1]]) {
        const next = index + offset;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.setAttribute("aria-label", `Move ${label} ${text.toLowerCase()}`);
        button.disabled = next < 0 || next >= draft.order.length;
        button.addEventListener("click", () => {
          [draft.order[index], draft.order[next]] = [draft.order[next], draft.order[index]];
          renderSettings();
          list.children[next].focus();
        });
        actions.appendChild(button);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", "Delete " + label + " category");
      remove.disabled = categories.length < 2;
      remove.addEventListener("click", () => {
        deleting = kind;
        document.getElementById("category-delete-title").textContent = `Delete ${label}?`;
        deleteStatus.hidden = true;
        destination.replaceChildren(...categories.filter(({ id }) => id !== kind)
          .map(({ id, name }) => new Option(name, id)));
        if (sections.has("task") && kind !== "task") destination.value = "task";
        deleteDialog.showModal();
      });
      actions.appendChild(remove);
      row.append(name, actions);
      const colorRow = document.createElement("div");
      colorRow.className = "category-color";
      const color = document.createElement("input");
      color.type = "color";
      color.value = draft.colors[kind] || "#808080";
      color.setAttribute("aria-label", label + " background color");
      const reset = document.createElement("button");
      reset.type = "button";
      reset.textContent = "Reset background";
      reset.setAttribute("aria-label", "Reset " + label + " background");
      reset.disabled = !draft.colors[kind];
      color.addEventListener("input", () => {
        draft.colors[kind] = color.value;
        reset.disabled = false;
      });
      reset.addEventListener("click", () => {
        delete draft.colors[kind];
        color.value = "#808080";
        reset.disabled = true;
        color.focus();
      });
      colorRow.append(color, reset);
      item.append(row, colorRow);
      list.appendChild(item);
    }
  }

  document.getElementById("edit-category-order").addEventListener("click", () => {
    draft = { order: activeOrder(settings.order), colors: { ...settings.colors } };
    newName.value = "";
    status.hidden = true;
    renderSettings();
    dialog.showModal();
  });
  document.getElementById("cancel-category-order").addEventListener("click", () => dialog.close());
  add.addEventListener("click", async () => {
    const name = newName.value.trim();
    if (!name) {
      status.textContent = "Enter a category name.";
      status.hidden = false;
      newName.focus();
      return;
    }
    add.disabled = true;
    const saved = await changeCategory({ type: "create", id: "category-" + crypto.randomUUID(), name }, status);
    add.disabled = false;
    if (saved) newName.value = "";
  });
  newName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add.click();
    }
  });
  document.getElementById("cancel-category-delete").addEventListener("click", () => deleteDialog.close());
  deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = deleteForm.querySelector('[type="submit"]');
    button.disabled = true;
    const saved = await changeCategory({ type: "delete", id: deleting, destination: destination.value }, deleteStatus);
    button.disabled = false;
    if (saved) deleteDialog.close();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const reordered = activeOrder(settings.order).some((kind, index) => kind !== draft.order[index]);
    settings = draft;
    applyCategorySettings(settings, reordered);
    dialog.close();
    try {
      const storage = safeStorage();
      if (storage) {
        storage.setItem(CATEGORY_SETTINGS_KEY, JSON.stringify(settings));
        return;
      }
    } catch (_error) {
      // The edited settings are still active on the current page.
    }
    showMessage("Category settings could only be saved for this page.", "error");
  });
  return () => {
    applyCategorySettings(settings, true);
    if (dialog.open) {
      draft.order = activeOrder(draft.order);
      renderSettings();
    }
  };
}

function columnItems(kind, status) {
  return state.tasks.filter((item) => kindOf(item) === kind && item.status === status).sort(compareRank);
}

function clearDropMarker() {
  document.querySelector(".drop-target")?.classList.remove("drop-target");
  document.querySelector(".drop-before")?.classList.remove("drop-before");
  document.querySelector(".drop-after")?.classList.remove("drop-after");
}

function dropPosition(column, y, id) {
  const cards = [...column.querySelectorAll(".card")].filter((card) => card.dataset.id !== id);
  const before = cards.find((card) => {
    const bounds = card.getBoundingClientRect();
    return y < bounds.top + bounds.height / 2;
  });
  return { before, last: cards.at(-1) };
}

function setupBoard(board, kind) {
  const template = document.getElementById("kanban-column");
  for (const { id: status, label } of STATUSES) {
    const column = template.content.firstElementChild.cloneNode(true);
    column.dataset.status = status;
    column.setAttribute("aria-label", label);
    column.querySelector(".column-title").textContent = label;
    column.querySelector(".count").dataset.count = status;
    const add = column.querySelector("button");
    add.dataset.newStatus = status;
    add.setAttribute("aria-label", `Add ${itemLabel(kind).toLowerCase()} to ${label}`);
    add.addEventListener("click", () => openEditor(null, status, kind));

    column.addEventListener("dragover", (event) => {
      if (!draggedItem || kindOf(draggedItem) !== kind) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const { before, last } = dropPosition(column, event.clientY, draggedItem.id);
      clearDropMarker();
      column.classList.add("drop-target");
      if (before) before.classList.add("drop-before");
      else last?.classList.add("drop-after");
    });
    column.addEventListener("dragleave", (event) => {
      if (!column.contains(event.relatedTarget)) clearDropMarker();
    });
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      clearDropMarker();
      const id = event.dataTransfer.getData("text/plain");
      const item = draggedItem?.id === id && state.tasks.find((entry) => entry.id === id);
      draggedItem = null;
      if (!item || kindOf(item) !== kind) return;
      const { before, last } = dropPosition(column, event.clientY, item.id);
      const items = columnItems(kind, status);
      const ordered = items.filter((entry) => entry.id !== item.id);
      const anchor = before ?? last;
      const index = anchor
        ? ordered.findIndex((entry) => entry.id === anchor.dataset.id) + (before ? 0 : 1)
        : ordered.length;
      sections.get(kind).sort.value = "manual";
      if (item.status === status && items[index]?.id === item.id) {
        render();
        return;
      }
      const lower = ordered[index - 1];
      const upper = ordered[index];
      const rank = rankBetween(lower ? rankOf(lower) : null, upper ? rankOf(upper) : null);
      updateTask(item.id, {
        rank,
        status,
        completedAt: status === "done" ? (item.completedAt ?? Date.now()) : null
      });
    });
    board.appendChild(column);
  }
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
    if (typing || document.querySelector("dialog[open]")) return;
    const kind = event.target.closest(".board-section")?.dataset.kind || (sections.has("task") ? "task" : categories[0].id);
    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      openEditor(null, "backlog", kind);
    }
    if (event.key === "/") {
      event.preventDefault();
      const section = sections.get(kind);
      section.root.open = true;
      section.search.focus();
    }
  });
}

function setupEvents() {
  for (const { id, name } of categories) setupSection(id, name);
  elements.importSubmit.addEventListener("click", () => importTasks(elements.importDialog.dataset.kind));

  document.getElementById("cancel-task").addEventListener("click", closeEditor);
  document.getElementById("close-import").addEventListener("click", () => elements.importDialog.close());
  document.getElementById("cancel-delete").addEventListener("click", () => elements.deleteDialog.close());

  elements.taskForm.addEventListener("submit", upsertTask);
  elements.taskDialog.addEventListener("close", () => {
    state.selectedTaskId = null;
  });
  elements.deleteConfirm.addEventListener("click", deleteTask);
  setupKeyboard();
}

function initApp() {
  initElements();
  setupEvents();
  const reorder = setupCategorySettings();
  render();

  TaskSync.start(state.tasks, (tasks, incoming, changed) => {
    const categoriesChanged = JSON.stringify(categories) !== JSON.stringify(incoming);
    if (categoriesChanged) {
      categories = incoming;
      for (const [id, section] of sections) {
        if (!categories.some((category) => category.id === id)) {
          section.root.remove();
          sections.delete(id);
        }
      }
      for (const { id, name } of categories) {
        if (!sections.has(id)) setupSection(id, name);
      }
      reorder();
    }
    if (changed || categoriesChanged) {
      state.tasks = tasks.filter(isValidTask).map(normalizeTask);
      render();
    }
  }, document.getElementById("sync-status"), true);

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
