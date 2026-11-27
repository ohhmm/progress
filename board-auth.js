const encoder = new TextEncoder();
const cookieName = "__Host-taskflow";
const cookieFlags = "Path=/; Secure; HttpOnly; SameSite=Lax";
const rememberedSeconds = 30 * 24 * 60 * 60;
const sessionSeconds = 12 * 60 * 60;

function getSession(request) {
  return request.headers.get("Cookie")?.split(/;\s*/).find(cookie =>
    cookie.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
}

async function matches(actual, expected) {
  const digest = value => crypto.subtle.digest("SHA-256", encoder.encode(value));
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  const right = new Uint8Array(b);
  return new Uint8Array(a).reduce((difference, byte, i) => difference | (byte ^ right[i]), 0) === 0;
}

function toBase64(bytes) {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""));
}

function sessionKey(password) {
  return crypto.subtle.importKey("raw", encoder.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function hasBoardAccess(request, password, origin) {
  const token = getSession(request);
  if (token) {
    const [expires, signature] = token.split(".");
    if (!/^\d{10}\.[\w+/]{43}=$/.test(token) || Number(expires) <= Date.now() / 1000) return false;
    const key = await sessionKey(password);
    return crypto.subtle.verify("HMAC", key, Uint8Array.from(atob(signature), char => char.charCodeAt(0)),
      encoder.encode(origin + ":" + expires));
  }
  const supplied = request.headers.get("Authorization");
  return Boolean(supplied && await matches(supplied, "Basic " + toBase64(encoder.encode("taskflow:" + password))));
}

export function boardAccessPage(error = false) {
  return new Response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open the Progress board</title>
<style>
  :root { color-scheme: light dark; font: 1rem system-ui, sans-serif; }
  main { max-width: 24rem; margin: 10vh auto; padding: 1.5rem; }
  form, label { display: grid; gap: .5rem; }
  form { gap: 1rem; }
  .remember { display: flex; align-items: center; }
  input, button { font: inherit; }
  button { padding: .5rem; }
</style>
<main>
  <h1>Open the Progress board</h1>
  ${error ? `<p role="alert">That board password is incorrect.</p>` : ""}
  <form action="/access" method="post">
    <input type="hidden" name="username" value="taskflow" autocomplete="username">
    <label>Password <input type="password" name="password" autocomplete="current-password" required autofocus></label>
    <label class="remember"><input type="checkbox" name="remember" value="yes"> Remember this browser for 30 days</label>
    <button type="submit">Open board</button>
  </form>
</main>
</html>`, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function handleBoardSession(request, password, url) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (request.headers.get("Origin") !== url.origin) return new Response("Forbidden", { status: 403 });

  let cookie = "closed";
  if (url.pathname === "/access") {
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded") {
      return new Response("Unsupported form encoding", { status: 415 });
    }
    const form = new URLSearchParams(await request.text());
    if (form.get("username") !== "taskflow" || !await matches(form.get("password") || "", password)) {
      return boardAccessPage(true);
    }
    const remember = form.get("remember") === "yes";
    const expires = Math.floor(Date.now() / 1000) + (remember ? rememberedSeconds : sessionSeconds);
    const signature = await crypto.subtle.sign("HMAC", await sessionKey(password), encoder.encode(url.origin + ":" + expires));
    cookie = expires + "." + toBase64(new Uint8Array(signature));
    if (remember) cookie += "; Max-Age=" + rememberedSeconds;
  }
  // A session-only marker also suppresses browser-cached Basic Auth after the session ends.
  return new Response(null, {
    status: 303,
    headers: { Location: "/board", "Set-Cookie": cookieName + "=" + cookie + "; " + cookieFlags, "Cache-Control": "no-store" }
  });
}
