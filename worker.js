import { isRank } from "./rank.js";
import { DurableObject } from "cloudflare:workers";
import { boardSignIn, handleBoardSignIn, hasBoardAccess } from "./board-auth.js";
import { hasViewerAccess, renderViewerBoard } from "./viewer.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      return env.ASSETS.fetch(new Request(new URL("/landing.html", url), { method: request.method }));
    }
    if (url.pathname === "/view") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      if (!await hasViewerAccess(request, env)) {
        return new Response("Social sign-in required", { status: 403, headers: { "Cache-Control": "no-store" } });
      }
      return serveBoard(request, env, true);
    }
    if (!env.BOARD_PASSWORD) {
      return new Response("Set the BOARD_PASSWORD Worker secret to activate the shared board.", { status: 503 });
    }
    if (url.pathname === "/login" || url.pathname === "/logout") {
      return handleBoardSignIn(request, env.BOARD_PASSWORD, url);
    }
    const openingBoard = ["/board", "/index.html"].includes(url.pathname) && (request.method === "GET" || request.method === "HEAD");
    if (!await hasBoardAccess(request, env.BOARD_PASSWORD, url.origin)) {
      if (openingBoard) return boardSignIn();
      return new Response("Sign in to Taskflow", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Taskflow", charset="UTF-8"', "Cache-Control": "no-store" }
      });
    }
    if (openingBoard) {
      const response = await env.ASSETS.fetch(new Request(new URL("/index.html", url), { method: request.method }));
      const board = new Response(response.body, response);
      board.headers.set("Cache-Control", "no-store");
      return board;
    }
    if (!["/api/tasks", "/api/board", "/api/categories"].includes(url.pathname)) return env.ASSETS.fetch(request);
    if (request.method === "POST" && request.headers.get("Origin") !== url.origin) {
      return new Response("Forbidden", { status: 403 });
    }
    return serveBoard(request, env);
  }
};

async function serveBoard(request, env, viewer = false) {
  try {
    const response = await env.BOARD.getByName("taskflow").fetch(request);
    if (!viewer || !response.ok) return response;
    const { tasks, categories } = await response.json();
    return renderViewerBoard(tasks, categories);
  } catch (error) {
    console.error("Board storage failed", error);
    return Response.json({ error: "Board storage unavailable" }, { status: 503 });
  }
}

export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, destination TEXT)");
    this.sql.exec("INSERT OR IGNORE INTO categories (id, name) VALUES ('idea','Ideas'), ('goal','Goals'), ('task','Tasks')");
  }

  categories() {
    return this.sql.exec("SELECT id, name FROM categories WHERE destination IS NULL ORDER BY rowid").toArray();
  }

  async changeCategory(request) {
    let change;
    try {
      const text = await request.text();
      if (text.length > 4096) return new Response("Request too large", { status: 413 });
      change = JSON.parse(text);
    } catch {
      return new Response("Invalid category request", { status: 400 });
    }
    if (!change || typeof change.id !== "string") return new Response("Invalid category", { status: 400 });
    return this.ctx.storage.transactionSync(() => {
      if (change.type === "create") {
        const name = typeof change.name === "string" ? change.name.trim() : "";
        if (!/^category-[0-9a-f-]{36}$/.test(change.id) || !name || name.length > 60) {
          return new Response("Enter a category name of up to 60 characters.", { status: 400 });
        }
        const existing = this.sql.exec("SELECT name, destination FROM categories WHERE id = ?", change.id).toArray()[0];
        if (existing) {
          return existing.name === name && existing.destination === null
            ? new Response(null, { status: 204 })
            : new Response("This category ID has already been used.", { status: 409 });
        }
        if (this.categories().some((category) => category.name.toLowerCase() === name.toLowerCase())) {
          return new Response("A category already has that name.", { status: 409 });
        }
        this.sql.exec("INSERT INTO categories (id, name) VALUES (?, ?)", change.id, name);
      } else if (change.type === "delete" && typeof change.destination === "string" && change.id !== change.destination) {
        const active = this.categories();
        if (!active.some(({ id }) => id === change.id)) return new Response(null, { status: 204 });
        if (!active.some(({ id }) => id === change.destination)) {
          return new Response("Choose an existing category for its items.", { status: 409 });
        }
        this.sql.exec("UPDATE categories SET destination = ? WHERE id = ?", change.destination, change.id);
        this.sql.exec(
          "UPDATE tasks SET data = CASE WHEN ? = 'task' THEN json_remove(data, '$.kind') ELSE json_set(data, '$.kind', ?) END WHERE data IS NOT NULL AND COALESCE(json_extract(data, '$.kind'), 'task') = ?",
          change.destination, change.destination, change.id
        );
      } else {
        return new Response("Invalid category request", { status: 400 });
      }
      return new Response(null, { status: 204 });
    });
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/categories") {
      if (request.method === "POST") return this.changeCategory(request);
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }
    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > 1000000) return new Response("Request too large", { status: 413 });
      let operations;
      try {
        operations = JSON.parse(text);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const fields = new Set(["kind", "rank", "title", "notes", "tag", "priority", "due", "status", "created", "completedAt"]);
      if (!Array.isArray(operations) || operations.length > 1000 || operations.some(op =>
        !op || typeof op.id !== "string" || typeof op.taskId !== "string" ||
        !["create", "seed", "patch", "delete"].includes(op.type) ||
        (op.type !== "delete" && (!op.patch || typeof op.patch !== "object" || Array.isArray(op.patch) ||
          Object.entries(op.patch).some(([key, value]) => !fields.has(key) ||
            (["created", "completedAt"].includes(key) ? value !== null && !Number.isSafeInteger(value) : typeof value !== "string")) ||
          ("rank" in op.patch && !isRank(op.patch.rank)) ||
          ("kind" in op.patch && !/^(?:idea|goal|task|category-[0-9a-f-]{36})$/.test(op.patch.kind)) ||
          ("status" in op.patch && !["backlog", "doing", "done"].includes(op.patch.status)) ||
          ("priority" in op.patch && !["high", "medium", "low"].includes(op.patch.priority)) ||
          (["create", "seed"].includes(op.type) && !op.patch.title))))) {
        return new Response("Invalid operations", { status: 400 });
      }
      this.ctx.storage.transactionSync(() => {
        const destinations = new Map(this.sql.exec("SELECT id, destination FROM categories").toArray()
          .map(({ id, destination }) => [id, destination]));
        const fallback = this.categories()[0].id;
        for (const op of operations) {
          if (this.sql.exec("SELECT id FROM receipts WHERE id = ?", op.id).toArray().length) continue;
          const row = this.sql.exec("SELECT data FROM tasks WHERE id = ?", op.taskId).toArray()[0];
          if (op.type === "delete") {
            this.sql.exec("INSERT INTO tasks VALUES (?, NULL) ON CONFLICT(id) DO UPDATE SET data = NULL", op.taskId);
          } else if ((!row && ["create", "seed"].includes(op.type)) || (row?.data && op.type === "patch")) {
            const task = { ...(row?.data ? JSON.parse(row.data) : {}), ...op.patch, id: op.taskId };
            let kind = task.kind ?? "task";
            while (destinations.get(kind)) kind = destinations.get(kind);
            if (!destinations.has(kind)) kind = fallback;
            if (kind === "task") delete task.kind;
            else task.kind = kind;
            this.sql.exec("INSERT INTO tasks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", op.taskId, JSON.stringify(task));
          }
          this.sql.exec("INSERT INTO receipts VALUES (?)", op.id);
        }
      });
    } else if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    const tasks = this.sql.exec("SELECT data FROM tasks WHERE data IS NOT NULL ORDER BY json_extract(data, '$.created') DESC, id").toArray().map(row => JSON.parse(row.data));
    const data = path === "/api/tasks" ? tasks : { tasks, categories: this.categories() };
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  }
}
