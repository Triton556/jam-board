import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

async function demo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
}
async function table(page: import("@playwright/test").Page) {
  await demo(page);
  await page.getByRole("link", { name: "Table", exact: true }).click();
  await expect(page.getByTestId("table-row").first()).toBeVisible();
}
test("five columns fit both specified sidebar widths", async ({ page }) => {
  await demo(page);
  expect(
    await page
      .locator(".board-scroll")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1512, height: 860 });
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  expect(
    await page
      .locator(".board-scroll")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});
test("table filters survive URL reload, back and forward", async ({ page }) => {
  await table(page);
  await page
    .getByRole("group", { name: "Filter statuses" })
    .getByRole("button", { name: "In progress" })
    .click();
  await page.getByRole("combobox", { name: "Filter assignee" }).click();
  await page.getByRole("option", { name: "Agents", exact: true }).click();
  await expect(page).toHaveURL(/assignee=agents/);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Filter assignee" }),
  ).toHaveText("Agents");
  await expect(
    page
      .getByRole("group", { name: "Filter statuses" })
      .getByRole("button", { name: "In progress" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("table-row")).toHaveCount(1);
  await page.getByLabel("Search tasks").fill("JB-16");
  await expect(page).toHaveURL(/q=JB-16/);
  await page.goBack();
  await expect(page.getByLabel("Search tasks")).toHaveValue("");
  await page.goForward();
  await expect(page.getByLabel("Search tasks")).toHaveValue("JB-16");
});
test("priority sort cycles ascending, descending and none", async ({
  page,
}) => {
  await table(page);
  await page.evaluate(() =>
    window.__jamMock.createTask({
      title: "Low priority task",
      status: "backlog",
      priority: "low",
    }),
  );
  const th = page.getByRole("columnheader", { name: "Priority" });
  await th.getByRole("button").click();
  await expect(th).toHaveAttribute("aria-sort", "ascending");
  await expect(page.getByTestId("table-row").first()).toContainText("Low");
  await th.getByRole("button").click();
  await expect(th).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByTestId("table-row").first()).toContainText("Critical");
  await th.getByRole("button").click();
  await expect(th).toHaveAttribute("aria-sort", "none");
  await expect(page).toHaveURL(/sort=none/);
});
test("table editing saves changed title, priority and tags onto board", async ({
  page,
}) => {
  await table(page);
  await page.locator('[data-task-key="JB-7"]').click();
  await page
    .getByRole("textbox", { name: "Task title" })
    .fill("Snowy jump buffer");
  await page
    .getByRole("radiogroup", { name: "Priority", exact: true })
    .getByRole("radio", { name: "Critical", exact: true })
    .click();
  const tags = page.getByRole("combobox", { name: "Tags", exact: true });
  await tags.fill("  POLISH ");
  await tags.press("Enter");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  const card = page.locator('[data-key="JB-7"]');
  await expect(card).toContainText("Snowy jump buffer");
  await expect(card).toContainText("polish");
  await expect(card.getByLabel("critical priority")).toBeVisible();
  await expect(card.locator(".tape")).toHaveCount(0);
});
test("dirty guard and agent conflict preserve input then take theirs", async ({
  page,
}) => {
  await table(page);
  await page.locator('[data-task-key="JB-7"]').click();
  const title = page.getByRole("textbox", { name: "Task title" });
  await title.fill("My unsaved title");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Discard changes?", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "task.updated",
      key: "JB-7",
      title: "Agent's new title",
    }),
  );
  await expect(page.locator(".conflict-banner")).toContainText(
    "Codex updated this task while you were editing",
  );
  await expect(title).toHaveValue("My unsaved title");
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Review changes", exact: true }),
  ).toContainText("Agent's new title");
  await page
    .getByRole("button", {
      name: "Discard my edits and use latest",
      exact: true,
    })
    .click();
  await expect(title).toHaveValue("Agent's new title");
  await expect(page.getByRole("button", { name: /^Save/ })).toBeDisabled();
});
test("palette exact key opens task and Ctrl Enter posts comment", async ({
  page,
}) => {
  await demo(page);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("jb-5");
  await expect(
    page.locator('.command-results [role="option"]').first(),
  ).toContainText("JB-5");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/task=JB-5/);
  const comment = page.getByRole("textbox", { name: "Write a comment" });
  await comment.fill("The lantern looks lovely in this build.");
  await comment.press("Control+Enter");
  await expect(page.locator(".comment")).toContainText([
    "The lantern looks lovely in this build.",
  ]);
});
test("archive with an omitted reason, URL archived flag and unarchive", async ({
  page,
}) => {
  await table(page);
  await page.locator('[data-task-key="JB-7"]').click();
  await page.getByRole("button", { name: "Task actions" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Archive task", exact: true })
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(
    page.locator(".notice").filter({ hasText: "Archived ·" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await page.getByRole("switch", { name: "Show archived" }).click();
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Show archived" }),
  ).toBeChecked();
  await expect(page.locator('[data-task-key="JB-7"]')).toHaveClass(/archived/);
  await page.locator('[data-task-key="JB-7"]').click();
  await page.getByRole("button", { name: "Unarchive", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unarchive task", exact: true })
    .getByRole("button", { name: "Unarchive", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeEnabled();
});
test("table keyboard and live events preserve row focus and scroll", async ({
  page,
}) => {
  await table(page);
  const first = page.getByTestId("table-row").first();
  await first.focus();
  await page.keyboard.press("ArrowDown");
  const key = await page
    .locator('[data-testid="table-row"]:focus')
    .getAttribute("data-task-key");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`task=${key}`));
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await expect(page.locator(`[data-task-key="${key}"]`)).toBeFocused();
  const before = await page
    .getByTestId("table-scroll")
    .evaluate((el) => el.scrollTop);
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "task.updated",
      key: "JB-7",
      patch: { priority: "critical" },
    }),
  );
  await expect(page.locator(`[data-task-key="${key}"]`)).toBeFocused();
  expect(
    await page.getByTestId("table-scroll").evaluate((el) => el.scrollTop),
  ).toBe(before);
});

test("drawer header and Save shortcut fit both drawer widths", async ({
  page,
}) => {
  await demo(page);
  await page.locator('[data-key="JB-7"]').click();
  await page
    .getByRole("textbox", { name: "Task title" })
    .fill("A comfortably sized Save button");
  await mkdir("../../docs/media/m4.1", { recursive: true });
  for (const width of [1360, 1100]) {
    await page.setViewportSize({ width, height: 860 });
    const save = page.getByRole("button", { name: /^Save/ });
    await expect(save).toBeEnabled();
    expect(
      await save.evaluate((button) => {
        const a = button.getBoundingClientRect();
        const b = button.querySelector("kbd")?.getBoundingClientRect();
        return (
          button.scrollWidth <= button.clientWidth &&
          !!b &&
          b.right <= a.right &&
          b.left >= a.left
        );
      }),
    ).toBe(true);
    await expect(page.locator(".drawer-heading")).toHaveCSS("height", "56px");
    await expect(
      page
        .locator(".drawer-heading")
        .getByRole("button", { name: "Copy key", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".drawer-heading")
        .getByRole("button", { name: "Task actions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Set due date" }),
    ).toBeVisible();
    await save.screenshot({
      path: `../../.dev-data/save-${width >= 1200 ? 520 : 460}.png`,
    });
  }
});
