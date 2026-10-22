import { expect, test } from "@playwright/test";

test("working presence is live, scoped, quiet when stale, and absent after clear/offline", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  const key = await page.evaluate(async () => {
    // Explicit human fixture action: presence checks do not authorize work.
    await window.__jamMock.startAllDemoScopes();
    const tasks = await window.__jamMock.listBoardTasks();
    const task = tasks.ready.find((t) => !t.assigneeId);
    if (!task) throw Error("No unassigned Ready fixture");
    await window.__jamMock.simulateAgent({
      action: "task.claimed",
      key: task.key,
      agent: "Worker",
    });
    return task.key;
  });
  const card = page.locator(`[data-testid="task-card"][data-key="${key}"]`);
  await expect(card.getByTestId("working-line")).toHaveCount(0);
  await page.evaluate(
    async (key) =>
      window.__jamMock.simulateAgent({
        action: "agent.status",
        agent: "Worker",
        scope: { type: "task", id: key },
        text: "implementing snow tiles",
      }),
    key,
  );
  await expect(card.getByTestId("working-line")).toHaveText(
    "Worker · implementing snow tiles",
    { timeout: 1000 },
  );
  await expect(card.locator(".working-ring")).toHaveCount(1);
  await expect(card.locator(".working-pencil")).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-working-visible", "true");
  await expect(card.locator(".working-ring")).toHaveCSS(
    "animation-play-state",
    "running",
  );
  const state = await card.locator(".working-ring").evaluate((el) => ({
    duration: getComputedStyle(el).animationDuration,
    dash: getComputedStyle(el.querySelector("circle") as Element)
      .strokeDasharray,
  }));
  expect(state.duration).toBe("8s");
  expect(state.dash).toBe("4px, 3px");
  await page.goto(`/table?q=${key}`);
  const row = page.locator(`[data-task-key="${key}"]`);
  await expect(row).toHaveAttribute("data-working", "active");
  await expect(row.locator(".working-ring")).toHaveCSS("width", "16px");
  const paintedRing = page.locator(`[data-working-keys~="${key}"]`);
  await expect(paintedRing).toHaveAttribute("data-mode", "active");
  await expect(page.locator(".table-working-rotor")).toHaveCSS(
    "animation-duration",
    "8s",
  );
  const ringBox = await paintedRing.boundingBox();
  const avatarBox = await row.locator(".table-avatar").boundingBox();
  expect(ringBox).not.toBeNull();
  expect(avatarBox).not.toBeNull();
  if (ringBox && avatarBox) {
    expect(
      Math.abs(
        ringBox.x + ringBox.width / 2 - avatarBox.x - avatarBox.width / 2,
      ),
    ).toBeLessThan(1);
    expect(
      Math.abs(
        ringBox.y + ringBox.height / 2 - avatarBox.y - avatarBox.height / 2,
      ),
    ).toBeLessThan(1);
  }
  const firstRotation = await page
    .locator(".table-working-rotor")
    .evaluate((el) => getComputedStyle(el).strokeDashoffset);
  await expect
    .poll(() =>
      page
        .locator(".table-working-rotor")
        .evaluate((el) => getComputedStyle(el).strokeDashoffset),
    )
    .not.toBe(firstRotation);
  await row.click();
  await expect(page.getByTestId("working-pill")).toContainText(
    "Worker is working · implementing snow tiles",
  );
  await expect(page.getByTestId("working-pill")).toHaveCSS(
    "text-transform",
    "none",
  );
  await page.keyboard.press("Escape");
  await page.goto("/board");
  await page.waitForFunction(() => !!window.__jamMock);
  await page.evaluate(
    async (key) =>
      window.__jamMock.simulateAgent({
        action: "agent.status",
        agent: "Worker",
        scope: { type: "task", id: key },
        text: "implementing snow tiles",
        statusAt: new Date(Date.now() - 42 * 60000).toISOString(),
      }),
    key,
  );
  await expect(card.getByTestId("working-line")).toHaveAttribute(
    "data-mode",
    "quiet",
  );
  await expect(card.getByTestId("working-line")).toHaveText(
    "Worker · last update 42 min ago",
  );
  await expect(card.locator(".working-ring")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.goto(`/table?q=${key}`);
  await expect(row).toHaveAttribute("data-working", "quiet");
  await expect(paintedRing).toHaveAttribute("data-mode", "quiet");
  await expect(paintedRing).toHaveCSS("stroke-dashoffset", "0px");
  await expect(row.locator(".working-ring")).toHaveCSS(
    "animation-name",
    "none",
  );
  await row.click();
  await expect(page.getByTestId("working-pill")).toHaveText(
    "Worker · last update 42 min ago",
  );
  await page.keyboard.press("Escape");
  await page.goto("/board");
  await page.waitForFunction(() => !!window.__jamMock);
  await page.evaluate(async () =>
    window.__jamMock.simulateAgent({
      action: "agent.status",
      agent: "Worker",
      text: "planning next steps",
    }),
  );
  await expect(card.getByTestId("working-line")).toHaveText(
    "Worker · task activity unconfirmed",
  );
  await expect(card.getByTestId("working-line")).toHaveAttribute(
    "data-mode",
    "quiet",
  );
  await expect(card.locator(".working-ring")).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.evaluate(async () =>
    window.__jamMock.simulateAgent({
      action: "agent.status",
      agent: "Worker",
      scope: { type: "task", id: "another-task" },
      text: "checking another brief",
    }),
  );
  await expect(card.getByTestId("working-line")).toHaveText(
    "Worker · active elsewhere",
  );
  await expect(card.getByTestId("working-line")).toHaveAttribute(
    "data-mode",
    "quiet",
  );
  await page.evaluate(async () =>
    window.__jamMock.simulateAgent({
      action: "agent.status",
      agent: "Worker",
      text: "",
    }),
  );
  await expect(card.getByTestId("working-line")).toHaveCount(0);
  await page.evaluate(async () =>
    window.__jamMock.simulateAgent({
      action: "agent.status",
      agent: "Worker",
      text: "implementing snow tiles",
      lastSeenAt: new Date(Date.now() - 121000).toISOString(),
    }),
  );
  await expect(card.getByTestId("working-line")).toHaveCount(0);
});

test("reduced motion stays readable and offscreen work animations pause", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  const key = await page.evaluate(async () => {
    await window.__jamMock.seedBulk(60);
    await window.__jamMock.seedWorkingPresence(50);
    const tasks = (await window.__jamMock.listBoardTasks()).in_progress;
    const members = await window.__jamMock.listMembers();
    // Each live worker reports one actual task, not every assigned card.
    for (const task of tasks.slice(0, 50)) {
      const member = members.find((member) => member.id === task.assigneeId);
      if (!member) throw new Error("Missing working fixture member");
      await window.__jamMock.simulateAgent({
        action: "agent.status",
        agent: member.handle,
        scope: { type: "task", id: task.id },
        text: "implementing snow tiles",
      });
    }
    return tasks[49]?.key;
  });
  await page.reload();
  await expect(page.getByTestId("task-card")).toHaveCount(82);
  const card = page.locator(`[data-testid="task-card"][data-key="${key}"]`);
  await expect(card).toHaveAttribute("data-working-visible", "false");
  await expect(card.locator(".working-ring")).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-working-visible", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const element of await card.locator(".working-animated").all())
    await expect(element).toHaveCSS("animation-name", "none");
  await expect(card.locator(".working-underline path")).toHaveCSS(
    "stroke-dashoffset",
    "0px",
  );
  await expect(card.getByTestId("working-line")).toContainText(
    "implementing snow tiles",
  );
  await expect(card.getByTestId("working-line")).toHaveAttribute(
    "data-mode",
    "active",
  );
  await page.goto("/table?sort=key:asc");
  const firstPaintSlot = page.locator(
    '.table-working-layer path[data-mode="active"]',
  );
  await expect(firstPaintSlot).toBeAttached();
  const node = await firstPaintSlot.elementHandle();
  const oldKey = await firstPaintSlot.getAttribute("data-working-keys");
  await page.getByTestId("table-scroll").evaluate((el) => {
    el.scrollTop = 1440;
  });
  await expect(firstPaintSlot).not.toHaveAttribute(
    "data-working-keys",
    oldKey ?? "",
  );
  expect(
    await firstPaintSlot.evaluate((current, prior) => current === prior, node),
  ).toBe(true);
  await node?.dispose();
});
