"use strict";

const TaskSync = (() => {
  const prefix = "taskflow:pending:";
  const migratedKey = "taskflow:shared:v1";
  let previous = [];
  let busy = false;
  let started = false;
  let storage;
  let status;
  let apply;
  let timer;
  let sequence = 0;

  function pending() {
    return Object.keys(storage).filter(key => key.startsWith(prefix)).sort()
      .map(key => ({ key, operation: JSON.parse(storage.getItem(key)) }));
  }

  function enqueue(type, taskId, patch) {
    const id = crypto.randomUUID();
    sequence = Math.max(Date.now() * 1000, sequence + 1);
    const key = prefix + sequence.toString().padStart(20, "0") + ":" + id;
    storage.setItem(key, JSON.stringify({ id, type, taskId, patch }));
  }

  function overlay(tasks, entries) {
    const byId = new Map(tasks.map(task => [task.id, task]));
    for (const { operation: op } of entries) {
      if (op.type === "delete") byId.delete(op.taskId);
      else if (op.type === "patch" && byId.has(op.taskId)) {
        byId.set(op.taskId, { ...byId.get(op.taskId), ...op.patch });
      } else if (["create", "seed"].includes(op.type) && !byId.has(op.taskId)) {
        byId.set(op.taskId, { ...op.patch, id: op.taskId });
      }
    }
    return [...byId.values()];
  }

  function remember(tasks) {
    previous = JSON.parse(JSON.stringify(tasks));
  }

  async function sync() {
    if (!started || busy) return;
    busy = true;
    clearTimeout(timer);
    try {
      const entries = pending().slice(0, 1000);
      status.textContent = entries.length ? "Saving…" : "Checking for updates…";
      const options = { cache: "no-store", signal: AbortSignal.timeout(15000) };
      if (entries.length) {
        options.method = "POST";
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(entries.map(entry => entry.operation));
      }
      const response = await fetch("/api/tasks", options);
      if (!response.ok) throw new Error("Sync failed");
      const tasks = await response.json();
      if (!Array.isArray(tasks)) throw new Error("Invalid board response");
      for (const entry of entries) storage.removeItem(entry.key);
      const remaining = pending();
      const merged = overlay(tasks, remaining);
      const changed = JSON.stringify(merged) !== JSON.stringify(previous);
      remember(merged);
      if (changed) apply(merged);
      status.textContent = remaining.length ? "Saving…" : "All changes saved";
      status.dataset.state = remaining.length ? "pending" : "saved";
    } catch (_error) {
      status.textContent = "Sync unavailable — retrying. Keep this browser’s data to preserve unsent changes.";
      status.dataset.state = "error";
    } finally {
      busy = false;
      timer = setTimeout(sync, 3000);
    }
  }

  return {
    start(tasks, onTasks, node) {
      status = node;
      apply = onTasks;
      remember(tasks);
      try {
        storage = window.localStorage;
        const probe = prefix + "probe";
        storage.setItem(probe, "1");
        storage.removeItem(probe);
        if (!storage.getItem(migratedKey)) {
          storage.setItem("taskflow:legacy:v1", JSON.stringify(tasks));
          for (const task of tasks) {
            const { id, ...patch } = task;
            enqueue("seed", id, patch);
          }
          storage.setItem(migratedKey, "1");
        }
        started = true;
        window.addEventListener("online", sync);
        window.addEventListener("focus", sync);
        window.addEventListener("storage", event => {
          if (event.key?.startsWith(prefix)) sync();
        });
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") sync();
        });
        sync();
      } catch (_error) {
        status.textContent = "Enable browser storage to save and sync changes.";
        status.dataset.state = "error";
      }
    },
    save(tasks) {
      if (!started) return;
      try {
        const old = new Map(previous.map(task => [task.id, task]));
        for (const task of tasks) {
          const before = old.get(task.id);
          const patch = Object.fromEntries(Object.entries(task).filter(([key, value]) =>
            key !== "id" && (!before || before[key] !== value)));
          if (!before || Object.keys(patch).length) enqueue(before ? "patch" : "create", task.id, patch);
          old.delete(task.id);
        }
        for (const id of old.keys()) enqueue("delete", id);
        remember(tasks);
        if (pending().length) {
          status.textContent = "Saving…";
          status.dataset.state = "pending";
          clearTimeout(timer);
          timer = setTimeout(sync, 0);
        }
      } catch (_error) {
        status.textContent = "Could not queue changes. Free browser storage and retry.";
        status.dataset.state = "error";
      }
    }
  };
})();
