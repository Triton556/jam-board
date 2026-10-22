import { expect, test } from "@playwright/test";

test("AG02 scoped Refine modes preserve local wishes and never mutate the board", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  const before = await page.evaluate(() => window.__jamMock.getTask("JB-7"));
  await page.goto("/board?task=JB-7");
  const task = page.getByRole("dialog", { name: "JB-7", exact: true });
  await task.getByRole("button", { name: "Refine with brain" }).click();
  const handoff = page.getByRole("dialog", {
    name: "Plan JB-7 with your brain",
  });
  await expect(
    handoff.getByRole("radio", { name: "First / new chat" }),
  ).toHaveAttribute("aria-checked", "true");
  const full = await handoff
    .getByRole("textbox", { name: "Planning prompt" })
    .inputValue();
  await handoff
    .getByRole("textbox", { name: "What should change?" })
    .fill("Keep my human description intact; clarify the observable result.");
  const mode = handoff.getByRole("radio", { name: "First / new chat" });
  await mode.focus();
  await mode.press("ArrowRight");
  await expect(
    handoff.getByRole("radio", { name: "Continue in this chat" }),
  ).toHaveAttribute("aria-checked", "true");
  const short = await handoff
    .getByRole("textbox", { name: "Planning prompt" })
    .inputValue();
  expect(short.length).toBeLessThan(full.length);
  expect(short).toContain(`scope ID ${before.id}`);
  expect(short).toContain("no claims");
  await handoff.getByRole("button", { name: "Copy planning prompt" }).click();
  await expect(handoff.getByRole("status")).toContainText(
    "Nothing was sent or saved to the board",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(short);
  await page.keyboard.press("Escape");
  await expect(
    task.getByRole("button", { name: "Refine with brain" }),
  ).toBeFocused();
  await task.getByRole("button", { name: "Refine with brain" }).click();
  await expect(
    handoff.getByRole("textbox", { name: "What should change?" }),
  ).toHaveValue(
    "Keep my human description intact; clarify the observable result.",
  );
  await expect(
    handoff.getByRole("radio", { name: "Continue in this chat" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => window.__jamMock.getTask("JB-7"))).toEqual(
    before,
  );
});
