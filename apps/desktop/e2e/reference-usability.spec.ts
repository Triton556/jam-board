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

test("RF03 direct paper autosave and empty removal preserve note integrity at high zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await page.goto("/references");
  const add = async () => {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Note", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "References canvas" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
  };
  await add();
  const draft = page.getByRole("article", { name: "New note paper" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    draft.getByRole("textbox", { name: "Note text", exact: true }),
  ).toBeFocused();
  await expect(draft.getByRole("button", { name: "Save note" })).toHaveCount(0);
  await draft.getByRole("button", { name: "Add heading" }).click();
  await draft
    .getByRole("textbox", { name: "Optional note heading" })
    .fill("Snow lighting");
  const body = draft.getByRole("textbox", { name: "Note text", exact: true });
  await body.fill("Keep silhouettes readable.");
  await expect(draft.getByRole("status")).toHaveText("Saved");
  await expect(body).toBeFocused();
  await page.keyboard.press("Escape");
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
  const savedId = await page.evaluate(async () => {
    const saved = (await window.__jamMock.referenceCanvas()).items.find(
      (item) => item.title === "Snow lighting",
    );
    if (!saved) throw Error("Missing saved note");
    return saved.id;
  });
  const savedNode = page.locator(`.react-flow__node[data-id="${savedId}"]`);
  await savedNode.click();
  await expect(savedNode).toHaveClass(/selected/);
  await page.evaluate(async (id) => {
    const saved = (await window.__jamMock.referenceCanvas()).items.find(
      (item) => item.id === id,
    );
    const canvas = document
      .querySelector(".references-page")
      ?.getBoundingClientRect();
    if (
      !saved ||
      !canvas ||
      saved.x === null ||
      saved.y === null ||
      saved.w === null ||
      saved.h === null
    )
      throw Error("Missing saved-note/canvas geometry");
    // Center the actual selected note, not an assumed camera center, so the
    // next placed paper demonstrably overlaps the elevated persisted node.
    const centerX = saved.x + saved.w / 2;
    const centerY = saved.y + saved.h / 2;
    await window.__jamCanvas?.setViewport({
      x: canvas.width / 2 - centerX * 4,
      y: canvas.height / 2 - centerY * 4,
      zoom: 4,
    });
  }, savedId);
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
  const savedBounds = await savedNode.boundingBox();
  if (!savedBounds) throw Error("Missing overlapped saved-note geometry");
  expect(
    Math.min(
      savedBounds.x + savedBounds.width,
      draftBounds.x + draftBounds.width,
    ) - Math.max(savedBounds.x, draftBounds.x),
  ).toBeGreaterThan(0);
  expect(
    Math.min(
      savedBounds.y + savedBounds.height,
      draftBounds.y + draftBounds.height,
    ) - Math.max(savedBounds.y, draftBounds.y),
  ).toBeGreaterThan(0);
  // The actual selected saved node overlaps; the new paper must win hit testing.
  expect(
    await draft
      .getByRole("textbox", { name: "Note text", exact: true })
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
  // Empty papers are local and removable; Escape on nonblank text now flushes
  // intentionally rather than pretending an already-autosaved note is undone.
  await page.keyboard.press("Escape");
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
    await page.keyboard.press("Enter");
    const draft = page.getByRole("article", { name: "New note paper" });
    const body = draft.getByRole("textbox", { name: "Note text", exact: true });
    await expect(body).toBeFocused();
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
      await body.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ) === element
        );
      }),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(draft).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__jamMock.referenceCanvas()),
    ).toEqual(before);
  });
}
