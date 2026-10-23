import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
  await page.evaluate(() => document.fonts.ready);
});
test("Board and Table share an identical New task button", async ({ page }) => {
  const read = () =>
    page.locator(".new-task-button").evaluate((e) => {
      const style = getComputedStyle(e);
      return {
        font: style.font,
        height: style.height,
        background: style.backgroundColor,
        icon: e.querySelector("svg")?.getAttribute("width"),
        hint: e.querySelector("kbd")?.textContent,
      };
    });
  const board = await read();
  expect(board.height).toBe("40px");
  expect(board.icon).toBe("16");
  expect(board.hint).toBe("N");
  await page.getByRole("link", { name: "Table", exact: true }).click();
  await expect(page.locator(".new-task-button")).toBeVisible();
  expect(await read()).toEqual(board);
});
test("filter controls keep their boxes for archived and status changes", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Table", exact: true }).click();
  await expect(page.locator(".task-table")).toBeVisible();
  const boxes = () =>
    page.locator(".table-filters").evaluate((e) =>
      Array.from(
        e.querySelectorAll(
          ".table-search, .status-filters button, .custom-select, .tag-control, .switch-label",
        ),
      ).map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
  const before = await boxes();
  expect(before.length).toBeGreaterThanOrEqual(9);
  await expect(page.locator(".table-filters > .button")).toHaveCSS(
    "visibility",
    "hidden",
  );
  await page.getByRole("switch", { name: "Show archived" }).click();
  await expect(page).toHaveURL(/archived=1/);
  expect(await boxes()).toEqual(before);
  await page
    .getByRole("group", { name: "Filter statuses" })
    .getByRole("button", { name: "Ready", exact: true })
    .click();
  await expect(page).toHaveURL(/status=ready/);
  expect(await boxes()).toEqual(before);
});
test("settings share aligned rows, responsive stacking and board synchronization", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  for (const section of [
    "Project",
    "Board",
    "Appearance",
    "About",
    "Agents",
    "Data",
  ]) {
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: section, exact: true })
      .click();
    const rows = await page.locator(".settings-form-row").evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node
          .querySelector(".settings-row-label")
          ?.getBoundingClientRect().x,
        control: node
          .querySelector(".settings-row-control")
          ?.getBoundingClientRect().x,
      })),
    );
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((r) => r.label)).size).toBe(1);
    expect(new Set(rows.map((r) => r.control)).size).toBe(1);
    if (section === "About") {
      const edges = await page
        .locator(".settings-row-control")
        .evaluateAll((nodes) =>
          nodes.map(
            (n) =>
              n.firstElementChild?.getBoundingClientRect().x ??
              n.getBoundingClientRect().x,
          ),
        );
      expect(new Set(edges).size).toBe(1);
    }
  }
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Board", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Board color by" }).click();
  await page.getByRole("option", { name: "Assignee", exact: true }).click();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "Assignee", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Board", exact: true })
    .click();
  await page.setViewportSize({ width: 860, height: 860 });
  const row = page.locator(".settings-form-row").first();
  expect(
    await row.evaluate((e) => {
      const control = e.querySelector(".settings-row-control"),
        label = e.querySelector(".settings-row-label");
      if (!control || !label)
        throw new Error("Missing settings row control or label");
      return (
        control.getBoundingClientRect().y > label.getBoundingClientRect().y
      );
    }),
  ).toBe(true);
});
test("mouse actions leave no focus ring while keyboard focus stays visible", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const sample = page.getByRole("button", { name: "Play sample" });
  await sample.click();
  await expect(sample).toHaveCSS("outline-style", "none");
  await expect(page.getByRole("switch", { name: "Sounds" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(sample).toBeFocused();
  await expect(sample).toHaveCSS("outline-style", "solid");
  const theme = page
    .locator(".theme-previews button")
    .filter({ hasText: "Dark" });
  await theme.click();
  await expect(theme).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(theme).toBeFocused();
  await expect(theme).toHaveCSS("outline-style", "solid");
});
