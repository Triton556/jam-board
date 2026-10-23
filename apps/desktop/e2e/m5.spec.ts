import { expect, test } from "@playwright/test";

async function demo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
}
test("URL asset can be linked from Assets and appears in the task panel", async ({
  page,
}) => {
  await demo(page);
  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await page.getByRole("button", { name: "Add asset", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add asset" });
  await dialog.getByRole("tab", { name: "URL" }).click();
  await dialog
    .getByLabel("Asset location")
    .fill("https://example.invalid/player.png");
  await dialog.getByLabel("Name", { exact: true }).fill("Test player sprite");
  await dialog.getByRole("button", { name: "Save asset" }).click();
  const card = page
    .locator(".asset-card")
    .filter({ has: page.getByRole("heading", { name: "Test player sprite" }) });
  await card
    .getByRole("button", { name: "Menu for Test player sprite" })
    .click();
  await card.getByRole("button", { name: "Link to task…" }).click();
  await page.getByRole("option", { name: /^JB-1 ·/ }).click();
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await card.getByRole("button", { name: "JB-1", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Test player sprite", { exact: true }),
  ).toBeVisible();
});
test("Team adds a human and edits their color", async ({ page }) => {
  await demo(page);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await page.getByRole("button", { name: "Add human" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Sam");
  await page.getByRole("button", { name: "Color 3" }).click();
  await page.getByRole("button", { name: "Save teammate" }).click();
  await expect(
    page.getByRole("heading", { name: "Sam", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Sam", exact: true }).click();
  await page.getByRole("button", { name: "Color 5" }).click();
  await page.getByRole("button", { name: "Save teammate" }).click();
  const sam = await page.evaluate(async () =>
    (await window.__jamMock.listMembers()).find((m) => m.name === "Sam"),
  );
  expect(sam?.color).toBe("#F07E5F");
});
test("Activity filters agents, loads earlier events and holds new events while reading", async ({
  page,
}) => {
  await demo(page);
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  const scroll = page.getByTestId("activity-scroll");
  await expect(page.locator(".activity-entry")).toHaveCount(30);
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator(".activity-entry")).toHaveCount(60);
  await page.evaluate(async () => {
    for (let i = 0; i < 15; i++)
      await window.__jamMock.simulateAgent({
        action: "comment.added",
        key: "JB-1",
      });
  });
  await page.getByRole("radio", { name: "Agents", exact: true }).click();
  await expect
    .poll(() => page.locator(".activity-entry").count())
    .toBeGreaterThan(0);
  await scroll.evaluate((el) => {
    el.scrollTop = 300;
  });
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "task.created",
      title: "An activity test task",
    }),
  );
  await expect(
    page.getByRole("button", { name: "1 new update ↑" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "1 new update ↑" }).click();
  await expect(
    page
      .locator(".activity-entry")
      .filter({ hasText: "An activity test task" }),
  ).toBeVisible();
});
test("MCP config display is masked, Copy includes token, regeneration is confirmed", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await demo(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.getByRole("tab", { name: "Claude Code · HTTP" }).click();
  const captured = await page.evaluate(() => window.__jamMock.appState());
  const token = await page.evaluate(() => window.__jamMock.revealMcpToken());
  await expect(page.locator(".code-block").first()).not.toContainText(token);
  await page
    .locator(".code-block")
    .first()
    .getByRole("button", { name: "Copy", exact: true })
    .click();
  const configuration = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(configuration).toContain(token);
  expect(configuration).toContain(captured.jam?.id ?? "missing project");
  const receipt = page
    .getByRole("status")
    .and(page.locator(".settings-notice"));
  await expect(receipt).toBeVisible();
  // This page-local status has implicit polite live semantics, not a toast.
  await expect(receipt).toHaveText(
    `Configuration copied for ${captured.jam?.name} · ${captured.jam?.keyPrefix} (includes your token; keep it private)`,
  );
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(
    page.getByText("Existing HTTP connections will stop working."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Regenerate token", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__jamMock.revealMcpToken()))
    .not.toBe(token);
});
test("Archiving a project requires idle workers and its exact name, and keeps a restorable archive", async ({
  page,
}) => {
  await demo(page);
  await page.evaluate(async () => {
    const tasks = await window.__jamMock.listBoardTasks();
    for (const task of tasks.in_progress)
      await window.__jamMock.moveTask({
        key: task.key,
        status: "backlog",
        expectedUpdatedAt: task.updatedAt,
      });
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page
    .getByRole("button", { name: "Archive this project", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("Project name").fill("cozy jam 48");
  await expect(
    page.getByRole("button", { name: "Archive project", exact: true }),
  ).toBeDisabled();
  await page.getByRole("dialog").getByLabel("Project name").fill("Cozy Jam 48");
  await page
    .getByRole("button", { name: "Archive project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What are we making?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
});
test("Export and Import round-trip through the mock temporary snapshot", async ({
  page,
}) => {
  await demo(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("button", { name: "Export JSON" }).click();
  await expect(
    page.getByText("Exported to mock://jam-export.json"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import JSON" }).click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
  await expect(page.locator('[data-key="JB2-1"]')).toBeVisible();
});
