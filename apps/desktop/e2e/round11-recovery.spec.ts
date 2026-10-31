import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const output = "../../test-visuals/round11/R11-G3/polish";
async function start(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await expect(page.locator(".topbar")).toBeVisible();
}
async function choose(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function add(page: Page, copy: boolean, source: string) {
  const label = copy ? "Copy into board" : "Link existing file";
  await page.getByRole("button", { name: "Add file", exact: true }).click();
  await page.getByRole("button", { name: `${label}…`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: label, exact: true });
  await page.evaluate((path) => {
    window.__jamMock.pickFiles = async () => [path];
  }, source);
  await dialog
    .getByRole("button", { name: "Choose files…", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Add files", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test("R11-G3 full shared-mock browser story: create, files, roles, selection, move and global recovery", async ({
  page,
}) => {
  await start(page);
  const legacyId = await page.evaluate(async () => {
    const state = await window.__jamMock.appState();
    if (!state.jam) throw new Error("Missing demo project");
    return state.jam.id;
  });
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const create = page.getByRole("dialog", {
    name: "Create project folder",
    exact: true,
  });
  await create
    .getByLabel("Project name", { exact: true })
    .fill("Lantern workshop");
  await page.evaluate(() => {
    window.__jamMock.pickFolder = async () => "C:/fictional/Workshop";
  });
  await create
    .getByRole("button", { name: "Choose folder…", exact: true })
    .click();
  await create
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(create).toHaveCount(0);
  const task = await page.evaluate(async () => {
    const task = await window.__jamMock.createTask({
      title: "Build lantern",
      status: "backlog",
    });
    return { key: task.key, projectId: task.jamId };
  });
  await page.goto(`/board?task=${task.key}`);
  await add(page, true, "C:/source/Lantern.glb");
  await add(page, false, "C:/source/config.json");
  await choose(page, "Role for Lantern.glb", "Result");
  await page
    .getByRole("article", { name: "Lantern.glb", exact: true })
    .getByRole("button", { name: "Apply role", exact: true })
    .click();
  await page.getByRole("button", { name: "Open larger", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: task.key, exact: true }),
  ).toHaveAttribute("data-presentation", "modal");
  await expect(
    page
      .getByRole("article", { name: "Lantern.glb", exact: true })
      .getByRole("combobox"),
  ).toHaveText("Result");
  const isolation = await page.evaluate(async ({ projectId }) => {
    const mock = window.__jamMock;
    const a = await mock.taskFiles.capture(projectId);
    await mock.createProjectFolder("C:/fictional/B", "Second board", false);
    const bFiles = await mock.listAssets();
    await mock.openProjectFolder("C:/fictional/Workshop", false);
    let stale = false;
    try {
      await mock.taskFiles.list(a);
    } catch {
      stale = true;
    }
    return {
      bFiles: bFiles.length,
      aFiles: (await mock.listAssets()).length,
      stale,
    };
  }, task);
  expect(isolation).toEqual({ bFiles: 0, aFiles: 2, stale: true });
  await page.evaluate(async (id) => {
    await window.__jamMock.selectProject(id);
  }, legacyId);
  await page.goto("/projects");
  await page.evaluate(() => {
    window.__jamMock.pickFolder = async () => "C:/fictional/MoveParent";
  });
  await page.getByRole("button", { name: /^Move to folder/ }).click();
  const move = page.getByRole("dialog", {
    name: "Move to folder",
    exact: true,
  });
  await move
    .getByRole("button", { name: "Choose destination…", exact: true })
    .click();
  await move.getByLabel("New folder name").fill("MovedBoard");
  await move
    .getByRole("button", { name: "Move to folder", exact: true })
    .click();
  await expect(move.getByText("Move complete", { exact: true })).toBeVisible();
  await move.getByRole("button", { name: "Done", exact: true }).click();
  await expect(move).toHaveCount(0);
  await page.goto("/board");
  await expect(page.locator(".topbar")).toBeVisible();
  await page.evaluate(() => {
    window.__jamMock.folders.external = {
      liveHash: "live",
      externalHash: "external",
      liveRevision: 1,
      externalRevision: 2,
      externalValid: true,
      changedTables: ["tasks"],
      error: null,
    };
    window.__jamMock.emit([]);
  });
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const recovery = page.getByRole("dialog", {
    name: "Review board.json",
    exact: true,
  });
  await recovery.getByRole("button", { name: "Compare", exact: true }).click();
  const before = await page.evaluate(
    async () => (await window.__jamMock.projectFolderInfo()).databaseGeneration,
  );
  await recovery
    .getByRole("button", { name: "Restore from board.json", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.__jamMock.projectFolderInfo()).databaseGeneration,
      ),
    )
    .not.toBe(before);
  expect(
    await page.evaluate(async () =>
      (await window.__jamMock.listExecution()).every(
        (scope) => scope.effectiveState === "paused",
      ),
    ),
  ).toBe(true);
});

for (const variant of [
  { name: "1440-light", width: 1440, dark: false },
  { name: "1440-dark", width: 1440, dark: true },
  { name: "1000-light", width: 1000, dark: false },
  { name: "375-light", width: 375, dark: false },
]) {
  test(`R11-G3 visual surfaces ${variant.name}`, async ({ page }) => {
    await page.setViewportSize({ width: variant.width, height: 1000 });
    await start(page);
    await page.evaluate(async (dark) => {
      await window.__jamMock.setTheme(dark ? "dark" : "light");
      await window.__jamMock.updateProject({
        name: "Lantern workshop with a deliberately long project name",
        template: "custom",
      });
    }, variant.dark);
    const shot = async (state: string) => {
      if (
        ![
          "topbar-board",
          "topbar-actions",
          "move-progress",
          "move-interrupted",
        ].includes(state)
      )
        return;
      await page.evaluate(() => document.fonts.ready);
      await mkdir(output, { recursive: true });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${output}/${state}-${variant.name}.png`,
        animations: "disabled",
        fullPage: state === "projects-missing" && variant.width === 375,
      });
    };
    await page.goto("/board");
    await expect(page.locator(".topbar")).toBeVisible();
    await shot("topbar-board");
    if (variant.width === 375) {
      await page
        .getByRole("button", { name: "More board actions", exact: true })
        .click();
      const menu = page.getByRole("menu", {
        name: "Board actions",
        exact: true,
      });
      const newTask = menu.getByRole("menuitem", {
        name: "New task",
        exact: true,
      });
      await expect(newTask).toBeVisible();
      await expect(newTask).toBeFocused();
      await expect(menu.getByRole("menuitem", { name: /Inbox/ })).toContainText(
        "Inbox",
      );
      await expect(
        menu.getByRole("menuitem", { name: "Search Ctrl K" }),
      ).toBeVisible();
      const agentRows = menu.locator('.agent-status-trigger[role="menuitem"]');
      expect(await agentRows.count()).toBeGreaterThan(0);
      for (const row of await agentRows.all()) {
        await expect(row.locator(".topbar-agent-label strong")).not.toBeEmpty();
        await expect(row.locator(".topbar-agent-label small")).not.toBeEmpty();
      }
      await shot("topbar-actions");
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: /Inbox/ })).toBeFocused();
      await page.keyboard.press("End");
      await expect(agentRows.last()).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(menu.locator(".agent-status-popover")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu.locator(".agent-status-popover")).toHaveCount(0);
      await expect(agentRows.last()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      const more = page.getByRole("button", {
        name: "More board actions",
        exact: true,
      });
      await expect(more).toBeFocused();
      await more.press("ArrowUp");
      await expect(agentRows.last()).toBeFocused();
      await page.keyboard.press("Home");
      await expect(newTask).toBeFocused();
      await menu.getByRole("menuitem", { name: "Search Ctrl K" }).click();
      await expect(
        page.getByRole("dialog", { name: "Search & commands", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    }
    // A pointer open must keep the structural container free of the salmon ring.
    await page.getByRole("button", { name: /Open JB-7:/ }).click();
    const surface = page.getByRole("dialog", { name: "JB-7", exact: true });
    await expect(
      surface.getByRole("textbox", { name: "Task title", exact: true }),
    ).toBeVisible();
    await surface
      .getByRole("button", { name: "Open larger", exact: true })
      .click();
    await expect(surface).toHaveAttribute("data-presentation", "modal");
    expect(
      await surface.evaluate((node) => getComputedStyle(node).outlineStyle),
    ).toBe("none");
    await shot("modal-mouse");
    await page.keyboard.press("Tab");
    expect(
      await surface.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
    await shot("modal-tab");
    await page.goto("/assets");
    await expect(
      page.getByRole("heading", { name: "Assets", exact: true }),
    ).toBeVisible();
    await shot("topbar-assets");
    await page.evaluate(() => {
      const folders = window.__jamMock.folders;
      folders.entries.push({
        instanceId: "offline-instance",
        projectId: "offline-project",
        projectName: "Offline lantern archive",
        canonicalFolder: "C:/offline/Archive",
        displayFolder: "C:/offline/Archive",
        availability: "unavailable",
        repoCommonDir: null,
        lastOpenedAt: "2026-10-30T00:00:00Z",
        migrationId: null,
      });
      folders.interrupt = true;
      const original = folders.move.bind(folders);
      folders.move = async (...args) => {
        const receipt = await original(...args);
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return receipt;
      };
      window.__jamMock.pickFolder = async () => "C:/fictional/VisualMove";
    });
    // Projects is a standalone route; its navigation header is captured as rendered.
    await page.getByRole("link", { name: /Switch project/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Offline lantern archive",
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot("projects-missing");
    await page.getByRole("button", { name: /^Move to folder/ }).click();
    const move = page.getByRole("dialog", {
      name: "Move to folder",
      exact: true,
    });
    await move
      .getByRole("button", { name: "Choose destination…", exact: true })
      .click();
    await move
      .getByRole("button", { name: "Move to folder", exact: true })
      .click();
    await expect(move.locator('[aria-current="step"]')).toHaveText(
      /Copying files/,
    );
    await expect(
      move.getByText("Copying files\u2026", { exact: true }),
    ).toBeVisible();
    await expect(move.locator(".dialog-actions")).toHaveCount(0);
    const steps = move.locator(".folder-progress li");
    const positions = await steps.evaluateAll((nodes) =>
      nodes.map((node) => ({
        x: node.getBoundingClientRect().x,
        y: node.getBoundingClientRect().y,
      })),
    );
    if (variant.width >= 600) {
      expect(new Set(positions.map((p) => Math.round(p.y))).size).toBe(1);
      const gaps = positions.slice(1).map((p, i) => {
        const previous = positions[i];
        if (!previous) throw new Error("Missing previous move step");
        return p.x - previous.x;
      });
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
      for (const connector of await move
        .locator(".folder-step-connector")
        .all()) {
        const painted = await connector.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            color: style.backgroundColor,
            left: style.marginLeft,
            right: style.marginRight,
            width: node.getBoundingClientRect().width,
          };
        });
        expect(painted.color).not.toBe("rgba(0, 0, 0, 0)");
        expect(painted.left).toBe(painted.right);
        expect(painted.width).toBeGreaterThan(0);
      }
      expect(
        await move
          .locator(".folder-step-marker")
          .last()
          .evaluate((node) => getComputedStyle(node).borderTopWidth),
      ).toBe("1px");
    } else {
      expect(new Set(positions.map((p) => Math.round(p.x))).size).toBe(1);
    }
    await expect(
      move.locator('.folder-step-connector[aria-hidden="true"]'),
    ).toHaveCount(4);
    await shot("move-progress");
    await expect(
      move.getByText("Move interrupted while copying files", { exact: true }),
    ).toBeVisible();
    await expect(
      move.getByText(
        "Your board is still safe in its old place. Resume to continue, or roll back to undo.",
      ),
    ).toBeVisible();
    await expect(
      move.getByRole("button", { name: "Resume", exact: true }),
    ).toBeEnabled();
    await expect(
      move.getByRole("button", { name: "Roll back", exact: true }),
    ).toBeEnabled();
    await shot("move-interrupted");
  });
}
