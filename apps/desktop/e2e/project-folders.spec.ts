import { expect, type Locator, type Page, test } from "@playwright/test";

const output = "../../test-visuals/round11/R11-U";
const screenshotStates = process.env.JAM_BOARD_SCREENSHOT_STATES?.split(",");
const projectName = "Мастерская фонарей — длинное название проекта команды";
const legacyName = "Длинный проект наследия — фонари и путешествия команды";
async function fixture(
  page: Page,
  kind:
    | "cloud"
    | "duplicate"
    | "legacy"
    | "interrupt"
    | "recover"
    | "unavailable",
) {
  await page.evaluate(
    async ({ kind, legacyName }) => {
      const path = "/src/lib/mock-project-folders.ts";
      const { mockProjectFolders: folders } = await import(
        /* @vite-ignore */ path
      );
      if (kind === "unavailable") {
        const original = (await window.__jamMock.appState()).jam?.id;
        const missing = await folders.create(
          "C:/Games/Мастерская/Недоступный проект",
          "Пропавший проект — мастерская фонарей",
          false,
        );
        folders.entries.find(
          (entry: { instanceId: string }) =>
            entry.instanceId === missing.instanceId,
        ).availability = "unavailable";
        if (original) await folders.selectLegacy(original);
      }
      if (kind === "cloud")
        window.__jamMock.pickFolder = async () =>
          "C:/Users/Данил/OneDrive/Проекты/Очень длинное название папки для игры/Рабочие материалы/JamBoard";
      if (kind === "duplicate") {
        const info = folders.selected;
        folders.folders.set("C:/clone", { ...info, folder: "C:/clone" });
        window.__jamMock.pickFolder = async () => "C:/clone";
      }
      if (kind === "legacy") {
        const created = await window.__jamMock.createJam({
          name: legacyName,
          yourName: "Human",
          theme: null,
          startsAt: "",
          endsAt: "",
          timezone: "UTC",
          template: "custom",
        });
        for (const title of [
          "Build a lantern",
          "Add warm lighting",
          "Test the level",
        ])
          await window.__jamMock.createTask({ title, status: "backlog" });
        if (!created.jam) throw new Error("Missing legacy fixture");
        folders.inventories.set(created.jam.id, {
          tasks: { count: 3, bytes: 1024 },
          managedCopies: { count: 12, bytes: 48 * 1024 ** 2 },
          linkedFiles: { count: 5, bytes: 6 * 1024 ** 2 },
          missingFileCount: 2,
          missingFiles: ["C:/Art/lantern.blend", "C:/Audio/night.wav"],
        });
        window.__jamMock.pickFolder = async () => "C:/moved-legacy";
      }
      if (kind === "interrupt") {
        folders.interrupt = true;
        const move = folders.move.bind(folders);
        folders.move = async (input: unknown, context: unknown) => {
          const receipt = await move(input, context);
          await new Promise<void>((resolve) => {
            Reflect.set(window, "finishFixtureMove", resolve);
          });
          return receipt;
        };
      }
      if (kind === "recover") {
        folders.external = {
          liveHash: "live",
          externalHash: "external",
          liveRevision: 4,
          externalRevision: 3,
          externalValid: true,
          changedTables: ["tasks", "comments"],
          error: null,
        };
      }
    },
    { kind, legacyName },
  );
}
async function projects(page: Page) {
  await page.getByRole("link", { name: /Switch project/ }).click();
  await expect(
    page.getByRole("heading", { name: "Your projects" }),
  ).toBeVisible();
}

for (const variant of [
  { name: "1440-light", width: 1440, theme: "light" },
  { name: "1440-dark", width: 1440, theme: "dark" },
  { name: "1000", width: 1000, theme: "light" },
  { name: "375", width: 375, theme: "light" },
]) {
  test(`folder lifecycle and changed layouts ${variant.name}`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: variant.width, height: 1000 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Load demo jam", exact: true })
      .click();
    await fixture(page, "unavailable");
    await projects(page);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, variant.theme);
    const shot = async (name: string, focused?: Locator) => {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, variant.theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      if (focused) {
        await focused.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(focused).toBeFocused();
        expect(
          await focused.evaluate(
            (element) =>
              element.matches(":focus-visible") &&
              getComputedStyle(element).outlineStyle !== "none",
          ),
        ).toBe(true);
      }
      if (name.startsWith("settings-folder")) {
        expect(
          await page.locator(".folder-settings").evaluate((section) => {
            const bounds = section.getBoundingClientRect();
            return [...section.querySelectorAll("input,button")]
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                return (
                  rect.left < bounds.left - 1 || rect.right > bounds.right + 1
                );
              })
              .map(
                (element) =>
                  element.getAttribute("aria-label") ?? element.textContent,
              );
          }),
        ).toEqual([]);
      }
      if (!screenshotStates || screenshotStates.includes(name)) {
        await page.screenshot({
          path: `${output}/${name}-${variant.name}.png`,
          fullPage: false,
          animations: "disabled",
        });
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    };
    await expect(
      page.getByText("Folder not found", { exact: true }),
    ).toBeVisible();
    await shot(
      "projects-list",
      page.getByRole("button", { name: "Locate…", exact: true }),
    );
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "Create project folder",
      exact: true,
    });
    await shot(
      "create-empty",
      create.getByLabel("Project name", { exact: true }),
    );
    await create.getByLabel("Project name", { exact: true }).fill(projectName);
    await fixture(page, "cloud");
    await create
      .getByRole("button", { name: "Choose folder…", exact: true })
      .click();
    await expect(
      create.getByRole("button", { name: "Create project", exact: true }),
    ).toBeDisabled();
    await shot("create-cloud", create.getByRole("checkbox"));
    await create.getByRole("checkbox").check();
    await create
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(create).not.toBeVisible();
    await projects(page);
    await fixture(page, "duplicate");
    await page
      .getByRole("button", { name: "Open project folder…", exact: true })
      .click();
    const open = page.getByRole("dialog", {
      name: "Open project folder",
      exact: true,
    });
    await open
      .getByRole("button", { name: "Choose folder…", exact: true })
      .click();
    await open.getByRole("button", { name: "Open", exact: true }).click();
    await expect(
      open.getByRole("radio", {
        name: /Open as a separate copy/,
      }),
    ).toBeVisible();
    await open.getByRole("radio", { name: /Open as a separate copy/ }).check();
    await shot(
      "open-duplicate",
      open.getByRole("radio", {
        name: /Open as a separate copy/,
      }),
    );
    // Separate-copy choice exercises a new project identity on the mock.
    await open.getByRole("radio", { name: /Open as a separate copy/ }).click();
    await open
      .getByRole("button", { name: "Open separate copy", exact: true })
      .click();
    await expect(open).not.toBeVisible();
    await fixture(page, "legacy");
    await projects(page);
    const legacy = page.locator(".project-card").filter({
      has: page.getByRole("heading", { name: legacyName, exact: true }),
    });
    await legacy.getByRole("button", { name: /Move to folder/ }).click();
    const move = page.getByRole("dialog", {
      name: "Move to folder",
      exact: true,
    });
    await move
      .getByRole("button", { name: "Choose destination…", exact: true })
      .click();
    await expect(
      move.getByText(
        "3 tasks · 12 files copied (48 MB) · 5 files stay linked · 2 missing",
        { exact: true },
      ),
    ).toBeVisible();
    await fixture(page, "interrupt");
    await move
      .getByRole("button", { name: "Move to folder", exact: true })
      .click();
    await expect(move.getByText("Copying files…")).toBeVisible();
    await expect(move.locator('[aria-current="step"]')).toHaveText(
      "Copying files",
    );
    await shot("move-progress");
    await page.evaluate(() => {
      const finish = Reflect.get(window, "finishFixtureMove");
      if (typeof finish === "function") finish();
    });
    await expect(
      move.getByText("Move interrupted while copying files", { exact: true }),
    ).toBeVisible();
    await shot(
      "move-interrupted",
      move.getByRole("button", { name: "Resume", exact: true }),
    );
    await page.evaluate(async () => {
      const path = "/src/lib/mock-project-folders.ts";
      const { MockProjectFolders, mockProjectFolders: folders } = await import(
        /* @vite-ignore */ path
      );
      folders.interrupt = false;
      folders.move = MockProjectFolders.prototype.move.bind(folders);
    });
    await move.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      move.getByText("Move complete", { exact: true }),
    ).toBeVisible();
    await move.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("button", { name: "Back to current project", exact: true })
      .click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Folder", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save now", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("heading", { name: "Folder", exact: true })
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    await shot(
      "settings-folder",
      page.getByRole("textbox", { name: "Sprites folder", exact: true }),
    );
    await shot(
      "settings-folder-backups",
      page.getByRole("textbox", { name: "Working directory", exact: true }),
    );
    await fixture(page, "recover");
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    const recovery = page.getByRole("dialog", {
      name: "Review board.json",
      exact: true,
    });
    await recovery
      .getByRole("button", { name: "Compare", exact: true })
      .click();
    await expect(recovery.getByText("Changes: tasks, comments")).toBeVisible();
    await shot(
      "board-recovery",
      recovery.getByRole("button", {
        name: "Restore from board.json",
        exact: true,
      }),
    );
    await recovery
      .getByRole("button", { name: "Restore from board.json", exact: true })
      .click();
    await expect(
      recovery.getByText("Board recovery decision saved."),
    ).toBeVisible();
  });
}
