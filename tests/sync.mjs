import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { test } from "node:test";

const base = process.env.BASE || "http://127.0.0.1:8787";
const authorization = "Basic " + Buffer.from("taskflow:" + (process.env.BOARD_PASSWORD || "local-sync-test")).toString("base64");
const source = readFileSync(new URL("../sync.js", import.meta.url), "utf8");
const task = (id = randomUUID()) => ({ id, title: "Sync regression", status: "backlog", priority: "medium", notes: "", tag: "", due: "", created: Date.now(), completedAt: null });
const operation = (type, taskId, patch) => ({ id: randomUUID(), type, taskId, patch: patch && Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "id")) });
async function api(operations) {
  const response = await fetch(base + "/api/tasks", operations ? {
    method: "POST", headers: { Authorization: authorization, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(operations)
  } : { headers: { Authorization: authorization } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}
function browser(initial = [], storage = {}) {
  if (!storage.getItem) Object.defineProperties(storage, {
    getItem: { value(key) { return this[key] ?? null; } },
    setItem: { value(key, value) { this[key] = String(value); } },
    removeItem: { value(key) { delete this[key]; } }
  });
  const events = {};
  const timers = new Map();
  const status = { textContent: "", dataset: {} };
  let tasks = structuredClone(initial);
  let offline = false;
  let timerId = 0;
  const context = vm.createContext({
    crypto: { randomUUID }, AbortSignal, console,
    window: { localStorage: storage, addEventListener(name, fn) { events[name] = fn; } },
    document: { visibilityState: "visible", addEventListener(name, fn) { events[name] = fn; } },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(path, options) {
      if (offline) throw new Error("offline");
      return fetch(base + path, { ...options, headers: { ...options.headers, Authorization: authorization, Origin: base } });
    }
  });
  vm.runInContext(source + "\nglobalThis.sync = TaskSync;", context);
  context.sync.start(initial, value => { tasks = JSON.parse(JSON.stringify(value)); }, status);
  return {
    storage, status, get tasks() { return tasks; },
    set offline(value) { offline = value; },
    save(value) { tasks = structuredClone(value); context.sync.save(tasks); },
    async settle() {
      const end = Date.now() + 10000;
      while (!timers.size && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(timers.size, status.textContent);
    },
    async refresh() {
      timers.clear();
      await events.focus();
      await this.settle();
    }
  };
}

test("task moves survive independent devices, refresh, offline reload, retries and deletes", async () => {
  const original = task();
  const a = browser([original]);
  await a.settle();
  const b = browser();
  await b.settle();
  assert.equal(b.tasks.find(t => t.id === original.id).status, "backlog");

  // Different fields edited from stale snapshots must both survive.
  a.save(a.tasks.map(t => t.id === original.id ? { ...t, status: "doing" } : t));
  b.save(b.tasks.map(t => t.id === original.id ? { ...t, notes: "Written on iPhone" } : t));
  await a.refresh();
  await b.refresh();
  await a.refresh();
  assert.equal(a.tasks.find(t => t.id === original.id).notes, "Written on iPhone");
  const reloaded = browser();
  await reloaded.settle();
  assert.equal(reloaded.tasks.find(t => t.id === original.id).status, "doing");

  a.offline = true;
  a.save(a.tasks.map(t => t.id === original.id ? { ...t, status: "done", completedAt: Date.now() } : t));
  await a.refresh();
  assert.equal(a.status.dataset.state, "error");
  assert.ok(Object.keys(a.storage).some(key => key.startsWith("taskflow:pending:")));
  const recovered = browser(a.tasks, a.storage);
  await recovered.settle();
  await b.refresh();
  assert.equal(b.tasks.find(t => t.id === original.id).status, "done");
  assert.equal(recovered.status.textContent, "All changes saved");

  // A stale legacy browser and retried writes must preserve server deletions.
  const deletion = operation("delete", original.id);
  await api([deletion]);
  await api([operation("seed", original.id, original), operation("patch", original.id, { status: "doing" }), deletion]);
  assert.equal((await api()).some(t => t.id === original.id), false);
});

test("operation ordering and idempotence preserve quick create/move/delete actions", async () => {
  const a = browser();
  await a.settle();
  const created = task();
  a.save([...a.tasks, created]);
  a.save(a.tasks.map(t => t.id === created.id ? { ...t, status: "done" } : t));
  await a.refresh();
  assert.equal((await api()).find(t => t.id === created.id).status, "done");
  a.save(a.tasks.filter(t => t.id !== created.id));
  await a.refresh();
  assert.equal((await api()).some(t => t.id === created.id), false);
});

test("API rejects cross-origin writes and invalid batches atomically", async () => {
  const response = await fetch(base + "/api/tasks", { method: "POST", headers: { Authorization: authorization, Origin: "https://example.com" }, body: "[]" });
  assert.equal(response.status, 403);
  const created = task();
  const invalid = await fetch(base + "/api/tasks", {
    method: "POST", headers: { Authorization: authorization, Origin: base },
    body: JSON.stringify([operation("create", created.id, created), operation("patch", created.id, { status: "invalid" })])
  });
  assert.equal(invalid.status, 400);
  assert.equal((await api()).some(t => t.id === created.id), false);
});

test("landing is public and both board roles require sign-in", async () => {
  const landing = await fetch(base + "/");
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /Deployment service · \$100/);
  assert.equal((await fetch(base + "/view")).status, 403);
  assert.equal((await fetch(base + "/view", { method: "POST" })).status, 405);
  for (const path of ["/board", "/index.html", "/app.js", "/api/tasks"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 401);
    if (path.endsWith(".js") || path.startsWith("/api/")) {
      assert.match(response.headers.get("www-authenticate"), /^Basic /);
    } else {
      assert.match(await response.text(), /Keep me signed in for 30 days/);
    }
  }
  assert.equal((await fetch(base + "/board", { headers: { Authorization: authorization } })).status, 200);
});

test("board login sets an optional persistent session and sign-out clears access", async () => {
  const origin = new URL(base).origin;
  const form = new URLSearchParams({
    username: "taskflow", password: process.env.BOARD_PASSWORD || "local-sync-test"
  });
  const login = (body, requestOrigin = origin) => fetch(base + "/login", {
    method: "POST", headers: { Origin: requestOrigin }, body, redirect: "manual"
  });
  assert.equal((await login(form, "https://example.com")).status, 403);
  assert.equal((await login(new URLSearchParams({ username: "taskflow", password: "wrong" }))).status, 401);
  const session = await login(form);
  assert.equal(session.status, 303);
  assert.doesNotMatch(session.headers.get("set-cookie"), /Max-Age/);

  form.set("remember", "yes");
  const remembered = await login(form);
  assert.equal(remembered.status, 303);
  assert.equal(remembered.headers.get("location"), "/board");
  const cookie = remembered.headers.get("set-cookie");
  assert.match(cookie, /Max-Age=2592000; Path=\/; Secure; HttpOnly; SameSite=Lax/);
  const token = cookie.split(";")[0];
  assert.equal((await fetch(base + "/board", { headers: { Cookie: token } })).status, 200);
  assert.equal((await fetch(base + "/api/tasks", { headers: { Cookie: token } })).status, 200);
  assert.equal((await fetch(base + "/board", { headers: { Cookie: token.replace(/\.(.)/, (_, char) => "." + (char === "A" ? "B" : "A")) } })).status, 401);

  const logout = await fetch(base + "/logout", {
    method: "POST", headers: { Origin: origin, Cookie: token }, redirect: "manual"
  });
  assert.equal(logout.status, 303);
  assert.equal((await fetch(base + "/board", {
    headers: { Cookie: logout.headers.get("set-cookie").split(";")[0], Authorization: authorization }
  })).status, 401);
});

test("deleting a category moves its items and redirects delayed writes", async () => {
  const id = "category-" + randomUUID();
  const name = "Research " + randomUUID();
  const existing = { ...task(), kind: id };
  const delayed = { ...task(), kind: id };
  const change = (body) => fetch(base + "/api/categories", {
    method: "POST",
    headers: { Authorization: authorization, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const remove = { type: "delete", id, destination: "task" };
  try {
    const create = { type: "create", id, name };
    assert.equal((await change(create)).status, 204);
    assert.equal((await change(create)).status, 204);
    assert.equal((await api([operation("create", existing.id, existing)])).find(item => item.id === existing.id).kind, id);
    assert.equal((await change(remove)).status, 204);
    assert.equal((await change(remove)).status, 204);
    const tasks = await api([operation("create", delayed.id, delayed)]);
    for (const entry of [existing, delayed]) {
      const moved = tasks.find(item => item.id === entry.id);
      assert.equal(moved.title, entry.title);
      assert.equal(moved.kind ?? "task", "task");
    }
    const response = await fetch(base + "/api/board", { headers: { Authorization: authorization } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).categories.some(category => category.id === id), false);
  } finally {
    await change(remove);
    await api([existing, delayed].map(entry => operation("delete", entry.id)));
  }
});

test("parent links survive sync and are cleared when their parent is deleted", async () => {
  const idea = { ...task(), kind: "idea" };
  const goal = { ...task(), kind: "goal", parentId: idea.id };
  const child = { ...task(), parentId: goal.id };
  const unrelated = { ...task(), parentId: idea.id };
  const entries = [idea, goal, child, unrelated];
  try {
    const created = await api(entries.slice().reverse().map(item => operation("create", item.id, item)));
    assert.equal(created.find(item => item.id === goal.id).parentId, idea.id);
    assert.equal(created.find(item => item.id === child.id).parentId, goal.id);
    assert.equal(created.find(item => item.id === unrelated.id).parentId, undefined);
    const remaining = await api([operation("delete", goal.id)]);
    assert.equal(remaining.find(item => item.id === child.id).parentId, undefined);
    assert.equal(remaining.find(item => item.id === child.id).title, child.title);
  } finally {
    await api(entries.map(item => operation("delete", item.id)));
  }
});
