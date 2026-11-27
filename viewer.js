import { compareRank } from "./rank.js";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

function decodeBase64Url(value) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
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

export function renderViewerBoard(tasks, categories) {
  const labels = { backlog: "Backlog", doing: "Doing", done: "Done" };
  const card = task => `
      <article>
        <h4>${html(task.title)}</h4>
        <p>${[task.tag, task.priority, task.due].filter(Boolean).map(html).join(" · ")}</p>
        ${task.notes ? `<p class="notes">${html(task.notes)}</p>` : ""}
        <a href="/board" aria-label="Sign in to edit ${html(task.title)}">Edit</a>
      </article>`;
  const columns = (kind) => Object.entries(labels).map(([status, label]) => {
    const cards = tasks.filter(task => task.status === status && (task.kind ?? "task") === kind).sort(compareRank).map(card).join("");
    return `<section><h3>${label}</h3>${cards || `<p>No items</p>`}</section>`;
  }).join("");
  const sections = categories.map(({ id, name }, index) =>
    `<details${index === 0 ? " open" : ""}><summary>${html(name)}</summary><div class="columns">${columns(id)}</div></details>`
  ).join("");
  return new Response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taskflow — Read-only board</title>
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
  <div><a href="/">Taskflow</a><h1>Read-only board</h1></div>
  <a href="/board" aria-label="Sign in to create a new task">New task</a>
</header>
<main>${sections}</main>
</html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}
