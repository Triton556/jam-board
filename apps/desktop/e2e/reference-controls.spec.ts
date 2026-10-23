import { expect, test } from "@playwright/test";

// Real browser layout/hit testing; prepared locally, hosted execution recorded separately.
for (const theme of ["light", "dark"] as const) {
  for (const width of [800, 1180]) {
    test(`VS01 reference controls remain spaced and interactive at ${width}px (${theme})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 600 });
      await page.goto("/");
      await page.getByRole("button", { name: "Load demo jam" }).click();
      await page.goto("/references");
      await page.evaluate(async (value) => {
        document.documentElement.setAttribute("data-theme", value);
        await document.fonts.ready;
      }, theme);
      const toolbar = page.getByRole("toolbar", { name: "Canvas tools" });
      const filters = page.getByRole("group", { name: "Filter references" });
      const notice = page.locator(".reference-read-notice");
      const before = await page.evaluate(() =>
        window.__jamMock.referenceCanvas(),
      );
      const checkLayout = async (withNotice = false) => {
        const canvas = await page.locator(".references-page").boundingBox();
        const tools = await toolbar.boundingBox();
        const chips = await filters.boundingBox();
        if (!canvas || !tools || !chips)
          throw Error("Missing control geometry");
        expect(chips.y).toBeGreaterThanOrEqual(tools.y + tools.height + 7.5);
        for (const box of [tools, chips]) {
          expect(box.x).toBeGreaterThanOrEqual(canvas.x + 15.5);
          expect(box.x + box.width).toBeLessThanOrEqual(
            canvas.x + canvas.width - 15.5,
          );
        }
        if (withNotice) {
          const feedback = await notice.boundingBox();
          if (!feedback) throw Error("Missing read notice");
          expect(feedback.y).toBeGreaterThanOrEqual(
            chips.y + chips.height + 7.5,
          );
          expect(feedback.y + feedback.height).toBeLessThanOrEqual(
            canvas.y + canvas.height,
          );
          expect(feedback.height).toBeLessThanOrEqual(240);
        }
        return { tools, chips };
      };
      const refresh = toolbar.getByRole("button", {
        name: "Refresh references",
      });
      await refresh.click();
      await expect(toolbar.getByRole("status")).toContainText(
        "Checked references.",
      );
      await checkLayout();
      // A real filter interaction belongs to the filter, not the underlying canvas.
      const all = filters.getByRole("button", { name: "All", exact: true });
      const unlinked = filters.getByRole("button", {
        name: "Unlinked",
        exact: true,
      });
      const camera = await page.evaluate(() =>
        window.__jamCanvas?.getViewport(),
      );
      await unlinked.click();
      await expect(unlinked).toHaveAttribute("aria-pressed", "true");
      expect(
        await page.evaluate(() => window.__jamCanvas?.getViewport()),
      ).toEqual(camera);
      await all.focus();
      await page.keyboard.press("Enter");
      await expect(all).toHaveAttribute("aria-pressed", "true");

      await page.evaluate(() => {
        const original = window.__jamMock.referenceCanvas.bind(
          window.__jamMock,
        );
        Reflect.set(window, "originalReferenceRead", original);
        window.__jamMock.referenceCanvas = async () => {
          throw new Error(
            "Fictional long diagnostic detail for wrapping and scroll recovery. ".repeat(
              30,
            ),
          );
        };
      });
      await refresh.click();
      await expect(notice.getByRole("alert")).toContainText(
        "Fictional long diagnostic",
      );
      await expect(toolbar.getByRole("status")).toContainText(
        "Could not check references.",
      );
      await checkLayout(true);
      await page.screenshot({
        path: testInfo.outputPath("wrapped-read-error.png"),
        fullPage: true,
      });
      await page.evaluate(() => {
        window.__jamMock.referenceCanvas = Reflect.get(
          window,
          "originalReferenceRead",
        );
      });
      await notice.getByRole("button", { name: "Try again" }).click();
      await expect(notice).toBeHidden();
      await expect(toolbar.getByRole("status")).toContainText(
        "Checked references.",
      );
      const { tools, chips } = await checkLayout();

      // The empty gap belongs to the canvas: no invisible full-width overlay intercepts pan.
      const point = {
        x: tools.x + 20,
        y: (tools.y + tools.height + chips.y) / 2,
      };
      expect(
        await page.evaluate(
          ({ x, y }) =>
            !!document.elementFromPoint(x, y)?.closest(".react-flow__pane"),
          point,
        ),
      ).toBe(true);
      const beforePan = await page.evaluate(() =>
        window.__jamCanvas?.getViewport(),
      );
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 40, point.y, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.__jamCanvas?.getViewport()))?.x,
        )
        .not.toBe(beforePan?.x);

      await toolbar.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("button", { name: "Note", exact: true }).click();
      await expect(
        page.getByRole("region", { name: "References canvas" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      const draft = page.getByRole("article", { name: "New note paper" });
      const paper = await draft.boundingBox();
      const stack = await page
        .locator(".reference-control-stack")
        .boundingBox();
      if (!paper || !stack) throw Error("Missing draft/stack geometry");
      expect(paper.y).toBeGreaterThanOrEqual(stack.y + stack.height + 15.5);
      const body = draft.getByRole("textbox", {
        name: "Note text",
        exact: true,
      });
      await expect(body).toBeFocused();
      expect(
        await body.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return (
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
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
}
