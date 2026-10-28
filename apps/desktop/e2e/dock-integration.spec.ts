import { expect, type Page, test } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.evaluate(async () => {
    const mockPath = "/src/lib/agent-dock-mock.ts";
    const uiPath = "/src/lib/ui-store.ts";
    const { mockDockApi } = await import(mockPath);
    const { useUiStore } = await import(uiPath);
    const original = mockDockApi.startSession;
    (window as unknown as { launches: unknown[] }).launches = [];
    mockDockApi.startSession = async (input: object) => {
      (window as unknown as { launches: unknown[] }).launches.push(input);
      return original(input);
    };
    useUiStore.getState().setBrainDockOpen(true);
  });
}

test("Q1 BD23/BC12 saving global config stays readable at 375 px and dispatches once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.evaluate(async () => {
    const apiPath = "/src/lib/agent-dock-mock.ts";
    const { mockDockApi } = await import(apiPath);
    const original = mockDockApi.saveUserConfigDefault;
    const fixture = window as unknown as {
      saves: number;
      releaseSave: () => void;
    };
    fixture.saves = 0;
    mockDockApi.saveUserConfigDefault = async (value: string) => {
      fixture.saves++;
      await new Promise<void>((resolve) => {
        fixture.releaseSave = resolve;
      });
      return original(value);
    };
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const select = page.getByRole("combobox", { name: /global agent config/i });
  await select.click();
  await page.getByRole("option", { name: "Always", exact: true }).click();
  await expect(select).toBeDisabled();
  const saving = page.getByRole("status").filter({ hasText: "Saving…" });
  await expect(saving).toBeVisible();
  await expect(
    page.locator(".brain-agent-config [aria-busy=true]"),
  ).toBeVisible();
  await expect(saving.locator("svg")).toHaveCount(1);
  const progressBox = await saving.boundingBox();
  expect(progressBox?.x).toBeGreaterThanOrEqual(0);
  expect((progressBox?.x ?? 0) + (progressBox?.width ?? 0)).toBeLessThanOrEqual(
    375,
  );
  expect(
    await saving.evaluate((e) => e.getBoundingClientRect().height),
  ).toBeLessThan(30);
  await select.click({ force: true, timeout: 250 }).catch(() => {});
  expect(
    await page.evaluate(() => (window as unknown as { saves: number }).saves),
  ).toBe(1);
  await page.evaluate(() =>
    (window as unknown as { releaseSave: () => void }).releaseSave(),
  );
  await expect(select).toBeEnabled();
  await expect(select).toContainText("Always");
});
test("O1 New chat and terminal Ask cancel without launch; include/exclude stay explicit and chip changes the next launch", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const question = page.getByRole("region", {
    name: "Global agent config",
    exact: true,
  });
  await expect(question).toContainText(
    "Global instruction files and managed policy can still apply.",
  );
  await question.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { launches: unknown[] }).launches.length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await question
    .getByRole("button", { name: "Don't use", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Global config: off", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Global config: off", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Global config for next launch" })
    .click();
  await page.getByRole("option", { name: "On", exact: true }).click();
  await expect(
    page.getByText("Next launch: on", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(question).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Global config: on", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tablist", { name: "Brain mode" })
    .getByRole("tab", { name: "Terminal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open terminal", exact: true })
    .click();
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { launches: unknown[] }).launches.length,
    ),
  ).toBe(2);
  await page
    .getByRole("button", { name: "Open terminal", exact: true })
    .click();
  await question
    .getByRole("button", { name: "Use global config", exact: true })
    .click();
  await expect(page.locator(".brain-terminal-host .xterm")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { launches: { userConfig: string }[] }
      ).launches.map((v) => v.userConfig),
    ),
  ).toEqual(["exclude", "include", "include"]);
});

test("W2 Terminal history hides empty entries, supports Rename/Delete, and Resume asks before opening a new terminal", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(async () => {
    const historyPath = "/src/lib/agent-dock-phase4-mock.ts";
    const storePath = "/src/features/brain/brain-store.ts";
    const { seedMockHistory } = await import(historyPath);
    const { useBrainState } = await import(storePath);
    const at = new Date().toISOString();
    const base = {
      projectId: useBrainState.getState().projectId,
      profileId: "codex-cli",
      profileLabel: "Codex CLI",
      provider: { label: "Codex", agentKind: "codex" },
      kind: "terminal",
      title: "Terminal review",
      createdAt: at,
      updatedAt: at,
      model: "fixture-model",
      effort: null,
      agentSessionId: "fixture-native-id",
      resumable: "native",
      messageCount: 2,
      empty: false,
    };
    seedMockHistory([
      { ...base, id: "terminal-history" },
      {
        ...base,
        id: "empty-terminal",
        title: "Hidden empty terminal",
        empty: true,
      },
    ]);
  });
  const top = page.getByRole("tablist", { name: "Brain mode" });
  await top.getByRole("tab", { name: "History", exact: true }).click();
  await page
    .getByRole("tablist", { name: "History kind" })
    .getByRole("tab", { name: "Terminal", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Terminal review", exact: true }),
  ).toContainText("Codex · fixture-model");
  await expect(page.getByText("Hidden empty terminal")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "History actions for Terminal review",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "History title" })
    .fill("Renamed terminal");
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Renamed terminal", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "History actions for Renamed terminal",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  const question = page.getByRole("region", {
    name: "Global agent config",
    exact: true,
  });
  await expect(question).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { launches: unknown[] }).launches.length,
    ),
  ).toBe(0);
  await question
    .getByRole("button", { name: "Don't use", exact: true })
    .click();
  await expect(
    top.getByRole("tab", { name: "Terminal", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".brain-terminal-host .xterm")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Global config: off", exact: true }),
  ).toBeVisible();
});

test("O1 Settings Always/Never persist the default and launch without a question", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  const label =
    "Use my global agent config (CLAUDE.md, hooks, personal MCP servers)";
  const preference = page.getByRole("combobox", { name: label, exact: true });
  await expect(preference).toHaveText("Ask every time");
  for (const [setting, chip, choice] of [
    ["Always", "on", "include"],
    ["Never", "off", "exclude"],
  ] as const) {
    await preference.click();
    await page.getByRole("option", { name: setting, exact: true }).click();
    await expect(preference).toHaveText(setting);
    const newChat = page.getByRole("button", { name: "New chat", exact: true });
    await newChat.click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Global agent config", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: `Global config: ${chip}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Message the brain", exact: true }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as { launches: { userConfig: string }[] }
          ).launches.at(-1)?.userConfig,
      ),
    ).toBe(choice);
  }
});
