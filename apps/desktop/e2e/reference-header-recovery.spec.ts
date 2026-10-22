import { expect, test } from "@playwright/test";

// Prepared functional-browser checks. Native/OS scaling evidence remains separate.
for (const theme of ["light", "dark"] as const) {
  test(`RF02 title remains readable and explicit Fit clears tools (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/");
    await page.getByRole("button", { name: "Load demo jam" }).click();
    const initial = await page.evaluate(async () => {
      const frame = await window.__jamMock.createRefFrame({
        title: "Agent inbox",
        x: 0,
        y: 0,
        w: 320,
        h: 1200,
      });
      await window.__jamMock.addReference({
        kind: "note",
        title: "Agent findings",
        text: "Keep the result visible.",
        frameId: frame.id,
        x: 24,
        y: 56,
      });
      return window.__jamMock.referenceCanvas();
    });
    await page.goto("/references");
    await page.evaluate(async (value) => {
      document.documentElement.setAttribute("data-theme", value);
      await document.fonts.ready;
    }, theme);
    const title = page.locator(".reference-frame-title", {
      hasText: "Agent inbox",
    });
    const header = page.locator(".reference-frame-tab");
    // The route is lazy: page load/fonts readiness is not canvas readiness.
    await expect(
      page.getByRole("region", { name: "References canvas" }),
    ).toBeVisible();
    await expect(title).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => !!window.__jamCanvas))
      .toBe(true);
    for (const zoom of [1, 0.75, 0.49, 0.4, 0.39]) {
      await page.evaluate(async (zoom) => {
        if (!window.__jamCanvas) throw Error("Canvas bridge unavailable");
        await window.__jamCanvas.setViewport({ x: 100, y: 200, zoom });
      }, zoom);
      await expect(title).toBeVisible();
      expect(
        await title.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      for (const name of [
        "Collapse Agent inbox",
        "Edit frame Agent inbox",
        "Archive frame Agent inbox",
      ]) {
        const button = page.getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        const size = await button.boundingBox();
        if (!size) throw Error("Missing frame control bounds");
        expect(size.width).toBeGreaterThanOrEqual(23.9);
        expect(size.height).toBeGreaterThanOrEqual(23.9);
        expect(
          await button.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              ),
            );
          }),
        ).toBe(true);
      }
    }
    await page.getByRole("button", { name: "Fit view · F" }).click();
    await expect
      .poll(async () =>
        header.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const tools = [
            ...document.querySelectorAll(
              ".reference-toolbar, .reference-filters",
            ),
          ].map((node) => node.getBoundingClientRect().bottom);
          return (
            box.top >= Math.max(...tools) + 16 &&
            box.left >= 0 &&
            box.right <= innerWidth &&
            box.bottom <= innerHeight
          );
        }),
      )
      .toBe(true);
    expect(
      await page.evaluate(() => window.__jamMock.referenceCanvas()),
    ).toEqual(initial);
    await page.screenshot({
      path: test.info().outputPath(`frame-fit-${theme}.png`),
    });
    await page.getByRole("button", { name: "Collapse Agent inbox" }).click();
    await expect
      .poll(async () =>
        page.evaluate(
          async () =>
            (await window.__jamMock.referenceCanvas()).frames[0]?.collapsed,
        ),
      )
      .toBe(true);
    await expect(page.locator(".reference-card")).toHaveCount(0);
    await page.getByRole("button", { name: "Fit view · F" }).click();
    await expect(
      page.getByRole("button", { name: "Expand Agent inbox" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Expand Agent inbox" }).click();
    await expect
      .poll(async () => page.evaluate(() => window.__jamMock.referenceCanvas()))
      .toEqual(initial);
    const after = await page.evaluate(() => window.__jamMock.referenceCanvas());
    expect(after.items).toEqual(initial.items);
    expect(after.frames).toEqual(initial.frames);
  });
}

test("RF04 note actions edit directly and retain menu/dialog dismissal ownership", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  const initial = await page.evaluate(async () => {
    await window.__jamMock.addReference({
      kind: "note",
      title: "Agent findings",
      text: "Keep this original result.",
      x: 100,
      y: 160,
    });
    return window.__jamMock.referenceCanvas();
  });
  await page.goto("/references");
  const summary = page.getByLabel("Actions for Agent findings", {
    exact: true,
  });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Edit note", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(summary).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Edit note", exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Edit note", exact: true }),
  ).toBeVisible();
  const canvas = await page
    .getByRole("region", { name: "References canvas" })
    .boundingBox();
  if (!canvas) throw Error("Missing canvas bounds");
  await page.mouse.click(canvas.x + canvas.width - 40, canvas.y + 200);
  await expect(
    page.getByRole("button", { name: "Edit note", exact: true }),
  ).toBeHidden();
  await summary.click();
  await page.getByRole("button", { name: "Toggle minimap" }).click();
  await expect(
    page.getByRole("button", { name: "Toggle minimap" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Edit note", exact: true }),
  ).toBeHidden();
  await summary.click();
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const body = page.getByRole("textbox", { name: "Note text", exact: true });
  await expect(body).toBeFocused();
  await expect(body).toHaveValue("Keep this original result.");
  await expect(
    page.getByRole("button", { name: "Edit note", exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(body).toHaveCount(0);
  // Merely opening an existing note editor must not rewrite agent content.
  expect(await page.evaluate(() => window.__jamMock.referenceCanvas())).toEqual(
    initial,
  );
  for (const action of ["Tags", "Link to…"]) {
    await summary.click();
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(summary).toBeFocused();
    expect(
      await page.evaluate(() => window.__jamMock.referenceCanvas()),
    ).toEqual(initial);
  }
});
