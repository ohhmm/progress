import { DurableObject } from "cloudflare:workers";
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
    const supplied = request.headers.get("Authorization") || "";
    const passwordBytes = new TextEncoder().encode("taskflow:" + env.BOARD_PASSWORD);
    const expected = "Basic " + btoa(Array.from(passwordBytes, byte => String.fromCharCode(byte)).join(""));
    const digest = value => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    const [actualHash, expectedHash] = await Promise.all([digest(supplied), digest(expected)]);
    const actual = new Uint8Array(actualHash);
    const expectedBytes = new Uint8Array(expectedHash);
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expectedBytes[i];
    if (difference) {
      return new Response("Sign in to Taskflow", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Taskflow", charset="UTF-8"', "Cache-Control": "no-store" }
      });
    }
    if (url.pathname === "/board" && (request.method === "GET" || request.method === "HEAD")) {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), { method: request.method }));
    }
    if (url.pathname !== "/api/tasks") return env.ASSETS.fetch(request);
    if (request.method === "POST" && request.headers.get("Origin") !== url.origin) {
      return new Response("Forbidden", { status: 403 });
    }
    return serveBoard(request, env);
  }
};

async function serveBoard(request, env, viewer = false) {
  try {
    const response = await env.BOARD.getByName("taskflow").fetch(request);
    return viewer && response.ok ? renderViewerBoard(await response.json()) : response;
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
  }

  async fetch(request) {
    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > 1000000) return new Response("Request too large", { status: 413 });
      let operations;
      try {
        operations = JSON.parse(text);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      const fields = new Set(["title", "notes", "tag", "priority", "due", "status", "created", "completedAt"]);
      if (!Array.isArray(operations) || operations.length > 1000 || operations.some(op =>
        !op || typeof op.id !== "string" || typeof op.taskId !== "string" ||
        !["create", "seed", "patch", "delete"].includes(op.type) ||
        (op.type !== "delete" && (!op.patch || typeof op.patch !== "object" || Array.isArray(op.patch) ||
          Object.entries(op.patch).some(([key, value]) => !fields.has(key) ||
            (["created", "completedAt"].includes(key) ? value !== null && !Number.isSafeInteger(value) : typeof value !== "string")) ||
          ("status" in op.patch && !["backlog", "doing", "done"].includes(op.patch.status)) ||
          ("priority" in op.patch && !["high", "medium", "low"].includes(op.patch.priority)) ||
          (["create", "seed"].includes(op.type) && !op.patch.title))))) {
        return new Response("Invalid operations", { status: 400 });
      }
      this.ctx.storage.transactionSync(() => {
        for (const op of operations) {
          if (this.sql.exec("SELECT id FROM receipts WHERE id = ?", op.id).toArray().length) continue;
          const row = this.sql.exec("SELECT data FROM tasks WHERE id = ?", op.taskId).toArray()[0];
          if (op.type === "delete") {
            this.sql.exec("INSERT INTO tasks VALUES (?, NULL) ON CONFLICT(id) DO UPDATE SET data = NULL", op.taskId);
          } else if ((!row && ["create", "seed"].includes(op.type)) || (row?.data && op.type === "patch")) {
            const task = { ...(row?.data ? JSON.parse(row.data) : {}), ...op.patch, id: op.taskId };
            this.sql.exec("INSERT INTO tasks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data", op.taskId, JSON.stringify(task));
          }
          this.sql.exec("INSERT INTO receipts VALUES (?)", op.id);
        }
      });
    } else if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    const tasks = this.sql.exec("SELECT data FROM tasks WHERE data IS NOT NULL ORDER BY json_extract(data, '$.created') DESC, id").toArray().map(row => JSON.parse(row.data));
    return Response.json(tasks, { headers: { "Cache-Control": "no-store" } });
  }
}
