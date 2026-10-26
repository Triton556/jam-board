import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { setTheme } from "./assertions";

// Synthetic, actual rendered pages only. The artifact allowlist contains these
// PNGs, never the mock data store, application DB, clipboard or test traces.
for (const theme of ["light", "dark"] as const) {
  test(`RF03 direct sticky paper, optional heading and guarded reopening (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1180, height: 812 });
    await page.goto("/");
    await page.getByRole("button", { name: "Load demo jam" }).click();
    await page.goto("/references");
    await expect(
      page.getByRole("region", { name: "References canvas", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(window.__jamMock && window.__jamCanvas)),
      )
      .toBe(true);
    await setTheme(page, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => document.fonts.ready);
    const initial = await page.evaluate(() =>
      window.__jamMock.referenceCanvas(),
    );
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Note", exact: true }).click();
    await expect(
      page.getByText(/Click the canvas to place a note/),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Note text" })).toHaveCount(
      0,
    );
    const pane = page.locator(".react-flow__pane"),
      bounds = await pane.boundingBox();
    if (!bounds) throw Error("Canvas has no geometry");
    const place = {
      x: bounds.x + bounds.width * 0.6,
      y: bounds.y + bounds.height * 0.62,
    };
    await page.mouse.click(place.x, place.y);
    const paper = page.getByRole("article", { name: "New note paper" });
    const body = paper.getByRole("textbox", { name: "Note text" });
    await expect(body).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(paper.getByRole("button", { name: /^Save/ })).toHaveCount(0);
    await expect(
      paper.getByRole("textbox", { name: "Optional note heading" }),
    ).toHaveCount(0);
    expect(
      (await page.evaluate(() => window.__jamMock.referenceCanvas())).items,
    ).toEqual(initial.items);
    const bodyText =
      "A lantern catches one tiny falling star.\nKeep the silhouette clear.";
    await body.fill(bodyText);
    await expect(paper.getByRole("status")).toHaveText("Saved");
    await expect(body).toBeFocused();
    const created = await page.evaluate(async () =>
      (await window.__jamMock.referenceCanvas()).items.at(-1),
    );
    if (!created) throw Error("No confirmed note");
    expect(created.captionMd).toBe(bodyText);
    expect(created.title).toBe("");
    expect(created.frameId).toBeNull();
    const directory = resolve(process.cwd(), "../../test-visuals");
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: resolve(directory, `sticky-note-body-${theme}.png`),
    });
    // Real caret selection belongs to the note, not the board camera.
    const camera = await page.evaluate(() => window.__jamCanvas?.getViewport());
    await body.press("Home");
    await body.press("Shift+End");
    expect(
      await body.evaluate(
        (element: HTMLTextAreaElement) =>
          element.selectionEnd > element.selectionStart,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__jamCanvas?.getViewport()),
    ).toEqual(camera);
    await body.press("Escape");
    await expect(paper).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Theme", exact: true }),
    ).toContainText(theme === "dark" ? "Dark" : "Light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => document.fonts.ready);
    const persisted = page.locator(`[data-reference-id="${created.id}"]`);
    const edit = persisted.getByRole("button", { name: /^Edit note / });
    await edit.focus();
    await edit.press("Enter");
    const reopenedBody = persisted.getByRole("textbox", { name: "Note text" });
    await expect(reopenedBody).toHaveValue(bodyText);
    await expect(
      persisted.getByRole("textbox", { name: "Optional note heading" }),
    ).toHaveCount(0);
    await persisted.getByRole("button", { name: "Add heading" }).click();
    await persisted
      .getByRole("textbox", { name: "Optional note heading" })
      .fill("Lantern idea");
    await expect(persisted.getByRole("status")).toHaveText("Saved");
    const content = persisted.locator(".reference-content");
    expect(
      await content.evaluate((element) => ({
        left: parseFloat(getComputedStyle(element).paddingLeft),
        right: parseFloat(getComputedStyle(element).paddingRight),
        scrollable: getComputedStyle(element).overflowY,
      })),
    ).toEqual({ left: 12, right: 12, scrollable: "auto" });
    const contentBox = await content.boundingBox(),
      bodyBox = await reopenedBody.boundingBox();
    if (!contentBox || !bodyBox)
      throw Error("Saved note editor has no geometry");
    expect(bodyBox.x - contentBox.x).toBeGreaterThanOrEqual(11.5);
    expect(
      contentBox.x + contentBox.width - bodyBox.x - bodyBox.width,
    ).toBeGreaterThanOrEqual(11.5);
    await page.screenshot({
      path: resolve(directory, `sticky-note-heading-${theme}.png`),
    });
    await reopenedBody.focus();
    await page.keyboard.press("Escape");
    await expect(reopenedBody).toHaveCount(0);
    const saved = page.locator(`[data-reference-id="${created.id}"]`);
    const editSaved = saved.getByRole("button", {
      name: "Edit note Lantern idea",
    });
    await editSaved.focus();
    await editSaved.press("Enter");
    const reopened = saved.getByRole("textbox", { name: "Note text" });
    await expect(reopened).toBeFocused();
    await expect(reopened).toHaveValue(bodyText);
    await reopened.fill(`${bodyText}\nOne readable result, not a form.`);
    await expect(saved.getByRole("status")).toHaveText("Saved");
    await expect(saved.getByRole("status")).toBeInViewport();
    await page.screenshot({
      path: resolve(directory, `sticky-note-reopened-${theme}.png`),
    });
    const calls = await page.evaluate(() =>
      window.__jamMock.calls.filter(
        (call) => call.command === "update_reference",
      ),
    );
    expect(calls.at(-1)?.input).toMatchObject({
      itemId: created.id,
      expected: { title: "Lantern idea", caption: bodyText },
    });
    expect(
      (await page.evaluate(() => window.__jamMock.referenceCanvas())).items,
    ).toHaveLength(initial.items.length + 1);
    await page.keyboard.press("Escape");
    // Return to the board is real pointer behavior, not a source-class assertion.
    const beforePan = await page.evaluate(() =>
      window.__jamCanvas?.getViewport(),
    );
    await page.mouse.move(bounds.x + 45, bounds.y + bounds.height - 80);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 105, bounds.y + bounds.height - 55, {
      steps: 8,
    });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.__jamCanvas?.getViewport()))
      .not.toEqual(beforePan);
  });
}
