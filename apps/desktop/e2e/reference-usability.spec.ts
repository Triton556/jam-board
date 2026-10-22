import { expect, test } from "@playwright/test";

// RF01–RF03: executable browser scenarios. Native rendering remains separate.
test("RF01/RF02 frame-only canvas has no empty art and a visible movable grip at four zoom levels", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await page.goto("/references");
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Mood frame");
  await page.getByRole("button", { name: "Create frame", exact: true }).click();
  await expect(
    page.getByText("Drop images, sounds, videos or links here"),
  ).toHaveCount(0);
  for (const zoom of [1, 0.75, 0.4, 0.39]) {
    const before = await page.evaluate(async (zoom) => {
      const frame = (await window.__jamMock.referenceCanvas()).frames[0];
      if (!frame) throw Error("Missing frame");
      await window.__jamCanvas?.setViewport({
        x: 200 - (frame.x ?? 0) * zoom,
        y: 180 - (frame.y ?? 0) * zoom,
        zoom,
      });
      return frame;
    }, zoom);
    const grip = page.locator(".reference-frame-grip");
    await expect(grip).toBeVisible();
    const box = await grip.boundingBox();
    if (!box) throw Error("Missing grip geometry");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 50,
      box.y + box.height / 2 + 35,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect
      .poll(async () =>
        page.evaluate(
          async () => (await window.__jamMock.referenceCanvas()).frames[0]?.x,
        ),
      )
      .not.toBe(before.x);
  }
});

test("RF03 local inline title/body keyboard save and explicit dirty cancel preserve note integrity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await page.goto("/references");
  const add = async () => {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Note", exact: true }).click();
  };
  await add();
  const draft = page.getByRole("form", { name: "New note draft" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    draft.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeFocused();
  await draft
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Snow lighting");
  await draft
    .getByRole("textbox", { name: "Note", exact: true })
    .fill("Keep silhouettes readable.");
  await page.keyboard.press("Control+s");
  await expect(draft).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (await window.__jamMock.referenceCanvas()).items.filter(
            (item) => item.title === "Snow lighting",
          ).length,
      ),
    )
    .toBe(1);
  await page.evaluate(async () => {
    const camera = window.__jamCanvas?.getViewport();
    const canvas = document
      .querySelector(".references-page")
      ?.getBoundingClientRect();
    if (camera && canvas) {
      const centerX = (canvas.width / 2 - camera.x) / camera.zoom;
      const centerY = (canvas.height / 2 - camera.y) / camera.zoom;
      await window.__jamCanvas?.setViewport({
        x: canvas.width / 2 - centerX * 4,
        y: canvas.height / 2 - centerY * 4,
        zoom: 4,
      });
    }
  });
  await add();
  const canvasBounds = await page
    .getByRole("region", { name: "References canvas" })
    .boundingBox();
  const draftBounds = await draft.boundingBox();
  if (!canvasBounds || !draftBounds) throw Error("Missing canvas/draft bounds");
  expect(draftBounds.x).toBeGreaterThanOrEqual(canvasBounds.x);
  expect(draftBounds.x + draftBounds.width).toBeLessThanOrEqual(
    canvasBounds.x + canvasBounds.width,
  );
  expect(draftBounds.y).toBeGreaterThanOrEqual(canvasBounds.y);
  expect(draftBounds.y + draftBounds.height).toBeLessThanOrEqual(
    canvasBounds.y + canvasBounds.height,
  );
  // The selected saved node shares this position; the new local paper must win hit testing.
  expect(
    await draft
      .getByRole("textbox", { name: "Title", exact: true })
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ) === element
        );
      }),
  ).toBe(true);
  await draft
    .getByRole("textbox", { name: "Note", exact: true })
    .fill("Cancel me");
  await page.keyboard.press("Escape");
  await expect(draft).toBeVisible();
  await draft.getByRole("button", { name: "Keep editing" }).click();
  await expect(
    draft.getByRole("textbox", { name: "Note", exact: true }),
  ).toHaveValue("Cancel me");
  await draft.getByRole("button", { name: "Cancel", exact: true }).click();
  await draft.getByRole("button", { name: "Discard draft" }).click();
  await expect(draft).toHaveCount(0);
  expect(
    await page.evaluate(
      async () => (await window.__jamMock.referenceCanvas()).items.length,
    ),
  ).toBe(1);
});

for (const theme of ["light", "dark"] as const) {
  test(`AS02/RF03 checked receipt does not cover a new note at 800×600 in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Load demo jam", exact: true })
      .click();
    await page.goto("/references");
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    const before = await page.evaluate(() =>
      window.__jamMock.referenceCanvas(),
    );
    await page
      .getByRole("button", { name: "Refresh references", exact: true })
      .click();
    const receipt = page.locator(".reference-toolbar .read-receipt");
    await expect(receipt).toContainText("Checked references.");
    await expect(receipt).toContainText("Last checked:");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Note", exact: true }).click();
    const draft = page.getByRole("form", { name: "New note draft" });
    const title = draft.getByRole("textbox", { name: "Title", exact: true });
    await expect(title).toBeFocused();
    const toolbarBounds = await page
      .locator(".reference-toolbar")
      .boundingBox();
    const receiptBounds = await receipt.boundingBox();
    const draftBounds = await draft.boundingBox();
    if (!toolbarBounds || !receiptBounds || !draftBounds)
      throw Error("Missing receipt/draft geometry");
    expect(receiptBounds.y + receiptBounds.height).toBeLessThanOrEqual(
      toolbarBounds.y + toolbarBounds.height + 1,
    );
    expect(draftBounds.y).toBeGreaterThanOrEqual(
      toolbarBounds.y + toolbarBounds.height,
    );
    expect(draftBounds.y).toBeGreaterThanOrEqual(
      receiptBounds.y + receiptBounds.height,
    );
    expect(
      await title.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ) === element
        );
      }),
    ).toBe(true);
    await draft.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(draft).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__jamMock.referenceCanvas()),
    ).toEqual(before);
  });
}
