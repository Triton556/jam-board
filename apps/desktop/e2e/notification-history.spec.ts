// NT01 hosted-browser scenarios. Added/typechecked; NOT RUN in cloud lane.
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`NT01 ${theme}: expired toast remains in bell, keyboard return and exact View`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Load demo jam", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption(theme);
    await page.evaluate(() =>
      window.__jamMock.simulateAgent({
        action: "task.created",
        title: "Notification history fictional target",
        status: "backlog",
      }),
    );
    await expect(
      page
        .locator(".toast")
        .filter({ hasText: "Notification history fictional target" }),
    ).toBeHidden({ timeout: 10000 });
    const bell = page.getByRole("button", { name: /^Project notifications/ });
    await bell.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Project notifications",
      exact: true,
    });
    const row = dialog
      .locator("li")
      .filter({ hasText: "Notification history fictional target" });
    await expect(row).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`notification-history-${theme}-open.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(bell).toBeFocused();
    await bell.click();
    await row.getByRole("button", { name: /^View:/ }).click();
    await expect(
      page.getByRole("textbox", { name: "Task title", exact: true }),
    ).toHaveValue("Notification history fictional target");
  });
}
