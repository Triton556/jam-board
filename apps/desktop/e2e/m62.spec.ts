import { expect, test } from "@playwright/test";
import { setTheme } from "./assertions";

async function demo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
}
test("flat cards, assignee colors and opt-in estimates", async ({ page }) => {
  await demo(page);
  await expect(page.getByTestId("task-card").first()).toHaveCSS(
    "transform",
    "none",
  );
  await expect(page.locator(".estimate")).toHaveCount(0);
  const first = page
    .getByTestId("task-card")
    .filter({ has: page.locator(".card-assignee") })
    .first();
  const paper = await first
    .locator(".task-card")
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  await page
    .getByRole("radiogroup", { name: "Color by", exact: true })
    .getByRole("radio", { name: "Assignee" })
    .click();
  await expect
    .poll(() =>
      first
        .locator(".task-card")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
    )
    .not.toBe(paper);
  for (const [theme, percent] of [
    ["light", 14],
    ["dark", 16],
  ] as const) {
    await setTheme(page, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(
      await first.evaluate((e, percent) => {
        const probe = document.createElement("div");
        const color = getComputedStyle(e).getPropertyValue("--assignee-color");
        probe.style.background = `color-mix(in srgb, ${color} ${percent}%, var(--card))`;
        e.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        const actual = getComputedStyle(
          e.querySelector(".task-card") as Element,
        ).backgroundColor;
        probe.remove();
        return actual === expected;
      }, percent),
    ).toBe(true);
  }
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "task.created",
      title: "Flat arrival",
    }),
  );
  const card = page
    .getByTestId("task-card")
    .filter({ hasText: "Flat arrival" });
  await expect(card).toHaveCSS("transform", "none", { timeout: 5000 });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("switch", { name: "Story point estimates" }).click();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(page.locator(".estimate").first()).toBeVisible();
});
test("table inline creation stays visible outside filters", async ({
  page,
}) => {
  await demo(page);
  await page.goto("/table?status=done");
  await page
    .getByRole("button", { name: "+ New task", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "New task title" })
    .fill("New filtered lantern");
  await page.getByRole("combobox", { name: "New task story" }).click();
  await page.getByRole("option", { name: /JB-S1/ }).click();
  await page.getByRole("textbox", { name: "New task title" }).press("Enter");
  await expect(
    page.getByTestId("table-row").filter({ hasText: "New filtered lantern" }),
  ).toContainText("hidden by filters");
});
test("task attach files adds assets and comment hint fits both drawer widths", async ({
  page,
}) => {
  await demo(page);
  await page.goto("/board?task=JB-7");
  await page.getByRole("button", { name: "Attach file…" }).click();
  await expect(
    page.locator(".linked-asset").filter({ hasText: "C:/JamBoard/jump.wav" }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.__jamMock.simulateFileDrop(["C:/JamBoard/attached-snow.png"]),
  );
  await expect(
    page
      .locator(".linked-asset")
      .filter({ hasText: "C:/JamBoard/attached-snow.png" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Write a comment" })
    .fill("Ready to share a note.");
  for (const width of [1360, 1190]) {
    await page.setViewportSize({ width, height: 860 });
    const button = page.getByRole("button", { name: /Add comment/ });
    await button.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    await expect(button).toBeEnabled();
    await expect
      .poll(() =>
        button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            ),
          );
        }),
      )
      .toBe(true);
    expect(await button.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await button.screenshot({ path: `../../.dev-data/comment-${width}.png` });
  }
  await page.getByRole("button", { name: "Close task", exact: true }).click();
  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "jump", exact: true }),
  ).toBeVisible();
});
test("500 assets support grouped grid and bounded virtual list", async ({
  page,
}) => {
  await demo(page);
  await page.evaluate(() => window.__jamMock.seed_bulk_assets(500));
  await page.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.locator(".asset-card")).toHaveCount(508);
  await page.getByRole("radio", { name: "List view" }).click();
  const scroll = page.getByTestId("asset-list");
  await expect(scroll).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await scroll.evaluate((e, i) => {
      e.scrollTop = i * 4000;
    }, i);
    await page.waitForTimeout(50);
    expect(
      await page.getByTestId("asset-list-row").count(),
    ).toBeLessThanOrEqual(60);
  }
  await page.getByRole("button", { name: "Name", exact: true }).click();
});
