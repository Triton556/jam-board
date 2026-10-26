import { expect, type Locator, type Page } from "@playwright/test";

/** Compact presence copy truncates by whole words; its tooltip retains all text. */
export async function expectWorkingText(
  page: Page,
  line: Locator,
  text: string,
) {
  await line.locator(".tooltip-wrap").hover();
  await expect(page.getByRole("tooltip")).toContainText(text);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toBeHidden();
}

/** Readable columns may scroll; both keyboard access and overflow cues are required. */
export async function expectBoardReachable(page: Page) {
  const board = page.getByRole("region", { name: "Board columns" });
  await expect(page.locator(".board-column")).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (
    await board.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    )
  ) {
    await expect(
      page.getByRole("button", { name: "Scroll columns right" }),
    ).toBeVisible();
    await board.focus();
    await page.keyboard.press("End");
    await expect(page.locator('[data-column="done"]')).toBeInViewport();
    await page.keyboard.press("Home");
    await expect(page.locator('[data-column="backlog"]')).toBeInViewport();
  }
}

/** Theme is a custom accessible select, shared by the top bar and settings. */
export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.getByRole("combobox", { name: "Theme", exact: true }).click();
  await page
    .getByRole("option", {
      name: theme === "dark" ? "Dark" : "Light",
      exact: true,
    })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** External MCP setup is deliberately collapsed beneath Brain dock connections. */
export async function openExternalAgents(page: Page) {
  const details = page.locator("details.external-agents");
  if (!(await details.evaluate((element) => element.hasAttribute("open"))))
    await details.locator(":scope > summary").click();
  await expect(details).toHaveAttribute("open", "");
}

/** Prose is readable content, not part of the separate Edit control. */
export function markdownReadView(page: Page, label: string) {
  return page
    .locator(".markdown-field")
    .filter({
      has: page.getByRole("button", { name: `Edit ${label}`, exact: true }),
    })
    .locator(".markdown-field-view");
}

/** Only the concise notice summary is live, not its optional details/actions. */
export async function expectPoliteNotice(page: Page, text: string) {
  const summary = page
    .getByRole("region", { name: "Notifications", exact: true })
    .getByRole("status")
    .filter({ hasText: text });
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("aria-live", "polite");
  await expect(summary).toContainText(text);
}

/** Open the human-first inspection layer explicitly, retaining its actual controls. */
export async function openAgentPlan(page: Page) {
  const plan = page.getByRole("dialog").locator("details.agent-plan");
  await expect(plan).toBeVisible();
  if (!(await plan.evaluate((element) => element.hasAttribute("open"))))
    await plan.locator(":scope > summary").click();
  await expect(plan).toHaveAttribute("open", "");
}
