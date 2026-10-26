import { expect, test } from "@playwright/test";

for (const mode of ["light", "dark", "unsupported", "throws"] as const) {
  test(`KB03/VS01 Link reference target stays usable outside a compact modal clip (${mode})`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: 800,
      height: 600,
    });
    if (mode === "unsupported" || mode === "throws") {
      await page.addInitScript((mode) => {
        Object.defineProperty(HTMLElement.prototype, "showPopover", {
          configurable: true,
          value:
            mode === "unsupported"
              ? undefined
              : () => {
                  throw new DOMException("Test unsupported context");
                },
        });
      }, mode);
    }
    await page.goto("/");
    await page.getByRole("button", { name: "Load demo jam" }).click();
    await page.evaluate(async () => {
      await window.__jamMock.addReference({
        kind: "note",
        title: "Overlay fixture",
        text: "Keep this reference unchanged.",
        x: 0,
        y: 0,
      });
    });
    await page.goto("/references");
    await page.evaluate(
      (theme) => {
        document.documentElement.dataset.theme = theme;
      },
      mode === "dark" ? "dark" : "light",
    );
    await expect(page.locator("[data-reference-id]")).toHaveCount(1);
    await page.evaluate(async () => {
      await window.__jamCanvas?.setViewport({ x: 24, y: 180, zoom: 0.7 });
    });
    const before = await page.evaluate(async () => ({
      canvas: await window.__jamMock.referenceCanvas(),
      camera: window.__jamCanvas?.getViewport(),
    }));
    await page.getByLabel("Actions for Overlay fixture").click();
    await page
      .locator(".reference-menu[open]")
      .getByRole("button", { name: "Link to…", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Link to work" });
    await expect(dialog).toBeVisible();
    // Test the 400px inline popup after opening the dialog, without requiring
    // the full canvas controls to work below the application's minimum width.
    if (mode === "unsupported")
      await page.setViewportSize({ width: 400, height: 600 });
    const trigger = dialog.getByRole("combobox");
    await trigger.click();
    const popup = dialog.locator(".combo-popup");
    await expect(popup).toHaveAttribute(
      "data-presentation",
      mode === "unsupported" || mode === "throws" ? "inline" : "top-layer",
    );
    const first = dialog.getByRole("option").first();
    await expect(first).toBeVisible();
    await first.scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        first.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const x = rect.x + rect.width / 2,
            y = rect.y + rect.height / 2;
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            x >= 0 &&
            x < innerWidth &&
            y >= 0 &&
            y < innerHeight &&
            element.contains(document.elementFromPoint(x, y))
          );
        }),
      )
      .toBe(true);
    // Opening/closing does not change selection; the search and options remain in
    // the same modal DOM tree rather than escaping its keyboard ownership.
    await expect(dialog.locator(".combo-popup input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: "Link 1", exact: true }),
    ).toBeDisabled();
    await trigger.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByRole("button", { name: "Link 1", exact: true }),
    ).toBeEnabled();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole("heading", { name: "Link to work" }).click();
    await expect(popup).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await trigger.click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    const after = await page.evaluate(async () => ({
      canvas: await window.__jamMock.referenceCanvas(),
      camera: window.__jamCanvas?.getViewport(),
    }));
    expect(after).toEqual(before);
  });
}
