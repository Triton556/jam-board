import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
});
for (const path of [
  "/board",
  "/table",
  "/plan",
  "/plan/JB-E1",
  "/assets",
  "/references",
  "/activity",
  "/inbox",
  "/team",
  "/settings",
]) {
  test(`modal deep link and invalid presentation fallback on ${path}`, async ({
    page,
  }) => {
    await page.goto(`${path}?task=JB-7&taskView=modal`);
    const surface = page.getByRole("dialog", { name: "JB-7", exact: true });
    await expect(surface).toHaveAttribute("data-presentation", "modal");
    await expect(
      surface.getByRole("textbox", { name: "Task title", exact: true }),
    ).toBeVisible();
    await surface
      .getByRole("button", { name: "Use side panel", exact: true })
      .click();
    await expect(page).not.toHaveURL(/taskView=/);
    await expect(surface).toHaveAttribute("data-presentation", "drawer");
    if (path === "/references")
      await expect(surface).not.toHaveAttribute("aria-modal");
    await page.goto(`${path}?task=JB-7&taskView=invalid`);
    await expect(surface).toHaveAttribute("data-presentation", "drawer");
  });
}
test("same session, drafts, scroll and focused brief survive switching without a write or history entry; leaving is guarded", async ({
  page,
}) => {
  await page.goto("/board?task=JB-7&epics=JB-E1");
  const surface = page.getByRole("dialog", { name: "JB-7", exact: true });
  const title = surface.getByRole("textbox", {
    name: "Task title",
    exact: true,
  });
  await title.fill("Dirty presentation title");
  await surface
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Unsaved description");
  await surface
    .getByRole("textbox", { name: "Write a comment", exact: true })
    .fill("Unsent comment");
  await surface.locator("details.agent-plan > summary").click();
  await surface.getByRole("button", { name: "Edit Goal", exact: true }).click();
  const goal = surface.getByRole("textbox", { name: "Goal", exact: true });
  await goal.fill("Unsaved brief goal");
  const before = await page.evaluate(() => {
    Reflect.set(
      window,
      "taskEditorIdentity",
      document.querySelector("#task-form"),
    );
    return {
      history: history.length,
      writes: window.__jamMock.calls.filter(
        (call) => call.command === "update_task",
      ).length,
    };
  });
  // Keep the same field focused while a pointer toggles presentation in the sticky header.
  await surface
    .getByRole("button", { name: "Open larger", exact: true })
    .click();
  await expect(page).toHaveURL(/taskView=modal/);
  await expect(page).toHaveURL(/epics=JB-E1/);
  await expect(goal).toBeFocused();
  await expect(goal).toHaveValue("Unsaved brief goal");
  await expect(title).toHaveValue("Dirty presentation title");
  await expect(
    surface.getByRole("textbox", { name: "Write a comment", exact: true }),
  ).toHaveValue("Unsent comment");
  expect(
    await page.evaluate(
      () =>
        document.querySelector("#task-form") ===
        Reflect.get(window, "taskEditorIdentity"),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => history.length)).toBe(before.history);
  expect(
    await page.evaluate(
      () =>
        window.__jamMock.calls.filter((call) => call.command === "update_task")
          .length,
    ),
  ).toBe(before.writes);
  await surface
    .getByRole("button", { name: "Use side panel", exact: true })
    .click();
  await expect(goal).toBeFocused();
  await surface
    .getByRole("button", { name: "Close task", exact: true })
    .click();
  const guard = page.getByRole("dialog", {
    name: "Discard changes?",
    exact: true,
  });
  await expect(guard).toBeVisible();
  await guard
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(title).toHaveValue("Dirty presentation title");
});
test("nested Escape, inert background, Tab wrapping, Ctrl+S and origin focus return", async ({
  page,
}) => {
  await page.goto("/board");
  const card = page.getByRole("button", { name: /Open JB-7:/ });
  await card.focus();
  await card.press("Enter");
  const surface = page.getByRole("dialog", { name: "JB-7", exact: true });
  await surface
    .getByRole("button", { name: "Open larger", exact: true })
    .click();
  expect(
    await page.locator("#root").evaluate((el) => (el as HTMLElement).inert),
  ).toBe(true);
  await surface
    .getByRole("button", { name: "Task actions", exact: true })
    .click();
  await surface.getByRole("button", { name: "Archive", exact: true }).click();
  const nested = page.getByRole("dialog", {
    name: "Archive task",
    exact: true,
  });
  await expect(nested).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nested).toHaveCount(0);
  await expect(surface).toBeVisible();
  const title = surface.getByRole("textbox", {
    name: "Task title",
    exact: true,
  });
  await title.fill("Saved from large task view");
  await title.press("Control+s");
  await expect(
    surface.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  const save = surface.getByRole("button", { name: /^Save Ctrl/ });
  const cancel = surface.getByRole("button", { name: "Cancel", exact: true });
  await cancel.focus();
  await page.keyboard.press("Tab");
  // Disabled Save is omitted; last enabled field wraps to the first header control.
  await expect(save).toBeDisabled();
  await expect(
    surface.getByRole("button", { name: "Copy key", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(surface).toHaveCount(0);
  await expect(card).toBeFocused();
  expect(
    await page.locator("#root").evaluate((el) => (el as HTMLElement).inert),
  ).toBe(false);
});

test("375px task headers keep the key and every action on one row in both presentations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/board?task=JB-7");
  const surface = page.getByRole("dialog", { name: "JB-7", exact: true });
  await expect(
    surface.getByRole("textbox", { name: "Task title", exact: true }),
  ).toBeVisible();
  for (const presentation of ["drawer", "modal"]) {
    await expect(surface).toHaveAttribute("data-presentation", presentation);
    const header = surface.locator(":scope > .drawer-heading");
    const bounds = await header.boundingBox();
    if (!bounds) throw new Error("Task heading is not visible");
    const key = await header.locator(":scope > .mono").boundingBox();
    expect(key?.height).toBeLessThan(24);
    for (const name of [
      "Copy key",
      presentation === "drawer" ? "Open larger" : "Use side panel",
      "Refine with brain",
      "Task actions",
      "Close task",
    ]) {
      const button = header.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const rect = await button.boundingBox();
      if (!rect) throw new Error(`Missing task header action: ${name}`);
      expect(rect.y).toBeGreaterThanOrEqual(bounds.y);
      expect(rect.y + rect.height).toBeLessThanOrEqual(
        bounds.y + bounds.height,
      );
      expect(rect.x + rect.width).toBeLessThanOrEqual(375);
      expect(
        Math.abs(rect.y + rect.height / 2 - (bounds.y + bounds.height / 2)),
      ).toBeLessThan(2);
    }
    await header
      .getByRole("button", {
        name: presentation === "drawer" ? "Open larger" : "Use side panel",
        exact: true,
      })
      .click();
  }
});
