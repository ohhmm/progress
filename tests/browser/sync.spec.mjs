import { test, expect, webkit, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";

const base = process.env.BASE || "http://127.0.0.1:8787";
const credentials = { username: "taskflow", password: process.env.BOARD_PASSWORD || "local-sync-test" };

test("desktop moves sync to iPhone WebKit, including reload and offline retry", async ({ browser }) => {
  test.setTimeout(90000);
  const desktop = await browser.newContext({ httpCredentials: credentials });
  const mobileBrowser = await webkit.launch();
  const mobile = await mobileBrowser.newContext({ ...devices["iPhone 13"], httpCredentials: credentials });
  const a = await desktop.newPage();
  const b = await mobile.newPage();
  const title = "Sync verification " + randomUUID();
  const errors = [];
  a.on("pageerror", error => errors.push(error.message));
  b.on("pageerror", error => errors.push(error.message));
  let taskId;
  try {
    await Promise.all([a.goto(new URL("/board", base).href), b.goto(new URL("/board", base).href)]);
    await expect(a.locator("#sync-status")).toHaveText("All changes saved", { timeout: 20000 });
    await expect(b.locator("#sync-status")).toHaveText("All changes saved", { timeout: 20000 });
    await a.locator("#new-task").click();
    await a.locator("#task-title").fill(title);
    await a.locator('#task-form button[type="submit"]').click();
    const cardA = a.locator(".card").filter({ has: a.locator("h3", { hasText: title }) });
    taskId = await cardA.getAttribute("data-id");
    await expect(b.locator('[data-status="backlog"] .card h3', { hasText: title })).toBeVisible({ timeout: 15000 });
    await cardA.locator(".status-select").selectOption("doing");
    await expect(b.locator('[data-status="doing"] .card h3', { hasText: title })).toBeVisible({ timeout: 15000 });
    await b.reload();
    await expect(b.locator('[data-status="doing"] .card h3', { hasText: title })).toBeVisible({ timeout: 15000 });
    await mobile.setOffline(true);
    await b.locator(`.card[data-id="${taskId}"] .status-select`).selectOption("done");
    await expect(b.locator("#sync-status")).toContainText("Sync unavailable", { timeout: 20000 });
    await mobile.setOffline(false);
    await b.reload();
    await expect(a.locator('[data-status="done"] .card h3', { hasText: title })).toBeVisible({ timeout: 15000 });
    await expect(b.locator("#sync-status")).toHaveText("All changes saved", { timeout: 15000 });
    expect(errors).toEqual([]);
  } finally {
    if (taskId) {
      const response = await desktop.request.post(base + "/api/tasks", {
        headers: { Origin: new URL(base).origin },
        data: [{ id: randomUUID(), type: "delete", taskId }]
      });
      expect(response.status()).toBe(200);
    }
    await desktop.close();
    await mobileBrowser.close();
  }
});
