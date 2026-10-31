import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  completeProjectFolder,
  expectBoardReachable,
  expectPoliteNotice,
  setTheme,
  withoutFileCheckTimes,
} from "./assertions";

async function demo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo jam" }).click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
}
test("onboarding creates a jam and an empty board", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Game jam", exact: true }).click();
  await page.getByLabel("Jam name", { exact: true }).fill("A little snowy jam");
  await page.getByLabel("Your name", { exact: true }).fill("Danil");
  await page.getByRole("button", { name: "Create jam", exact: true }).click();
  await completeProjectFolder(page);
  await expect(page).toHaveURL(/\/board/);
  await expect(page.getByTestId("task-card")).toHaveCount(0);
  await expect(page.locator(".column-empty")).toHaveCount(5);
  for (const status of ["backlog", "ready", "in_progress", "review", "done"]) {
    await expect(
      page.locator(`[data-column="${status}"] .column-empty`),
    ).toHaveText("No tasks yet");
  }
  await expect(
    page.getByRole("link", {
      name: "Switch project · A little snowy jam",
      exact: true,
    }),
  ).toBeVisible();
});
test("demo loads all 22 cards and opens a task by URL", async ({ page }) => {
  await demo(page);
  await expectBoardReachable(page);
  await page.getByRole("button", { name: /Open JB-2:/ }).click();
  await expect(page).toHaveURL(/task=JB-2/);
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Player movement: coyote time & jump buffer",
  );
  await page.getByRole("button", { name: "Close task", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("pointer drag moves Ready into In progress after its scope is started", async ({
  page,
}) => {
  await demo(page);
  await page.evaluate(() => window.__jamMock.startAllDemoScopes());
  const before = await page.evaluate(() => window.__jamMock.getTask("JB-2"));
  const card = page.getByRole("button", { name: /Open JB-2:/ });
  const target = page.locator('[data-column="in_progress"] .column-heading');
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + 80, from.y + 60);
  await page.mouse.down();
  await page.mouse.move(from.x + 90, from.y + 60, { steps: 3 });
  await page.mouse.move(to.x + 80, to.y + 60, { steps: 15 });
  await page.mouse.up();
  await expect(
    page.locator('[data-column="in_progress"] [data-key="JB-2"]'),
  ).toBeVisible();
  const moves = await page.evaluate(() =>
    window.__jamMock.calls.filter((call) => call.command === "move_task"),
  );
  expect(moves).toHaveLength(1);
  expect(moves[0]?.input).toMatchObject({
    key: "JB-2",
    status: "in_progress",
    expectedUpdatedAt: before.updatedAt,
  });
  expect(
    (await page.evaluate(() => window.__jamMock.getTask("JB-2"))).status,
  ).toBe("in_progress");
});
test("inline create and N shortcut", async ({ page }) => {
  await demo(page);
  await page.keyboard.press("n");
  const input = page.getByRole("textbox", { name: "New task in Backlog" });
  await input.fill("A tiny campfire");
  await input.press("Enter");
  await expect(page.getByTestId("task-card")).toHaveCount(23);
  await expect(
    page.getByText("A tiny campfire", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await input.press("Escape");
});
test("agent creation highlights a card, shows a toast and expires", async ({
  page,
}) => {
  await demo(page);
  const normalShadow = await page
    .locator('[data-key="JB-1"]')
    .evaluate((e) => getComputedStyle(e).boxShadow);
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "task.created",
      title: "Add jump buffer",
      status: "backlog",
    }),
  );
  await expect(page.locator('[data-key="JB-23"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expectPoliteNotice(page, "Codex created JB-23 · Add jump buffer");
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(
    "Add jump buffer",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-key="JB-23"]')).toHaveAttribute(
    "data-highlighted",
    "false",
    { timeout: 6000 },
  );
  await expect(page.locator('[data-key="JB-23"]')).toHaveCSS(
    "box-shadow",
    normalShadow,
    { timeout: 2000 },
  );
});
test("dark theme applies to paper and cards", async ({ page }) => {
  await demo(page);
  await page.getByRole("radio", { name: "None", exact: true }).click();
  await setTheme(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const papers = page.getByTestId("task-card").locator(".task-card");
  await page.mouse.move(30, 70);
  await expect
    .poll(async () =>
      papers.evaluateAll(
        (cards) =>
          new Set(cards.map((card) => getComputedStyle(card).backgroundColor))
            .size,
      ),
    )
    .toBe(1);
  await expect(papers.first()).toHaveCSS("clip-path", "none");
  await expect(papers.first()).toHaveCSS("background-color", "rgb(46, 41, 37)");
});
test("keyboard opens cards and edits status without dragging; reduced motion retains agent feedback", async ({
  page,
}) => {
  await demo(page);
  const before = await page.evaluate(() => window.__jamMock.getTask("JB-2"));
  const card = page.getByRole("button", { name: /Open JB-2:/ });
  await card.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(
    before.title,
  );
  await expect(page.locator(".card-button.dragging")).toHaveCount(0);
  await page.getByRole("button", { name: "Close task", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(card).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
  expect(
    withoutFileCheckTimes(
      await page.evaluate(() => window.__jamMock.getTask("JB-2")),
    ),
  ).toEqual(withoutFileCheckTimes(before));
  expect(
    await page.evaluate(() =>
      window.__jamMock.calls.filter((call) => call.command === "move_task"),
    ),
  ).toHaveLength(0);
  // The existing status control remains a keyboard path; it does not reorder a column.
  const status = page.getByRole("combobox", { name: "Status", exact: true });
  await status.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(status).toContainText("Backlog");
  await page.getByRole("button", { name: /^Save Ctrl/ }).focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__jamMock.getTask("JB-2"))).status,
    )
    .toBe("backlog");
  const edits = await page.evaluate(() =>
    window.__jamMock.calls.filter((call) => call.command === "update_task"),
  );
  expect(edits).toHaveLength(1);
  expect(edits[0]?.input).toMatchObject({
    key: "JB-2",
    status: "backlog",
    expectedUpdatedAt: before.updatedAt,
  });
  await expect(
    page
      .locator('[data-column="backlog"]')
      .getByRole("button", { name: /Open JB-2:/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Task title" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() =>
    window.__jamMock.simulateAgent({
      action: "task.created",
      status: "backlog",
      title: "Quiet lantern animation",
    }),
  );
  await expect(page.locator('[data-key="JB-23"]')).toHaveCSS(
    "transform",
    "none",
  );
  await expect(page.locator('[data-key="JB-23"]')).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expectPoliteNotice(page, "Quiet lantern animation");
});
test("minimum window, expanded navigation and Team screen", async ({
  page,
}) => {
  await demo(page);
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "216px");
  await expect(
    page.getByRole("button", { name: "New task · N", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The team" })).toBeVisible();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(page.getByTestId("task-card")).toHaveCount(22);
});

for (const theme of ["light", "dark"] as const) {
  test(`keyboard-active Status option is visibly distinct without changing selection (${theme})`, async ({
    page,
  }) => {
    await demo(page);
    await setTheme(page, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const before = await page.evaluate(() => window.__jamMock.getTask("JB-2"));
    await page.getByRole("button", { name: /Open JB-2:/ }).click();
    const status = page.getByRole("combobox", { name: "Status", exact: true });
    await status.focus();
    await page.mouse.move(0, 0); // Hover must not accidentally supply the keyboard highlight.
    await page.keyboard.press("Home");
    const active = page.getByRole("option", { name: "Backlog", exact: true });
    const selected = page.getByRole("option", { name: "Ready", exact: true });
    await expect(active).toHaveAttribute("aria-selected", "false");
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(status).toHaveAttribute(
      "aria-activedescendant",
      (await active.getAttribute("id")) ?? "missing option",
    );
    const expected = await active.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--paper-2)";
      element.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(expected).not.toBe("rgba(0, 0, 0, 0)");
    await expect(active).toHaveCSS("background-color", expected);
    await expect(selected).not.toHaveCSS("background-color", expected);
    await page.keyboard.press("ArrowDown");
    await expect(status).toHaveAttribute(
      "aria-activedescendant",
      (await selected.getAttribute("id")) ?? "missing option",
    );
    await expect(selected).toHaveCSS("background-color", expected);
    await expect(active).not.toHaveCSS("background-color", expected);
    await page.keyboard.press("Escape");
    await expect(status).toContainText("Ready");
    expect(
      withoutFileCheckTimes(
        await page.evaluate(() => window.__jamMock.getTask("JB-2")),
      ),
    ).toEqual(withoutFileCheckTimes(before));
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`H-B01: concise readable empty columns with a long card at narrow width (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/");
    await page.getByRole("button", { name: "Game jam", exact: true }).click();
    await page
      .getByLabel("Jam name", { exact: true })
      .fill("Empty column readability");
    await page
      .getByLabel("Your name", { exact: true })
      .fill("Synthetic reviewer");
    await page.getByRole("button", { name: "Create jam", exact: true }).click();
    await completeProjectFolder(page);
    await expect(page.locator(".column-empty")).toHaveCount(5);
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    for (const element of await page
      .locator(".column-empty, .column-policy")
      .all()) {
      await expect(element).toHaveCSS("font-size", "14px");
      const metrics = await element.evaluate((node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        const parent = node.closest(".board-column")?.getBoundingClientRect();
        return {
          weight: Number(style.fontWeight),
          overflow: node.scrollWidth > node.clientWidth,
          fits:
            !!parent && box.left >= parent.left && box.right <= parent.right,
        };
      });
      expect(metrics.weight).toBe(400);
      expect(metrics.overflow).toBe(false);
      expect(metrics.fits).toBe(true);
    }
    await page.getByRole("button", { name: "Add task to Backlog" }).click();
    await expect(
      page.locator('[data-column="backlog"] .column-empty'),
    ).toHaveCount(0);
    const title =
      "A very long human task title with enough context to wrap across several lines without crowding adjacent empty columns";
    const input = page.getByRole("textbox", { name: "New task in Backlog" });
    await input.fill(title);
    await input.press("Enter");
    await expect(page.getByTestId("task-card")).toHaveCount(1);
    await input.press("Escape");
    await expect(page.locator(".column-empty")).toHaveCount(4);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    expect(
      await page
        .getByTestId("task-card")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    const mutations = await page.evaluate(() =>
      window.__jamMock.calls.filter((call) =>
        /claim_task|move_task|set_execution/.test(call.command),
      ),
    );
    expect(mutations).toEqual([]);
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const reduced of [false, true]) {
    test(`real pointer pickup has a quiet lift and cancellation never moves a task (${theme}, reduced=${reduced})`, async ({
      page,
    }) => {
      await page.emulateMedia({
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      await page.setViewportSize({ width: 1180, height: 812 });
      await demo(page);
      await setTheme(page, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.evaluate(() => document.fonts.ready);
      const before = await page.evaluate(() =>
        window.__jamMock.getTask("JB-2"),
      );
      const card = page.getByRole("button", { name: /Open JB-2:/ });
      const box = await card.boundingBox();
      if (!box) throw new Error("Missing card geometry");
      await page.mouse.move(box.x + 80, box.y + 60);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + 70, { steps: 4 });
      const lifted = page.locator('.sticker-wrap.lifted[data-key="JB-2"]');
      await expect(lifted).toBeVisible();
      await expect
        .poll(() =>
          lifted.evaluate((element) => {
            const matrix = new DOMMatrixReadOnly(
              getComputedStyle(element).transform,
            );
            return Math.hypot(matrix.a, matrix.b);
          }),
        )
        .toBeCloseTo(reduced ? 1 : 1.015, 3);
      await expect
        .poll(() =>
          lifted.evaluate((element) => {
            const matrix = new DOMMatrixReadOnly(
              getComputedStyle(element).transform,
            );
            return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
          }),
        )
        .toBeCloseTo(reduced ? 0 : -0.65, 2);
      const directory = resolve(process.cwd(), "../../test-visuals");
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: resolve(
          directory,
          `readability-card-lift-${theme}${reduced ? "-reduced" : ""}.png`,
        ),
      });
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(lifted).toHaveCount(0);
      expect(
        withoutFileCheckTimes(
          await page.evaluate(() => window.__jamMock.getTask("JB-2")),
        ),
      ).toEqual(withoutFileCheckTimes(before));
      expect(
        await page.evaluate(() =>
          window.__jamMock.calls.filter((call) => call.command === "move_task"),
        ),
      ).toHaveLength(0);
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`short execution instructions stay readable without granting work (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await demo(page);
    await setTheme(page, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.goto("/plan/JB-E1");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const controls = page.getByRole("region", { name: "Epic execution" });
    await controls.getByText("How starting works", { exact: true }).click();
    const help = controls.locator(".execution-help-points");
    await expect(help).toBeVisible();
    await expect(help).toContainText(
      "It does not launch a program or wake a chat",
    );
    await expect(help).toContainText(
      "Work already taken may continue and submit reports",
    );
    await expect(help).toContainText(
      "Opening another project does not pause any work",
    );
    expect(
      await help.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          font: parseFloat(style.fontSize),
          line: parseFloat(style.lineHeight),
          fits: element.scrollWidth <= element.clientWidth,
        };
      }),
    ).toMatchObject({ font: 13, fits: true });
    await help.scrollIntoViewIfNeeded();
    const directory = resolve(process.cwd(), "../../test-visuals");
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: resolve(directory, `readability-instructions-${theme}.png`),
    });
    await expect(
      controls.getByRole("button", { name: "Start epic", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        window.__jamMock.calls.filter((call) =>
          ["set_execution", "claim_task", "move_task"].includes(call.command),
        ),
      ),
    ).toHaveLength(0);
  });
}
