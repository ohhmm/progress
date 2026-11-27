import { test, expect, webkit, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";

const base = process.env.BASE || "https://127.0.0.1:8787";
const ignoreHTTPSErrors = ["127.0.0.1", "localhost"].includes(new URL(base).hostname);
const credentials = { username: "taskflow", password: process.env.BOARD_PASSWORD || "local-sync-test" };

test("desktop moves sync to iPhone WebKit, including reload and offline retry", async ({ browser }) => {
  test.setTimeout(90000);
  const desktop = await browser.newContext({ httpCredentials: credentials, ignoreHTTPSErrors });
  const mobileBrowser = await webkit.launch();
  const mobile = await mobileBrowser.newContext({ ...devices["iPhone 13"], httpCredentials: credentials, ignoreHTTPSErrors });
  const a = await desktop.newPage();
  const b = await mobile.newPage();
  const title = "Sync verification " + randomUUID();
  const errors = [];
  a.on("pageerror", error => errors.push(error.message));
  b.on("pageerror", error => errors.push(error.message));
  let taskId;
  let goalId;
  let ideaId;
  try {
    await Promise.all([a.goto(new URL("/board", base).href), b.goto(new URL("/board", base).href)]);
    for (const page of [a, b]) {
      await page.getByLabel("Password").fill(credentials.password);
      await page.getByLabel("Keep me signed in for 30 days").check();
      await page.getByRole("button", { name: "Sign in" }).click();
    }
    await expect(a.locator("#sync-status")).toHaveText("All changes saved", { timeout: 20000 });
    await expect(b.locator("#sync-status")).toHaveText("All changes saved", { timeout: 20000 });
    const goals = a.locator("#goal-management");
    const tasks = a.locator("#task-management");
    const ideas = a.locator("#idea-management");
    for (const section of [goals, tasks, ideas]) {
      await expect(section.locator("[data-control]")).toHaveCount(14);
    }
    await expect(tasks.getByRole("button", { name: "New task" })).toBeHidden();
    await expect(ideas.getByRole("button", { name: "New idea" })).toBeHidden();
    await expect(goals.getByRole("button", { name: "New goal" })).toBeVisible();
    await goals.locator("summary").click();
    await expect(goals.getByRole("button", { name: "New goal" })).toBeHidden();
    await goals.locator("summary").click();
    const goalTitle = "Goal " + randomUUID();
    await goals.getByRole("button", { name: "New goal" }).click();
    await a.locator("#task-title").fill(goalTitle);
    await a.locator('#task-form button[type="submit"]').click();
    const goal = goals.locator(".card").filter({ hasText: goalTitle });
    goalId = await goal.getAttribute("data-id");
    await expect(b.locator("#goal-management h3", { hasText: goalTitle })).toBeVisible({ timeout: 15000 });
    await goal.dragTo(goals.locator('[data-status="done"]'));
    await expect(b.locator('#goal-management [data-status="done"] .card').filter({ hasText: goalTitle }).locator(".status-select"))
      .toHaveValue("done", { timeout: 15000 });
    await expect(goals.locator('[data-control="progress-text"]')).toHaveText("100% complete");

    await ideas.locator("summary").click();
    await b.locator("#idea-management summary").click();
    const ideaTitle = "Idea " + randomUUID();
    ideaId = randomUUID();
    await ideas.getByRole("button", { name: "Import" }).click();
    await a.locator("#import-text").fill(JSON.stringify([{ id: ideaId, title: ideaTitle, kind: "idea", status: "done" }]));
    await a.locator("#import-submit").click();
    const idea = ideas.locator(".card").filter({ hasText: ideaTitle });
    const mobileIdea = b.locator("#idea-management h3", { hasText: ideaTitle });
    await expect(mobileIdea).toBeVisible({ timeout: 15000 });
    await ideas.getByRole("searchbox").fill("no matches");
    await expect(idea).toBeHidden();
    await expect(goal).toBeVisible();
    await ideas.getByRole("searchbox").clear();
    await ideas.getByRole("button", { name: "Export" }).click();
    const exported = JSON.parse(await a.locator("#import-text").inputValue());
    expect(exported.find(item => item.id === ideaId)?.kind).toBe("idea");
    expect(exported.some(item => item.id === goalId)).toBe(false);
    await a.locator("#close-import").click();
    await ideas.getByRole("button", { name: "Clear done" }).click();
    await expect(mobileIdea).toBeHidden({ timeout: 15000 });
    await expect(goal).toBeVisible();

    await tasks.locator("summary").click();
    await b.locator("#task-management summary").click();
    await tasks.getByRole("button", { name: "New task" }).click();
    await a.locator("#task-title").fill(title);
    await a.locator('#task-form button[type="submit"]').click();
    const cardA = a.locator(".card").filter({ has: a.locator("h3", { hasText: title }) });
    taskId = await cardA.getAttribute("data-id");
    await expect(b.locator('#task-management [data-status="backlog"] .card h3', { hasText: title })).toBeVisible({ timeout: 15000 });
    await cardA.locator(".status-select").selectOption("doing");
    await expect(b.locator('#task-management [data-status="doing"] .card h3', { hasText: title })).toBeVisible({ timeout: 15000 });
    await b.reload();
    await expect(b.locator('#task-management [data-control="new-task"]')).toBeHidden();
    await b.locator("#task-management summary").click();
    await expect(b.locator('#task-management [data-status="doing"] .card h3', { hasText: title })).toBeVisible({ timeout: 15000 });
    await mobile.setOffline(true);
    await b.locator(`.card[data-id="${taskId}"] .status-select`).selectOption("done");
    await expect(b.locator("#sync-status")).toContainText("Sync unavailable", { timeout: 20000 });
    await mobile.setOffline(false);
    await b.reload();
    await expect(a.locator('#task-management [data-status="done"] .card h3', { hasText: title })).toBeVisible({ timeout: 15000 });
    await expect(b.locator("#sync-status")).toHaveText("All changes saved", { timeout: 15000 });
    expect(errors).toEqual([]);
  } finally {
    const ids = [taskId, goalId, ideaId].filter(Boolean);
    if (ids.length) {
      const response = await desktop.request.post(base + "/api/tasks", {
        headers: { Origin: new URL(base).origin },
        data: ids.map(taskId => ({ id: randomUUID(), type: "delete", taskId }))
      });
      expect(response.status()).toBe(200);
    }
    await desktop.close();
    await mobileBrowser.close();
  }
});
