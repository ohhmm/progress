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
  let secondTaskId;
  let goalId;
  let ideaId;
  let customItemId;
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
    await expect(a.locator("#board-sections > details > summary")).toHaveText(["Ideas", "Goals", "Tasks"]);
    await expect(ideas.getByRole("button", { name: "New idea" })).toBeVisible();
    await expect(goals.getByRole("button", { name: "New goal" })).toBeHidden();
    await goals.locator("summary").click();
    await b.locator("#goal-management summary").click();
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
    const secondTitle = "Rank anchor " + randomUUID();
    await tasks.getByRole("button", { name: "New task" }).click();
    await a.locator("#task-title").fill(secondTitle);
    await a.locator('#task-form button[type="submit"]').click();
    const secondCard = tasks.locator(".card").filter({ hasText: secondTitle });
    secondTaskId = await secondCard.getAttribute("data-id");
    const rankedTitles = (page) => page.locator('#task-management [data-status="backlog"] .card h3')
      .filter({ hasText: /^(Sync verification|Rank anchor) / });
    await expect(rankedTitles(b)).toHaveText([secondTitle, title], { timeout: 15000 });
    await cardA.dragTo(secondCard, { targetPosition: { x: 20, y: 5 } });
    await expect(rankedTitles(a)).toHaveText([title, secondTitle]);
    await expect(rankedTitles(b)).toHaveText([title, secondTitle], { timeout: 15000 });
    await b.reload();
    await b.locator("#task-management summary").click();
    await expect(rankedTitles(b)).toHaveText([title, secondTitle]);
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
    await a.getByRole("button", { name: "Edit categories" }).click();
    await a.getByRole("button", { name: "Move Goals up" }).click();
    await a.getByLabel("Goals background color").fill("#245f93");
    await a.getByRole("button", { name: "Save changes" }).click();
    await a.reload();
    await expect(a.locator("#board-sections > details > summary")).toHaveText(["Goals", "Ideas", "Tasks"]);
    await expect(a.locator("#board-sections > details[open] > summary")).toHaveText(["Goals"]);
    await expect(a.locator("#goal-management")).toHaveAttribute("style", /--category-background: #245f93/);
    await a.getByRole("button", { name: "Edit categories" }).click();
    await a.getByRole("button", { name: "Reset Goals background" }).click();
    await a.getByRole("button", { name: "Save changes" }).click();
    await expect(a.locator("#goal-management")).not.toHaveAttribute("style", /--category-background/);
    await expect(b.locator("#board-sections > details > summary")).toHaveText(["Ideas", "Goals", "Tasks"]);
    const categoryName = "Research " + randomUUID();
    const itemTitle = "Transferred " + randomUUID();
    await a.getByRole("button", { name: "Edit categories" }).click();
    await a.getByRole("textbox", { name: "Category name" }).fill(categoryName);
    await a.getByRole("button", { name: "Add category" }).click();
    await expect(a.getByRole("button", { name: `Delete ${categoryName} category` })).toBeVisible();
    await a.locator("#cancel-category-order").click();
    const desktopCategory = a.locator("#board-sections > details").filter({ has: a.locator("summary", { hasText: categoryName }) });
    const mobileCategory = b.locator("#board-sections > details").filter({ has: b.locator("summary", { hasText: categoryName }) });
    await expect(mobileCategory.locator("summary")).toBeVisible({ timeout: 15000 });
    await desktopCategory.locator("summary").click();
    await desktopCategory.getByRole("button", { name: "New item" }).click();
    await a.locator("#task-title").fill(itemTitle);
    await a.locator('#task-form button[type="submit"]').click();
    customItemId = await desktopCategory.locator(".card").filter({ hasText: itemTitle }).getAttribute("data-id");
    await mobileCategory.locator("summary").click();
    await expect(mobileCategory.locator("h3", { hasText: itemTitle })).toBeVisible({ timeout: 15000 });
    await a.getByRole("button", { name: "Edit categories" }).click();
    await a.getByRole("button", { name: `Delete ${categoryName} category` }).click();
    await a.getByLabel("Move its items to").selectOption("task");
    await a.getByRole("button", { name: "Move items and delete" }).click();
    await expect(desktopCategory).toHaveCount(0);
    await a.locator("#cancel-category-order").click();
    await expect(mobileCategory).toHaveCount(0, { timeout: 15000 });
    await b.locator("#task-management summary").click();
    await expect(b.locator("#task-management h3", { hasText: itemTitle })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    const ids = [taskId, secondTaskId, goalId, ideaId, customItemId].filter(Boolean);
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
