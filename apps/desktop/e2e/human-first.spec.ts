import { expect, test } from "@playwright/test";
import { openAgentPlan } from "./assertions";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
});
test("human description and comments are primary; the full agent plan stays intact behind its disclosure", async ({
  page,
}) => {
  const before = await page.evaluate(() => window.__jamMock.getTask("JB-7"));
  await page.goto("/board?task=JB-7");
  const drawer = page.getByRole("dialog", { name: "JB-7", exact: true });
  const description = drawer.getByRole("textbox", {
    name: "Description",
    exact: true,
  });
  await expect(description).toHaveValue(before.descriptionMd);
  const plan = drawer.locator("details.agent-plan");
  await expect(plan).not.toHaveAttribute("open");
  await expect(
    drawer.getByRole("button", { name: "Edit Goal", exact: true }),
  ).not.toBeVisible();
  const order = await drawer.evaluate((el) => {
    const description = el.querySelector('[aria-label="Description"]');
    const comments = el.querySelector('[aria-label="Task comments"]');
    const plan = el.querySelector("details.agent-plan");
    if (!description || !comments || !plan)
      throw Error("Missing primary surface");
    return (
      Boolean(
        description.compareDocumentPosition(comments) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ) &&
      Boolean(
        comments.compareDocumentPosition(plan) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      )
    );
  });
  expect(order).toBe(true);
  await description.fill(
    "Please keep the controls simple and the target easy to see.",
  );
  await drawer.getByRole("button", { name: /^Save Ctrl/ }).click();
  await expect(
    drawer.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(() => window.__jamMock.getTask("JB-7"));
  expect(saved.descriptionMd).toBe(
    "Please keep the controls simple and the target easy to see.",
  );
  expect(saved.brief).toEqual(before.brief);
  expect(saved.status).toBe(before.status);
  await drawer
    .getByRole("textbox", { name: "Write a comment" })
    .fill("Fictional review wish: keep the existing keyboard controls.");
  await drawer.getByRole("button", { name: /Add comment/ }).click();
  await expect(
    drawer.getByRole("status").filter({ hasText: "Comment added." }),
  ).toBeVisible();
  await expect(drawer.locator(".comment").last()).toContainText(
    "Fictional review wish",
  );
  await openAgentPlan(page);
  await expect(
    drawer
      .locator("[data-brief-field=change] fieldset.list-editor-row")
      .first(),
  ).toHaveCSS("padding", "16px");
  const change = drawer.getByRole("textbox", {
    name: "Change 1 title",
    exact: true,
  });
  await change.fill("Unsaved technical draft");
  await plan.locator(":scope > summary").click();
  await expect(change).not.toBeVisible();
  await expect(plan.locator(":scope > summary")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(change).toBeVisible();
  await expect(change).toHaveValue("Unsaved technical draft");
  const current = await page.evaluate(() => window.__jamMock.getTask("JB-7"));
  expect(current.brief).toEqual(before.brief);
  expect(current.comments).toHaveLength(before.comments.length + 1);
});
test("Story description is readable without technical fields; acceptance remains editable after explicit expansion", async ({
  page,
}) => {
  const before = await page.evaluate(() => window.__jamMock.getStory("JB-S1"));
  await page.goto("/plan/JB-E1?tab=Stories&story=JB-S1");
  const drawer = page.getByRole("dialog", { name: "JB-S1", exact: true });
  await expect(
    drawer.getByRole("heading", { name: "Description", exact: true }),
  ).toBeVisible();
  await expect(
    drawer.getByRole("textbox", { name: "Criterion 1", exact: true }),
  ).not.toBeVisible();
  await drawer
    .getByRole("button", { name: "Edit Description", exact: true })
    .click();
  const description = drawer.getByRole("textbox", {
    name: "Description",
    exact: true,
  });
  await description.fill("A newcomer should immediately see where to go.");
  await description.press("Control+s");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__jamMock.getStory("JB-S1"))).story
          .outcomeMd,
    )
    .toBe("A newcomer should immediately see where to go.");
  await openAgentPlan(page);
  const criterion = drawer.getByRole("textbox", {
    name: "Criterion 1",
    exact: true,
  });
  await expect(criterion).toBeVisible();
  await criterion.fill("An unsaved acceptance draft");
  const disclosure = drawer.locator("details.agent-plan > summary");
  await disclosure.click();
  await disclosure.press("Enter");
  await expect(criterion).toHaveValue("An unsaved acceptance draft");
  const current = await page.evaluate(() => window.__jamMock.getStory("JB-S1"));
  expect(current.story.acceptance).toEqual(before.story.acceptance);
  expect(current.story.openDecisionsMd).toBe(before.story.openDecisionsMd);
});
