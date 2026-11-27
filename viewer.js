import { neighborKind } from "./hierarchy.js";
import { compareRank } from "./rank.js";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

function decodeBase64Url(value) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
}

export function viewerConfigured(env) {
  return Boolean(env.VIEWER_ACCESS_ISSUER && env.VIEWER_ACCESS_AUD);
}

export function viewerAccessPage(configured) {
  const explanation = configured
    ? "Ask the board owner to approve your account for shared viewing."
    : "Shared viewing is unavailable on this deployment.";
  return new Response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared board · Progress</title>
<style>
  :root { color-scheme: light dark; font: 1rem system-ui, sans-serif; }
  main { max-width: 34rem; margin: 10vh auto; padding: 1.5rem; }
</style>
<main>
  <h1>Shared board</h1>
  <p>${explanation}</p>
  <a href="/">Back to Progress</a>
</main>
</html>`, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function hasViewerAccess(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const issuer = env.VIEWER_ACCESS_ISSUER;
  const audience = env.VIEWER_ACCESS_AUD;
  if (!token || !issuer || !audience) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some(part => !/^[\w-]+$/.test(part))) return false;
    const [header, payload, signature] = parts;
    const { alg, kid } = JSON.parse(textDecoder.decode(decodeBase64Url(header)));
    const claims = JSON.parse(textDecoder.decode(decodeBase64Url(payload)));
    const now = Math.floor(Date.now() / 1000);
    if (alg !== "RS256" || typeof kid !== "string" || claims.iss !== issuer ||
        !Array.isArray(claims.aud) || !claims.aud.includes(audience) ||
        !Number.isFinite(claims.exp) || claims.exp <= now ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) ||
        typeof claims.sub !== "string" || !claims.sub || !claims.email || claims.type !== "app") return false;
    const response = await fetch(new URL("/cdn-cgi/access/certs", issuer));
    if (!response.ok) return false;
    const { keys } = await response.json();
    const jwk = keys.find(key => key.kid === kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
    return await crypto.subtle.verify(algorithm, key, decodeBase64Url(signature), textEncoder.encode(header + "." + payload));
  } catch {
    return false;
  }
}

const html = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

export function renderViewerBoard(tasks, categories, parentId) {
  const order = categories.map(({ id }) => id);
  const nextKind = (task) => neighborKind(order, task.kind ?? "task", 1);
  const parent = tasks.find(task => task.id === parentId && nextKind(task));
  const child = parent ? nextKind(parent) : null;
  const labels = { backlog: "Backlog", doing: "Doing", done: "Done" };
  const card = task => {
    const title = html(task.title);
    const heading = nextKind(task)
      ? `<a href="/view?parent=${encodeURIComponent(task.id)}">${title}</a>`
      : title;
    return `
      <article>
        <h4>${heading}</h4>
        <p>${[task.tag, task.priority, task.due].filter(Boolean).map(html).join(" · ")}</p>
        ${task.notes ? `<p class="notes">${html(task.notes)}</p>` : ""}
        <a href="/board" aria-label="Open the editor for ${html(task.title)}">Edit</a>
      </article>`;
  };
  const columns = (kind) => Object.entries(labels).map(([status, label]) => {
    const cards = tasks.filter(task => task.status === status && (task.kind ?? "task") === kind && (kind !== child || task.parentId === parent.id)).sort(compareRank).map(card).join("");
    return `<section><h3>${label}</h3>${cards || `<p>No items</p>`}</section>`;
  }).join("");
  const sections = categories.map(({ id, name }, index) => {
    const selected = id === child;
    const expanded = child ? selected : index === 0;
    const scope = selected ? `<p><strong>${html(parent.title)}</strong> <a href="/view">Show all ${html(name.toLowerCase())}</a></p>` : "";
    return `<details${expanded ? " open" : ""}><summary>${html(name)}</summary>${scope}<div class="columns">${columns(id)}</div></details>`;
  }).join("");
  return new Response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Progress — Read-only board</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 85rem; margin: auto; padding: 1.5rem; }
  a { color: inherit; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  details { margin-top: 1rem; }
  summary { cursor: pointer; font-weight: 700; }
  .columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  article { border: 1px solid GrayText; border-radius: .75rem; padding: 1rem; margin-bottom: 1rem; overflow-wrap: anywhere; }
  h4 { margin-top: 0; }
  .notes { white-space: pre-wrap; }
  @media (max-width: 46rem) { .columns { grid-template-columns: 1fr; } }
</style>
<header>
  <div><a href="/">Progress</a><h1>Read-only board</h1></div>
  <a href="/board" aria-label="Open the editor to create a task">New task</a>
</header>
<main>${sections}</main>
</html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}
