// Alpha35 live-tooltip browser check. Typechecked, not executed locally.
import { expect, test } from "@playwright/test";
import { setTheme } from "./assertions";

for (const theme of ["light", "dark"] as const) {
  test(`CP01/03/05 ${theme}: open presence tooltip follows fresh and expired status`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Load demo jam", exact: true })
      .click();
    await setTheme(page, theme);
    const captured = await page.evaluate(async () => {
      await window.__jamMock.startAllDemoScopes();
      const candidate = (await window.__jamMock.listBoardTasks()).ready.find(
        (task) => !task.assigneeId,
      );
      if (!candidate) throw Error("No fictional Ready fixture");
      await window.__jamMock.simulateAgent({
        action: "task.claimed",
        key: candidate.key,
        agent: "Tooltip worker",
      });
      const task = (await window.__jamMock.listBoardTasks()).in_progress.find(
        (row) => row.key === candidate.key,
      );
      if (!task) throw Error("Claimed fixture is not In progress");
      return { key: candidate.key, task };
    });
    const card = page.locator(
      `[data-testid="task-card"][data-key="${captured.key}"]`,
    );
    const line = card.getByTestId("working-line");
    await expect(line).toHaveAttribute("data-mode", "quiet");
    await expect(line).not.toHaveAttribute("title");
    await line.locator(".tooltip-wrap").hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("unconfirmed");
    await page.evaluate(async (key) => {
      await window.__jamMock.simulateAgent({
        action: "agent.status",
        agent: "Tooltip worker",
        scope: { type: "task", id: key },
        text: "Checking the fictional scene",
      });
    }, captured.key);
    await expect(line).toHaveAttribute("data-mode", "active");
    await expect(tooltip).toContainText("Checking the fictional scene");
    const bounds = await tooltip.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw Error("No visible tooltip bounds");
    const viewport = page.viewportSize();
    if (!viewport) throw Error("No browser viewport");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    await page.evaluate(async (key) => {
      await window.__jamMock.simulateAgent({
        action: "agent.status",
        agent: "Tooltip worker",
        scope: { type: "task", id: key },
        text: "Checking the fictional scene",
        lastSeenAt: new Date(Date.now() - 121000).toISOString(),
      });
    }, captured.key);
    await expect(line).toHaveAttribute("data-mode", "quiet");
    await expect(tooltip).toContainText("unconfirmed");
    await expect(tooltip).not.toContainText("Checking the fictional scene");
    expect(
      await page.evaluate(
        async (key) =>
          (await window.__jamMock.listBoardTasks()).in_progress.find(
            (task) => task.key === key,
          ),
        captured.key,
      ),
    ).toEqual(captured.task);
    await page.screenshot({
      path: testInfo.outputPath(`presence-tooltip-expired-${theme}.png`),
    });
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
  });
}
