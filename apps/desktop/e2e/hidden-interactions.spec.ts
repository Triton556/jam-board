import { expect, test } from "@playwright/test";

test("F07/F08 actions Escape stays in task; pending archive cannot duplicate or save the underlying draft", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.goto("/board?task=JB-7");
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
  const before = await page.evaluate(() => window.__jamMock.getTask("JB-7"));
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Unsaved human request, not an archive update");
  const actions = page.getByRole("button", { name: "Task actions" });
  await actions.click();
  await page.keyboard.press("Escape");
  await expect(actions).toHaveAttribute("aria-expanded", "false");
  await expect(actions).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
  await page.evaluate(() => {
    const original = window.__jamMock.archiveTask.bind(window.__jamMock);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = { attempts: 0, release: () => release() };
    Reflect.set(window, "hiddenArchiveProbe", probe);
    window.__jamMock.archiveTask = async (...args) => {
      probe.attempts++;
      await gate;
      return original(...args);
    };
  });
  await actions.click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Archive task" });
  await expect(dialog).toContainText("Unsaved edits will be discarded");
  await dialog
    .getByRole("textbox", { name: "Archive reason" })
    .fill("Fictional duplicate guard check");
  await dialog.getByRole("button", { name: "Archive", exact: true }).dblclick();
  await expect(dialog).toHaveAttribute("aria-busy", "true");
  await expect(dialog.getByRole("status")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => Reflect.get(window, "hiddenArchiveProbe").attempts,
    ),
  ).toBe(1);
  expect(await page.evaluate(() => window.__jamMock.getTask("JB-7"))).toEqual(
    before,
  );
  await page.evaluate(() =>
    Reflect.get(window, "hiddenArchiveProbe").release(),
  );
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".notice").filter({ hasText: "Archived ·" }),
  ).toBeVisible();
  const after = await page.evaluate(() => window.__jamMock.getTask("JB-7"));
  expect(after.archivedAt).not.toBeNull();
  expect(after.descriptionMd).toBe(before.descriptionMd);
  expect(after.status).toBe(before.status);
  expect(after.assigneeId).toBe(before.assigneeId);
  expect(
    await page.evaluate(
      () => Reflect.get(window, "hiddenArchiveProbe").attempts,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      window.__jamMock.calls.filter((call) =>
        /^(update_task|claim_task|set_execution)$/.test(call.command),
      ),
    ),
  ).toEqual([]);
});
