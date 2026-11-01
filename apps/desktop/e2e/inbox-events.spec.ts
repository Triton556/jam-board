import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const evidence = resolve(
  process.cwd(),
  process.env.JAM_R12_EVIDENCE_DIR ?? "../../test-visuals/round12/R12-I",
);
async function alignedColumn(page: Page, tab: "events" | "questions") {
  const frame = await page.locator(".inbox-scroll").boundingBox();
  if (!frame) throw new Error("Missing Inbox content column");
  for (const selector of [
    ".inbox-page > .page-heading",
    ".inbox-tabs",
    ".inbox-page h1",
    ".inbox-page .hand-note",
    '[role="radiogroup"][aria-label="Inbox tabs"]',
    ...(tab === "events"
      ? [
          '[role="radiogroup"][aria-label="Event filter"]',
          ".inbox-events",
          ".inbox-event",
        ]
      : [".inbox-questions", ".question-groups", ".question-card"]),
  ]) {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`Missing column element: ${selector}`);
    expect(Math.abs(box.x - frame.x), selector).toBeLessThanOrEqual(1);
    if (
      selector === ".inbox-page > .page-heading" ||
      selector === ".inbox-tabs"
    )
      expect(
        Math.abs(box.width - frame.width),
        `${selector} width`,
      ).toBeLessThanOrEqual(1);
  }
  expect(frame.width).toBeLessThanOrEqual(900);
  expect(
    await page
      .locator(".inbox-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
async function demo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await expect(page.getByTestId("task-card").first()).toBeVisible();
  await page.goto("/inbox?tab=events");
  await expect(
    page.getByRole("button", { name: "Claude added 40 references" }),
  ).toBeVisible();
}
test("Inbox Events groups, filters, opens Review and marks seen without clearing open actions", async ({
  page,
}) => {
  await demo(page);
  await expect(page.getByRole("radio", { name: /^Events/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.getByText("Claude added 40 references", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("radio", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".inbox-event.is-unread")).toHaveCount(0);
  await expect(page.locator(".top-inbox .inbox-badge")).toHaveAttribute(
    "aria-label",
    "5 open inbox items",
  );
  await page.getByRole("radio", { name: "Needs action 3" }).click();
  await expect(
    page.getByText("Claude added 40 references", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("article", { name: /Codex submitted a report for JB-2/ })
      .getByText("Done", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("article", { name: /Codex submitted a report for JB-1/ })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await expect(page).toHaveURL(/\/board\?task=JB-1/);
  await expect(page.getByRole("dialog", { name: /JB-1/ })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("radio", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".top-inbox .inbox-badge")).toHaveAttribute(
    "aria-label",
    "5 open inbox items",
  );
});

const variants = [
  { name: "1440-light", width: 1440, theme: "light" },
  { name: "1440-dark", width: 1440, theme: "dark" },
  { name: "1000-light", width: 1000, theme: "light" },
  { name: "375-light", width: 375, theme: "light" },
] as const;
for (const variant of variants) {
  test(`Events visual states ${variant.name}`, async ({ page }) => {
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({
      width: variant.width,
      height: variant.width === 375 ? 1840 : 1440,
    });
    await demo(page);
    // Freeze only after source-app startup (its mock latency uses timers).
    // Advance query notifications explicitly without reaching mark-seen's second.
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.clock.runFor(200);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, variant.theme);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".inbox-event.is-unread").first()).toBeVisible();
    await alignedColumn(page, "events");
    const eventsWidth = await page
      .locator(".inbox-events")
      .evaluate((element) => element.getBoundingClientRect().width);
    await page.screenshot({
      path: resolve(evidence, `inbox-events-${variant.name}.png`),
    });
    await page.getByRole("radio", { name: "Needs action 3" }).click();
    await page.clock.runFor(100);
    await expect(
      page
        .getByRole("article", { name: /Codex submitted a report for JB-1/ })
        .getByRole("button", { name: "Review", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: resolve(evidence, `inbox-needs-action-${variant.name}.png`),
    });
    await alignedColumn(page, "events");
    await page.getByRole("radio", { name: /^Questions/ }).click();
    await page.clock.runFor(100);
    await expect(
      page
        .getByRole("textbox", { name: "Or answer in your own words" })
        .first(),
    ).toBeVisible();
    await alignedColumn(page, "questions");
    const questionsWidth = await page
      .locator(".inbox-questions")
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.abs(questionsWidth - eventsWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: resolve(evidence, `inbox-questions-${variant.name}.png`),
    });
    const answer = page
      .getByRole("textbox", { name: "Or answer in your own words" })
      .first();
    await answer.fill("Keep this unsent draft across tabs");
    await page.getByRole("radio", { name: /^Events/ }).click();
    await page.clock.runFor(100);
    await page.getByRole("radio", { name: /^Questions/ }).click();
    await page.clock.runFor(100);
    await expect(answer).toHaveValue("Keep this unsent draft across tabs");
    await page.getByRole("radio", { name: /^Events/ }).click();
    await page.clock.runFor(100);
    // Reset only this package's fictional in-memory state, then request an
    // uncached filter. No owner data or production bridge is involved.
    await page.evaluate(async () => {
      const modulePath = "/src/lib/mock-inbox-events.ts";
      const mock = await import(/* @vite-ignore */ modulePath);
      mock.resetMockInboxEvents([]);
      window.__jamMock.emit([]);
    });
    await page.clock.runFor(100);
    await page.getByRole("radio", { name: "All", exact: true }).click();
    await page.clock.runFor(100);
    await expect(
      page.getByText("No events yet", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Events", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Needs action 0" }),
    ).toBeVisible();
    await page.screenshot({
      path: resolve(evidence, `inbox-events-empty-${variant.name}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
