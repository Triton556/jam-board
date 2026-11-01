import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const fix1 = process.env.JAM_R12_P_FIX1 === "1";
const output = resolve(
  process.cwd(),
  process.env.JAM_R12_EVIDENCE_DIR ?? "../../test-visuals/round12/R12-P",
  fix1 ? "fix1" : ".",
);
let markdown =
  "# Demo plan {#demo}\n## Demo story {#demo/story}\n- File wording {#demo/conflict}\n- A new task {#demo/new}";
async function fixture(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  markdown = await page.evaluate(async () => {
    const tree = await window.__jamMock.getEpic("JB-E1");
    const story = tree.stories.find(
      (row) => row.story.externalRef === "demo/story",
    )?.story;
    if (!story) throw new Error("Missing shared import fixture");
    return `# ${tree.epic.title} {#demo}\n${tree.epic.goalMd}\n## ${story.title} {#demo/story}\n${story.outcomeMd}\n- File wording {#demo/conflict}\n- A new task {#demo/new}`;
  });
  await page.goto("/plan/JB-E1");
  await expect(page.getByRole("textbox", { name: "Epic title" })).toBeVisible();
}
async function preview(page: Page) {
  await page.getByLabel("Plan menu").click();
  await page.getByRole("button", { name: "Import plan…", exact: true }).click();
  await page.getByLabel("Plan file", { exact: true }).setInputFiles({
    name: "plan.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(markdown),
  });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText("Conflicts (1)")).toBeVisible();
}

// Full shared-board integration: G must connect mock-import state to the inventory.
test("imports Markdown with a conflict, Use file, Apply, Undo", async ({
  page,
}) => {
  await fixture(page);
  await preview(page);
  await page.getByRole("radio", { name: "Use file" }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/Imported:/)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__jamMock
          .fileInventory()
          .tasks.some(
            (task) => task.title === "A new task" && !task.archivedAt,
          ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByText(/Import undone\. \d+ undone, 0 kept\./),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__jamMock
          .fileInventory()
          .tasks.some(
            (task) => task.title === "A new task" && !task.archivedAt,
          ),
      ),
    )
    .toBe(false);
});
test("moves a story to another epic and preserves its key", async ({
  page,
}) => {
  await fixture(page);
  // Use a disposable planned story, so the demo's active work is untouched.
  const story = await page.evaluate(async () =>
    window.__jamMock.createStory({ epicKey: "JB-E1", title: "Move fixture" }),
  );
  await page.goto(`/plan/JB-E1?story=${story.key}`);
  await page.getByLabel("Story menu").click();
  await page.getByRole("button", { name: "Move to epic…" }).click();
  const dialog = page.getByRole("dialog", { name: "Move to epic" });
  await dialog.getByRole("textbox", { name: "Search epics" }).fill("JB-E2");
  await dialog.getByRole("button", { name: /JB-E2/ }).click();
  await expect(page.getByText("Moved to JB-E2")).toBeVisible();
  expect(
    await page.evaluate(
      async (key) => (await window.__jamMock.getStory(key)).story.key,
      story.key,
    ),
  ).toBe(story.key);
  expect(
    await page.evaluate(async (key) => {
      const moved = (await window.__jamMock.getStory(key)).story;
      const destination = (await window.__jamMock.listEpics()).find(
        (epic) => epic.key === "JB-E2",
      );
      return moved.epicId === destination?.id;
    }, story.key),
  ).toBe(true);
});

for (const variant of [
  { name: "1440-light", width: 1440, theme: "light" },
  { name: "1440-dark", width: 1440, theme: "dark" },
  { name: "1000-light", width: 1000, theme: "light" },
  { name: "375-light", width: 375, theme: "light" },
] as const) {
  test(`visual ${variant.name}: preview, result, palette, story picker`, async ({
    page,
  }) => {
    await mkdir(output, { recursive: true });
    await page.setViewportSize({ width: variant.width, height: 900 });
    await fixture(page);
    await page.evaluate(
      async (theme) => window.__jamMock.setTheme(theme),
      variant.theme,
    );
    await page.reload();
    await preview(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      animations: "disabled",
      path: resolve(output, `import-preview-${variant.name}.png`),
    });
    await page.getByRole("radio", { name: "Use file" }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText(/Imported:/)).toBeVisible();
    if (!fix1)
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, `import-result-${variant.name}.png`),
      });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "New epic", exact: true }).click();
    await expect(
      page
        .getByRole("dialog", { name: "New epic" })
        .getByRole("button", { name: "Color 6", exact: true }),
    ).toBeVisible();
    if (!fix1)
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, `epic-palette-${variant.name}.png`),
      });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const story = await page.evaluate(async () =>
      window.__jamMock.createStory({ epicKey: "JB-E1", title: "Move fixture" }),
    );
    await page.goto(`/plan/JB-E1?story=${story.key}`);
    await page.getByLabel("Story menu").click();
    await page.getByRole("button", { name: "Move to epic…" }).click();
    await expect(
      page.getByRole("dialog", { name: "Move to epic" }),
    ).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      path: resolve(output, `move-story-${variant.name}.png`),
    });
    const dialog = page.getByRole("dialog", { name: "Move to epic" });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  });
}
