import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__jamMock);
  await page.evaluate(() => window.__jamMock.loadDemoJam());
});

test("a human starts the story, workers claim within it, and pause keeps reporting available", async ({
  page,
}) => {
  const task = await page.evaluate(() => window.__jamMock.getTask("JB-7"));
  const blocked = await page.evaluate(async () => {
    try {
      await window.__jamMock.simulateAgent({
        action: "task.claimed",
        key: "JB-7",
      });
      return false;
    } catch (error) {
      return (error as { code: string }).code === "execution_required";
    }
  });
  expect(blocked).toBe(true);
  await page.goto(`/plan/${task.epic.key}?story=${task.story.key}`);
  await page.getByRole("button", { name: "Start story", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: `Start ${task.story.key}?`,
  });
  await expect(confirmation).toContainText(task.story.title);
  await expect(confirmation).toContainText("does not launch");
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(
    (
      await page.evaluate(
        (id) => window.__jamMock.getExecution({ type: "story", id }),
        task.story.id,
      )
    ).effectiveState,
  ).toBe("paused");
  await page.getByRole("button", { name: "Start story", exact: true }).click();
  await confirmation
    .getByRole("button", { name: `Start ${task.story.key}`, exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({ action: "task.claimed", key: "JB-7" }),
  );
  const story = page.getByRole("dialog", { name: task.story.key, exact: true });
  await story
    .getByRole("button", { name: "Pause new work", exact: true })
    .click();
  await expect(
    story.getByRole("button", { name: "Start story", exact: true }),
  ).toBeEnabled();
  const pausedTask = await page.evaluate(() =>
    window.__jamMock.getTask("JB-7"),
  );
  expect(pausedTask.status).toBe("in_progress");
  expect(pausedTask.assigneeId).not.toBeNull();
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({ action: "report.submitted", key: "JB-7" }),
  );
  expect(
    (await page.evaluate(() => window.__jamMock.getTask("JB-7"))).status,
  ).toBe("review");
});

test("a chat-side request is planning until the exact Inbox approval is confirmed", async ({
  page,
}) => {
  const request = await page.evaluate(async () => {
    const task = await window.__jamMock.getTask("JB-7");
    await window.__jamMock.setBrain(task.epic.key, "codex");
    await window.__jamMock.simulateAgent({
      action: "execution.requested",
      scope: { type: "story", id: task.story.id },
      text: "Implement the reviewed outcome.",
    });
    return (await window.__jamMock.listExecutionRequests("pending"))[0];
  });
  if (!request) throw new Error("Missing typed request");
  await page.goto("/inbox");
  const card = page.getByRole("article", {
    name: `Start request: ${request.scopeKey}`,
  });
  await expect(card).toContainText("not a clarification question");
  await card.getByRole("button", { name: "Review start", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: `Approve start of ${request.scopeKey}?`,
  });
  await expect(confirmation).toContainText(request.scopeTitle);
  expect(
    (
      await page.evaluate(
        (scope) => window.__jamMock.getExecution(scope),
        request.scope,
      )
    ).effectiveState,
  ).toBe("paused");
  await confirmation
    .getByRole("button", {
      name: `Approve & start ${request.scopeKey}`,
      exact: true,
    })
    .click();
  await expect(confirmation).not.toBeVisible();
  await expect(card).not.toBeVisible();
  expect(
    (
      await page.evaluate(
        (scope) => window.__jamMock.getExecution(scope),
        request.scope,
      )
    ).effectiveState,
  ).toBe("running");
  await page.getByRole("radio", { name: "Answered", exact: true }).click();
  await expect(
    page.getByRole("article", { name: `Start request: ${request.scopeKey}` }),
  ).toContainText("approved");
});
