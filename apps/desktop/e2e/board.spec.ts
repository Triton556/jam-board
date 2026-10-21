import { expect, test } from "@playwright/test";

async function demo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
}
test("onboarding creates a jam and an empty board", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Game jam", exact: true }).click();
  await page.getByLabel("Jam name", { exact: true }).fill("A little snowy jam");
  await page.getByLabel("Your name", { exact: true }).fill("Danil");
  await page.getByRole("button", { name: "Create jam", exact: true }).click();
  await expect(page).toHaveURL(/\/board/);
  await expect(page.getByText("Nothing here yet")).toHaveCount(5);
});
test("demo loads all 22 cards and opens a task by URL", async ({ page }) => {
  await demo(page);
  expect(
    await page
      .locator(".board-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: /Open JB-2:/ }).click();
  await expect(page).toHaveURL(/task=JB-2/);
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Player movement: coyote time & jump buffer",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("pointer drag moves Ready into In progress", async ({ page }) => {
  await demo(page);
  const card = page.getByRole("button", { name: /Open JB-2:/ });
  const target = page.locator('[data-column="in_progress"] .column-heading');
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + 80, from.y + 60);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 60, { steps: 3 });
  await page.mouse.move(to.x + 80, to.y + 60, { steps: 15 });
  await page.mouse.up();
  await expect(
    page.locator('[data-column="in_progress"] [data-key="JB-2"]'),
  ).toBeVisible();
});
test("inline create and N shortcut", async ({ page }) => {
  await demo(page);
  await page.keyboard.press("n");
  const input = page.getByRole("textbox", { name: "New task in Backlog" });
  await input.fill("A tiny campfire");
  await input.press("Enter");
  await expect(page.getByTestId("task-card")).toHaveCount(23);
  await expect(
    page.getByText("A tiny campfire", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await input.press("Escape");
});
test("agent creation highlights a card, shows a toast and expires", async ({
  page,
}) => {
  await demo(page);
  const normalShadow = await page
    .locator('[data-key="JB-1"]')
    .evaluate((e) => getComputedStyle(e).boxShadow);
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "task.created",
      title: "Add jump buffer",
      status: "backlog",
    }),
  );
  await expect(page.locator('[data-key="JB-23"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expect(
    page.getByRole("status", { name: "Notifications" }),
  ).toContainText("Codex created JB-23 · Add jump buffer");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Add jump buffer",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-key="JB-23"]')).toHaveAttribute(
    "data-highlighted",
    "false",
    { timeout: 6000 },
  );
  await expect(page.locator('[data-key="JB-23"]')).toHaveCSS(
    "box-shadow",
    normalShadow,
    { timeout: 2000 },
  );
});
test("dark theme applies to paper and cards", async ({ page }) => {
  await demo(page);
  await page.getByRole("radio", { name: "None", exact: true }).click();
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const papers = page.getByTestId("task-card").locator(".task-card");
  await page.mouse.move(30, 70);
  await expect
    .poll(async () =>
      papers.evaluateAll(
        (cards) =>
          new Set(cards.map((card) => getComputedStyle(card).backgroundColor))
            .size,
      ),
    )
    .toBe(1);
  await expect(papers.first()).toHaveCSS("clip-path", "none");
  await expect(papers.first()).toHaveCSS("background-color", "rgb(46, 41, 37)");
});
test("keyboard drop works in Chromium and reduced motion retains agent feedback", async ({
  page,
}) => {
  await demo(page);
  await page.getByRole("button", { name: /Open JB-2:/ }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(
    page.locator('[data-column="in_progress"] [data-key="JB-2"]'),
  ).toBeAttached();
  expect(
    await page.evaluate(
      () =>
        window.__jamMock.calls.find((call) => call.command === "move_task")
          ?.input,
    ),
  ).toEqual({
    key: "JB-2",
    status: "in_progress",
    afterKey: "JB-14",
    beforeKey: undefined,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "task.created",
      status: "backlog",
      title: "Quiet lantern animation",
    }),
  );
  await expect(page.locator('[data-key="JB-23"]')).toHaveCSS(
    "transform",
    "none",
  );
  await expect(page.locator('[data-key="JB-23"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expect(
    page.getByRole("status", { name: "Notifications" }),
  ).toContainText("Quiet lantern animation");
});
test("minimum window, expanded navigation and Team screen", async ({
  page,
}) => {
  await demo(page);
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "216px");
  await expect(
    page.getByRole("button", { name: "New task · N", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The team" })).toBeVisible();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
});
