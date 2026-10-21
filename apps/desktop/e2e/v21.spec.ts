import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
});
test("Ready, epic colors and review/inbox flags keep the existing board usable", async ({
  page,
}) => {
  await expect(
    page.locator('[data-column="ready"] .column-heading'),
  ).toContainText("Ready");
  await expect(page.locator('[data-key="JB-7"]')).toHaveAttribute(
    "data-color-by",
    "epic",
  );
  await expect(page.locator('[data-key="JB-7"]')).toContainText(
    "Changes requested",
  );
  await expect(page.locator('[data-key="JB-12"]')).toContainText("Needs info");
  await page.getByRole("radio", { name: "None", exact: true }).click();
  await expect(page.locator('[data-key="JB-7"]')).toHaveAttribute(
    "data-color-by",
    "none",
  );
});
test("an incomplete task dropped into Ready rolls back with the not_ready explanation", async ({
  page,
}) => {
  const card = page.getByRole("button", { name: /Open JB-18:/ });
  await card.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("status", { name: "Notifications" }),
  ).toContainText("not_ready");
  await expect(
    page.locator('[data-column="backlog"] [data-key="JB-18"]'),
  ).toBeAttached();
});
test("brief editor and latest report/review coexist with editable Notes", async ({
  page,
}) => {
  await page.goto("/board?task=JB-7");
  await expect(page.getByTestId("task-brief")).toContainText("Boundaries");
  await expect(
    page.getByRole("region", { name: "Latest report" }),
  ).toContainText("FAIL");
  await expect(
    page.getByRole("region", { name: "Latest review" }),
  ).toContainText("Changes requested");
  await expect(page.getByRole("textbox", { name: "Notes" })).toBeEnabled();
});
