import { expect, test } from "@playwright/test";

test("references persist files, links, notes, parenting, edges, undo and agent additions", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await page.goto("/references");
  await expect(
    page.getByText("Double-click anywhere to jot an idea"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "File…", exact: true }).click();
  await expect(page.locator(".reference-card")).toHaveCount(2);
  await page.locator(".reference-image").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: /^Close player/ }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Link…", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Lantern palette");
  await page
    .getByRole("textbox", { name: "URL", exact: true })
    .fill("https://example.test/lanterns");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "References canvas", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const paper = page.getByRole("article", { name: "New note paper" });
  const body = paper.getByRole("textbox", { name: "Note text", exact: true });
  await expect(body).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await body.fill("# Warm light\nKeep the snowy silhouettes readable.");
  await paper.getByRole("button", { name: "Add heading" }).click();
  await paper
    .getByRole("textbox", { name: "Optional note heading", exact: true })
    .fill("Snow and amber");
  await expect(paper.getByRole("status")).toHaveText("Saved");
  await expect
    .poll(async () =>
      page.evaluate(async () =>
        (await window.__jamMock.referenceCanvas()).items
          .filter((item) => item.kind === "note")
          .map(({ title, captionMd }) => ({ title, captionMd })),
      ),
    )
    .toEqual([
      {
        title: "Snow and amber",
        captionMd: "# Warm light\nKeep the snowy silhouettes readable.",
      },
    ]);
  await page.keyboard.press("Escape");
  await expect(paper).toHaveCount(0);
  await expect(page.locator(".reference-card")).toHaveCount(4);
  await page.getByRole("button", { name: "Frame", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Lighting studies");
  await page.getByRole("combobox", { name: "Frame epic" }).click();
  await page
    .getByRole("option", { name: "Lantern levels", exact: true })
    .click();
  await page.getByRole("button", { name: "Create frame", exact: true }).click();
  await expect(page.locator(".reference-frame-tab")).toHaveCSS(
    "font-family",
    /PT Serif/,
  );
  await page.getByRole("button", { name: "Fit view · F" }).click();
  await page.waitForTimeout(350);
  const ids = await page.evaluate(async () => {
    const d = await window.__jamMock.referenceCanvas();
    return {
      note: d.items.find((i) => i.kind === "note")?.id,
      link: d.items.find((i) => i.kind === "link")?.id,
      frame: d.frames[0]?.id,
    };
  });
  expect(ids.note && ids.frame && ids.link).toBeTruthy();
  // Move through the real pointer handlers, including an already selected image.
  const note = page.locator(
    `[data-reference-id="${ids.note}"] .reference-card-header`,
  );
  await note.scrollIntoViewIfNeeded();
  const box = await note.boundingBox(),
    frame = await page.locator(".reference-frame").boundingBox();
  if (!box || !frame) throw Error("Missing geometry");
  const start = { x: box.x + box.width * 0.3, y: box.y + box.height / 2 };
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>("[data-reference-id]")?.dataset.referenceId,
      start,
    ),
  ).toBe(ids.note);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(frame.x + 130, frame.y + 130, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(650);
  await expect
    .poll(() =>
      page.evaluate(async (ids) => {
        const canvas = await window.__jamMock.referenceCanvas();
        return canvas.items.find((item) => item.id === ids.note)?.frameId;
      }, ids),
    )
    .toBe(ids.frame);
  await expect(
    page.locator(`[data-reference-id="${ids.note}"]`),
  ).toHaveAttribute("aria-label", /linked to JB-E1/);
  const before = await page.evaluate(async () => {
    const d = await window.__jamMock.referenceCanvas();
    return d.items.find((i) => i.kind === "note")?.x;
  });
  await page.locator(`[data-id="${ids.note}"]`).focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const d = await window.__jamMock.referenceCanvas();
        return d.items.find((i) => i.kind === "note")?.x;
      }),
    )
    .toBe((before ?? 0) + 8);
  await page.waitForTimeout(600);
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const d = await window.__jamMock.referenceCanvas();
        return d.items.find((i) => i.kind === "note")?.x;
      }),
    )
    .toBe(before);
  const source = page.locator(
      `[data-id="${ids.note}"] .react-flow__handle-right`,
    ),
    target = page.locator(`[data-id="${ids.link}"] .react-flow__handle-left`);
  await source.dragTo(target);
  await expect(page.locator(".reference-edge-label")).toHaveCount(1);
  await page.locator(".reference-edge-label").click();
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("same palette");
  await page.getByRole("button", { name: "Save label" }).click();
  const saved = await page.evaluate(() => window.__jamMock.referenceCanvas());
  await page.reload();
  await expect(page.locator(".reference-edge-label")).toHaveText(
    "same palette",
  );
  expect(await page.evaluate(() => window.__jamMock.referenceCanvas())).toEqual(
    saved,
  );
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "reference.added",
      reference: {
        kind: "note",
        text: "Try a soft amber rim light",
        title: "Codex lighting note",
        frameEpicKey: "JB-E1",
      },
    }),
  );
  await page.getByRole("button", { name: "Fit view · F" }).click();
  await expect(
    page.locator('.reference-card[data-highlighted="true"]'),
  ).toContainText("Codex lighting note");
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Collapse Lighting studies" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (await window.__jamMock.referenceCanvas()).frames[0]?.collapsed,
      ),
    )
    .toBe(true);
  await page.locator(`[data-id="${ids.frame}"]`).focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (await window.__jamMock.referenceCanvas()).frames[0]?.collapsed,
      ),
    )
    .toBe(false);
});
test("paste routes clipboard content and archive remains undoable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await page.goto("/references");
  await page.getByRole("region", { name: "References canvas" }).waitFor();
  const paste = async (text: string) =>
    page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      document.querySelector(".references-page")?.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, text);
  await paste("https://example.test/quiet-snow");
  await paste("Keep one warm light at the bridge");
  await expect(page.locator(".reference-card")).toHaveCount(2);
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    c.getContext("2d")?.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve));
    if (!blob) throw Error("No clipboard image");
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([blob], "clipboard.png", { type: "image/png" }),
    );
    document.querySelector(".references-page")?.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".reference-card")).toHaveCount(3);
  const id = await page.evaluate(
    async () =>
      (await window.__jamMock.referenceCanvas()).items.find(
        (i) => i.title === "Clipboard image",
      )?.id,
  );
  await page.locator(`[data-id="${id}"]`).focus();
  await page.keyboard.press("Delete");
  await expect(page.locator(".reference-card")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".reference-card")).toHaveCount(3);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".reference-card")).toHaveCount(2);
});
test("scrolling skips decorative hit tests while task rows remain clickable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await page.goto("/table");
  await page.getByTestId("table-row").first().waitFor();
  const deltas = await page
    .getByTestId("table-scroll")
    .evaluate(async (element) => {
      const before = { x: element.scrollLeft, y: element.scrollTop };
      const inputs = [
        { deltaX: 12, deltaY: 48 },
        { deltaX: 28, deltaY: 72 },
      ];
      const handled = inputs.map(
        (delta) =>
          !element.dispatchEvent(
            new WheelEvent("wheel", {
              ...delta,
              bubbles: true,
              cancelable: true,
            }),
          ),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const zoom = new WheelEvent("wheel", {
        deltaY: 120,
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      });
      element.dispatchEvent(zoom);
      return {
        x: element.scrollLeft - before.x,
        y: element.scrollTop - before.y,
        handled,
        zoomPrevented: zoom.defaultPrevented,
      };
    });
  expect(deltas).toEqual({
    x: 40,
    y: 120,
    handled: [true, true],
    zoomPrevented: false,
  });
  await page
    .getByTestId("table-scroll")
    .evaluate((element) => element.setAttribute("data-scrolling", ""));
  await page.getByTestId("table-row").first().click();
  await expect(
    page.getByRole("button", { name: "Close task", exact: true }),
  ).toBeVisible();
});
