import path from "node:path";
import { expect, test } from "@playwright/test";

// Hosted component evidence only. G must additionally exercise the production route/mounts.
const fixture = "/src/features/files/visual-harness.html";
test("R12-F offline PNG, WAV and WEBM fixtures decode in the browser", async ({
  page,
}) => {
  await page.goto(fixture);
  const decoded = await page.evaluate(async () => {
    const fixtureModule = "/src/features/files/mock-preview-fixtures.ts";
    const { imageFixture, audioFixture, videoFixture } = await import(
      fixtureModule
    );
    const image = new Image();
    image.src = imageFixture;
    await image.decode();
    const audio = document.createElement("audio"),
      video = document.createElement("video");
    async function load(element: HTMLMediaElement, src: string) {
      await new Promise<void>((resolve, reject) => {
        element.onloadeddata = () => resolve();
        element.onerror = () =>
          reject(new Error(element.error?.message ?? "Media decode failed"));
        element.src = src;
        element.load();
      });
    }
    await load(audio, audioFixture);
    await load(video, videoFixture);
    return {
      imageWidth: image.naturalWidth,
      audioDuration: audio.duration,
      videoWidth: video.videoWidth,
    };
  });
  expect(decoded).toEqual({
    imageWidth: 320,
    audioDuration: 0.25,
    videoWidth: 32,
  });
});
test("R12-F Markdown from project documents, Source, Escape and focus return", async ({
  page,
}) => {
  await page.goto(fixture);
  const chip = page.getByRole("button", {
    name: "Project-plan.md",
    exact: true,
  });
  await chip.click();
  await expect(
    page.getByRole("heading", { name: "Project plan", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2.1 KB · Modified 31 Oct", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".file-usage-list button").filter({ hasText: /^JB-E1 · / }),
  ).toBeVisible();
  const scopeLabels = await page
    .locator(".file-usage-list button")
    .allTextContents();
  expect(
    scopeLabels.some(
      (label) => /^JB-E1 · .+/.test(label) && label !== "JB-E1 · JB-E1",
    ),
  ).toBe(true);
  expect(
    scopeLabels.some(
      (label) => /^JB-S1 · .+/.test(label) && label !== "JB-S1 · JB-S1",
    ),
  ).toBe(true);
  const titleBox = await page
    .getByRole("heading", { name: "Used in", exact: true })
    .boundingBox();
  const firstGroupBox = await page
    .locator(".file-usage-list h4")
    .first()
    .boundingBox();
  if (!titleBox || !firstGroupBox)
    throw new Error("Usage headings must be visible");
  expect(firstGroupBox.y - titleBox.y - titleBox.height).toBeGreaterThanOrEqual(
    12,
  );
  const more = page.getByRole("button", { name: "More file actions" });
  await more.click();
  await expect(
    page.getByRole("button", { name: "Archive", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(more).toBeFocused();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".file-text pre")).toContainText("# Project plan");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(chip).toBeFocused();
});
test("R12-F used delete lists usage and requires explicit link removal", async ({
  page,
}) => {
  await page.goto(`${fixture}?scene=viewer-markdown`);
  await page.getByRole("button", { name: "More file actions" }).click();
  await page.getByRole("button", { name: "Delete…", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete Project-plan.md?",
    exact: true,
  });
  await expect(dialog.getByText("Used in 3 places")).toBeVisible();
  await expect(dialog.getByText("JB-E1", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Remove links and delete" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Project-plan.md", exact: true }),
  ).toHaveCount(0);
});
test("R12-F replace shows revision 2 and previous revision in History", async ({
  page,
}) => {
  await page.goto(`${fixture}?scene=viewer-markdown`);
  await page.getByRole("button", { name: "Replace…", exact: true }).click();
  await page.getByRole("button", { name: "Choose replacement…" }).click();
  await expect(
    page.getByText(
      "Replace with Project-plan-v2.md? The current version is kept in History.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByText("Revision 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Revision 1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .getByRole("button", { name: "Show in folder", exact: true })
    .last()
    .click();
});
test("R12-F Assets card background and list row open the viewer", async ({
  page,
}) => {
  await page.goto(`${fixture}?scene=assets-filters`);
  const card = page.locator(".asset-card").filter({
    has: page.getByRole("button", { name: "Project-plan.md", exact: true }),
  });
  await card.locator(".asset-notes").click();
  await expect(
    page.getByRole("dialog", { name: "Project-plan.md", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "List view" }).click();
  const row = page.getByTestId("asset-list-row").filter({
    has: page.getByRole("button", { name: "Project-plan.md", exact: true }),
  });
  await row.locator("td").nth(3).click();
  await expect(
    page.getByRole("dialog", { name: "Project-plan.md", exact: true }),
  ).toBeVisible();
});
for (const variant of [
  { name: "1440-light", width: 1440, dark: false },
  { name: "1440-dark", width: 1440, dark: true },
  { name: "1000-light", width: 1000, dark: false },
  { name: "375-light", width: 375, dark: false },
]) {
  test(`R12-F visual matrix ${variant.name}`, async ({ page }) => {
    await page.setViewportSize({ width: variant.width, height: 1000 });
    await page.addInitScript((dark) => {
      localStorage.clear();
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    }, variant.dark);
    const scenes =
      process.env.JAM_FILES_FIX1 === "1"
        ? ["viewer-markdown", "viewer-image"]
        : [
            "viewer-markdown",
            "viewer-image",
            "delete-used",
            "plan-documents",
            "assets-filters",
          ];
    for (const scene of scenes) {
      await page.goto(`${fixture}?scene=${scene}`);
      await page.evaluate((dark) => {
        document.documentElement.dataset.theme = dark ? "dark" : "light";
      }, variant.dark);
      if (scene.startsWith("viewer") || scene === "delete-used")
        await expect(page.getByRole("dialog").first()).toBeVisible();
      if (scene === "viewer-markdown" || scene === "delete-used")
        await expect(
          page.getByRole("heading", { name: "Project plan", exact: true }),
        ).toBeVisible();
      if (scene === "viewer-image")
        await expect(
          page.getByRole("img", { name: "Landscape.png" }),
        ).toBeVisible();
      if (scene === "delete-used") {
        await page.getByRole("button", { name: "More file actions" }).click();
        await page
          .getByRole("button", { name: "Delete…", exact: true })
          .click();
        await expect(page.getByText("Used in 3 places")).toBeVisible();
      }
      if (scene === "plan-documents")
        await expect(
          page.getByRole("button", { name: "Project-plan.md", exact: true }),
        ).toBeVisible();
      if (scene === "assets-filters") {
        await page.getByRole("combobox", { name: "Linked to" }).click();
        await page
          .getByRole("option", { name: "Project", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Project-plan.md", exact: true }),
        ).toBeVisible();
        await page.getByRole("checkbox", { name: "Show archived" }).check();
        await expect(
          page.getByRole("button", { name: "Archived-design.md", exact: true }),
        ).toBeVisible();
      }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: path.resolve(
          `${process.env.JAM_R12_EVIDENCE_DIR ?? "../../test-visuals/round12/R12-F"}/${process.env.JAM_FILES_FIX1 === "1" ? "fix1/" : ""}${scene}-${variant.name}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    }
  });
}
