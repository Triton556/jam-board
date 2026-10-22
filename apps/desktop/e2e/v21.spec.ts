import { expect, test } from "@playwright/test";
import { expectPoliteNotice } from "./assertions";

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
test("an incomplete task dropped into Ready remains in Backlog with the not_ready explanation", async ({
  page,
}) => {
  const before = await page.evaluate(() => window.__jamMock.getTask("JB-18"));
  const card = page.getByRole("button", { name: /Open JB-18:/ });
  const target = page.locator('[data-column="ready"] .column-heading');
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox(),
    to = await target.boundingBox();
  if (!from || !to) throw new Error("Missing pointer drag geometry");
  await page.mouse.move(from.x + 80, from.y + 60);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 60, { steps: 3 });
  await page.mouse.move(to.x + 80, to.y + 60, { steps: 15 });
  await page.mouse.up();
  await expectPoliteNotice(page, "not_ready");
  await expect(
    page.locator('[data-column="backlog"] [data-key="JB-18"]'),
  ).toBeAttached();
  expect(await page.evaluate(() => window.__jamMock.getTask("JB-18"))).toEqual(
    before,
  );
  const moves = await page.evaluate(() =>
    window.__jamMock.calls.filter((call) => call.command === "move_task"),
  );
  expect(moves).toHaveLength(1);
  expect(moves[0]?.input).toMatchObject({
    key: "JB-18",
    status: "ready",
    expectedUpdatedAt: before.updatedAt,
  });
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
