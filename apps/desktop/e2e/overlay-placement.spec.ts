import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`lower drawer Status menu stays inside the viewport in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Load demo jam", exact: true })
      .click();
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    const before = await page.evaluate(() => window.__jamMock.getTask("JB-7"));
    await page.goto("/board?task=JB-7");
    const drawer = page.getByRole("dialog", { name: "JB-7", exact: true });
    const select = drawer.getByRole("combobox", {
      name: "Status",
      exact: true,
    });
    await select.scrollIntoViewIfNeeded();
    await select.evaluate((element) => {
      const scroll = element.closest(".drawer");
      if (!scroll) throw Error("Missing drawer scroll surface");
      const box = element.getBoundingClientRect();
      scroll.scrollTop += box.bottom - (window.innerHeight - 42);
    });
    await select.click();
    const list = drawer.getByRole("listbox", { name: "Status options" });
    await expect(list).toBeVisible();
    const popup = list.locator("..");
    const bounds = await popup.boundingBox();
    if (!bounds) throw Error("No popup geometry");
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(600);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(800);
    await select.press("End");
    await expect(
      list.getByRole("option", { name: "Done", exact: true }),
    ).toBeInViewport();
    await select.press("Escape");
    await expect(select).toBeFocused();
    await expect(drawer).toBeVisible();
    expect(await page.evaluate(() => window.__jamMock.getTask("JB-7"))).toEqual(
      before,
    );
    const summary = drawer.locator("details.agent-plan > summary");
    const marker = await summary.evaluate((element) => ({
      list: getComputedStyle(element).listStyleType,
      content: getComputedStyle(element, "::before").content,
      border: getComputedStyle(element, "::before").borderRightWidth,
    }));
    expect(marker.list).toBe("none");
    expect(marker.content).toBe('""');
    expect(Number.parseFloat(marker.border)).toBeGreaterThan(0);
  });
}
