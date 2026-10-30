import { writeFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";

async function openDock(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Load demo jam", exact: true })
    .click();
  await page.evaluate(async () => {
    const uiPath = "/src/lib/ui-store.ts";
    const { useUiStore } = await import(uiPath);
    useUiStore.getState().setBrainDockOpen(true);
  });
  await expect(page.getByRole("tablist", { name: "Brain mode" })).toBeVisible();
}
async function startChat(page: Page, profileId = "claude-code") {
  await page.evaluate(async (id) => {
    const apiPath = "/src/lib/agent-dock-mock.ts";
    const storePath = "/src/features/brain/brain-store.ts";
    const { mockDockApi } = await import(apiPath);
    const { useBrainState } = await import(storePath);
    const session = await mockDockApi.startSession({ profileId: id });
    useBrainState.setState(
      (state: { sessions: { id: string }[]; selected: object }) => ({
        sessions: [
          session,
          ...state.sessions.filter((item) => item.id !== session.id),
        ],
        selected: { ...state.selected, chat: session.id },
        tab: "chat",
      }),
    );
    for (const event of await mockDockApi.history(session.id))
      useBrainState.getState().ingest(event);
  }, profileId);
}

test("R9-A/BD02 composer keeps equal icon boxes, keyboard sending and narrow recovery alignment", async ({
  page,
}) => {
  await openDock(page);
  await startChat(page);
  const input = page.getByRole("textbox", { name: "Message the brain" });
  for (const width of [1440, 1000, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await input.fill("Keep the draft after interruption");
    const send = page.getByRole("button", { name: "Send", exact: true });
    const before = await send.boundingBox();
    expect(before?.width).toBe(32);
    expect(before?.height).toBe(32);
    await page.evaluate(async () => {
      const apiPath = "/src/lib/agent-dock-mock.ts";
      const storePath = "/src/features/brain/brain-store.ts";
      const { emitMockDockEvent } = await import(apiPath);
      const { useBrainState } = await import(storePath);
      emitMockDockEvent(useBrainState.getState().selected.chat, {
        kind: "status",
        status: "running",
      });
    });
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible();
    expect(await stop.boundingBox()).toEqual(before);
    expect(await stop.textContent()).toBe("");
    await page.evaluate(async () => {
      const apiPath = "/src/lib/agent-dock-mock.ts";
      const storePath = "/src/features/brain/brain-store.ts";
      const { emitMockDockEvent } = await import(apiPath);
      const { useBrainState } = await import(storePath);
      emitMockDockEvent(useBrainState.getState().selected.chat, {
        kind: "status",
        status: "stopped",
      });
    });
    await expect(
      page.getByRole("button", { name: "Restart session" }),
    ).toBeVisible();
    const controls = await page
      .locator(".brain-composer-actions")
      .evaluate((row) => {
        const box = row.getBoundingClientRect();
        return [...row.querySelectorAll("button")].map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            height: rect.height,
            inside: rect.left >= box.left && rect.right <= box.right,
          };
        });
      });
    expect(
      controls.every((control) => control.height === 32 && control.inside),
    ).toBe(true);
    await expect(input).toHaveValue("Keep the draft after interruption");
    await page.evaluate(async () => {
      const apiPath = "/src/lib/agent-dock-mock.ts";
      const storePath = "/src/features/brain/brain-store.ts";
      const { emitMockDockEvent } = await import(apiPath);
      const { useBrainState } = await import(storePath);
      emitMockDockEvent(useBrainState.getState().selected.chat, {
        kind: "status",
        status: "ready",
      });
    });
  }
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
});

test("Q1 BD21/BC13 delete keeps the exact row height, including a wrapped title", async ({
  page,
}) => {
  await openDock(page);
  await page.getByRole("tab", { name: "History", exact: true }).click();
  const title = "A long history title which wraps at narrow widths 1234567890";
  await page
    .getByRole("button", { name: "History actions for Plan the next release" })
    .click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "History title" }).fill(title);
  await page.getByRole("button", { name: "Save title" }).click();
  for (const width of [1440, 1000, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const next = page.getByRole("button", {
      name: "Open Review the board layout",
    });
    const row = page.locator(".brain-history-row").first();
    const before = await row.boundingBox();
    const nextBefore = await next.boundingBox();
    await page
      .getByRole("button", { name: `History actions for ${title}` })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeFocused();
    expect((await row.boundingBox())?.height).toBe(before?.height);
    expect((await next.boundingBox())?.y).toBe(nextBefore?.y);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
  }
});

test("Q1 H-BD01/BC01 a picker opened before the chat chunk mounts retains focus and arrows", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/features/brain/BrainChat.tsx*", async (route) => {
    await gate;
    await route.continue();
  });
  await openDock(page);
  await startChat(page);
  await page.getByRole("button", { name: /^Choose session:/ }).click();
  const picker = page.getByRole("region", { name: "Sessions", exact: true });
  await expect(picker.getByRole("button").first()).toBeFocused();
  release();
  await expect(
    page.getByRole("textbox", { name: "Message the brain" }),
  ).toBeVisible();
  await expect(picker.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(picker.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: /^Choose session:/ }),
  ).toBeFocused();
});

test("Q1 BD23/BC12 global config chip closes at the correct Escape depth and outside", async ({
  page,
}) => {
  await openDock(page);
  await startChat(page);
  await page.evaluate(async () => {
    const storePath = "/src/features/brain/brain-store.ts";
    const { useBrainState } = await import(storePath);
    const id = useBrainState.getState().selected.chat;
    useBrainState.setState({ userConfigChoices: { [id]: "include" } });
  });
  await expect(
    page.getByRole("textbox", { name: "Message the brain" }),
  ).toBeVisible();
  const chip = page.getByRole("button", { name: "Global config: on" });
  const select = page.getByRole("combobox", {
    name: "Global config for next launch",
  });
  await chip.click();
  await select.focus();
  await page.keyboard.press("Escape");
  await expect(select).toBeHidden();
  await expect(chip).toBeFocused();
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await chip.click();
  await select.click();
  await page.keyboard.press("Escape");
  await expect(select).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(select).toBeHidden();
  await chip.click();
  await page.getByRole("textbox", { name: "Message the brain" }).click();
  await expect(select).toBeHidden();
  await expect(chip).toHaveAttribute("aria-expanded", "false");
});

test("Q1 BD23/BC12 a config selector opened before chat mount retains its options", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/features/brain/BrainChat.tsx*", async (route) => {
    await gate;
    await route.continue();
  });
  await openDock(page);
  await page.getByRole("button", { name: "Start chat", exact: true }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Don't use", exact: true }).click();
  await page.getByRole("button", { name: "Global config: off" }).click();
  const select = page.getByRole("combobox", {
    name: "Global config for next launch",
  });
  await select.click();
  release();
  await expect(
    page.getByRole("textbox", { name: "Message the brain" }),
  ).toBeVisible();
  await expect(select).toBeFocused();
  await page.getByRole("option", { name: "On", exact: true }).click();
  await expect(
    page.getByText("Next launch: on", { exact: true }),
  ).toBeVisible();
});

test("Q1 BD22/BC12 dismissing the last warning during cold mount hands focus to the composer", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/features/brain/BrainChat.tsx*", async (route) => {
    await gate;
    await route.continue();
  });
  await openDock(page);
  await startChat(page);
  await page.evaluate(async () => {
    const storePath = "/src/features/brain/brain-store.ts";
    const { useBrainState } = await import(storePath);
    const sessionId = useBrainState.getState().selected.chat;
    useBrainState.getState().ingest({
      kind: "status",
      status: "ready",
      sessionId,
      seq: 9000,
      at: new Date().toISOString(),
      message: `Launch warning: ${JSON.stringify({ configPath: "C:/fixture/config.toml", suggestedFix: "Review this entry." })}`,
    });
  });
  await page.getByRole("button", { name: "Dismiss", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".brain-dock")).toBeFocused();
  release();
  await expect(
    page.getByRole("textbox", { name: "Message the brain" }),
  ).toBeFocused();
});

test("Q1 BD01/BD11/BC01/ RR03 all dock popovers stay bounded across viewport changes", async ({
  page,
}) => {
  await openDock(page);
  await startChat(page);
  await expect(
    page.getByRole("textbox", { name: "Message the brain" }),
  ).toBeVisible();
  for (const width of [1440, 1000, 375, 280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [trigger, label] of [
      ["Access: Ask first", "Access"],
      ["Session actions", "Session actions"],
    ]) {
      await page.getByRole("button", { name: trigger, exact: true }).click();
      const menu = page.getByRole("region", { name: label, exact: true });
      const box = await menu.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(8);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width - 8);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: /^Choose session:/ }).click();
    const box = await page
      .getByRole("region", { name: "Sessions", exact: true })
      .boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(8);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width - 8);
    await page.keyboard.press("Escape");
  }
});

test("Q1 H-BD01/BC01 Clear stopped focuses a remaining row or the trigger", async ({
  page,
}) => {
  await openDock(page);
  await startChat(page);
  await expect(
    page.getByRole("textbox", { name: "Message the brain" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const storePath = "/src/features/brain/brain-store.ts";
    const { useBrainState } = await import(storePath);
    const s = useBrainState.getState().sessions[0];
    useBrainState.setState({
      sessions: [
        s,
        {
          ...s,
          id: "stopped-fixture",
          title: "Stopped fixture",
          status: "stopped",
        },
      ],
    });
  });
  const trigger = page.getByRole("button", { name: /^Choose session:/ });
  await trigger.click();
  const picker = page.getByRole("region", { name: "Sessions", exact: true });
  await picker
    .getByRole("button", { name: "Clear stopped", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(picker.getByRole("button").first()).toBeFocused();
  await page.evaluate(async () => {
    const storePath = "/src/features/brain/brain-store.ts";
    const { useBrainState } = await import(storePath);
    useBrainState.setState({
      sessions: useBrainState
        .getState()
        .sessions.map((s: { status: string }) => ({ ...s, status: "stopped" })),
    });
  });
  await picker
    .getByRole("button", { name: "Clear stopped", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(trigger).toBeFocused();
  await expect(picker.getByRole("button")).toHaveCount(0);
});
test("W1/W2/W3 History is a keyboard-accessible top tab with kind filters, metadata and a terminal empty state", async ({
  page,
}) => {
  await openDock(page);
  const tabs = page.getByRole("tablist", { name: "Brain mode" });
  await tabs.getByRole("tab", { name: "Chat", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "History" })).toBeFocused();
  const history = page.getByRole("region", { name: "History", exact: true });
  await expect(
    history.getByRole("button", { name: "Open Plan the next release" }),
  ).toContainText("Claude Code · claude-sonnet-4-6");
  await expect(history).toContainText("Native resume");
  await expect(history).toContainText(/\dm ago/);
  await history.getByRole("tab", { name: "Terminal", exact: true }).click();
  await expect(history).toContainText("No terminal history yet");
  await history.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(
    history.getByRole("button", { name: "Open Plan the next release" }),
  ).toBeVisible();
  await tabs.getByRole("tab", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: /^Choose session:/ }).click();
  await expect(
    page.getByRole("region", { name: "Sessions", exact: true }),
  ).not.toContainText("History");
});
test("W4 History popover supports arrows, Escape, outside close, inline rename, delete and undo", async ({
  page,
}) => {
  await openDock(page);
  await page.getByRole("tab", { name: "History", exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "History actions for Plan the next release",
  });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "History actions" });
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("textbox", { name: "Search history" }).click();
  await expect(menu).toBeHidden();
  await trigger.click();
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  await page
    .getByRole("textbox", { name: "History title" })
    .fill("Review dock UX");
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(
    page.getByRole("button", { name: "Open Review dock UX" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "History actions for Review dock UX" })
    .click();
  await menu.getByRole("menuitem", { name: "Delete" }).click();
  await expect(
    page.getByRole("status", { name: "Deleted Review dock UX" }),
  ).toContainText("Deleted · Undo");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Review dock UX" }),
  ).toBeVisible();
});
test("B1 session picker groups titled sessions, indicates current, and clears stopped without deleting history", async ({
  page,
}) => {
  await openDock(page);
  await startChat(page);
  await page.evaluate(async () => {
    const path = "/src/features/brain/brain-store.ts";
    const { useBrainState } = await import(path);
    const state = useBrainState.getState();
    const current = state.sessions.find(
      (session: { id: string }) => session.id === state.selected.chat,
    );
    useBrainState.setState({
      sessions: [
        {
          ...current,
          title: "Review the dock",
          cwd: "C:/work/fictional-project",
        },
        {
          ...current,
          id: "stopped-fixture",
          title: "Earlier review",
          status: "stopped",
        },
      ],
    });
  });
  await page.getByRole("button", { name: /^Choose session:/ }).click();
  const picker = page.getByRole("region", { name: "Sessions", exact: true });
  await expect(
    picker.getByRole("region", { name: "Active", exact: true }),
  ).toContainText("Review the dock");
  await expect(
    picker.getByRole("region", { name: "Stopped", exact: true }),
  ).toContainText("Earlier review");
  await expect(picker.locator('[aria-current="true"]')).toContainText(
    /ready · started \d\d:\d\d · fictional-project/,
  );
  await picker.getByRole("button", { name: "Clear stopped" }).click();
  await expect(
    picker.getByRole("region", { name: "Stopped", exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Plan the next release" }),
  ).toBeVisible();
});
test("B10/W5 access menus distinguish Claude auto from Codex project access and preserve the chosen mode", async ({
  page,
}) => {
  await openDock(page);
  await startChat(page);
  await page
    .getByRole("button", { name: "Access: Ask first", exact: true })
    .click();
  const access = page.getByRole("region", { name: "Access", exact: true });
  await expect(
    access.locator("strong", { hasText: /^Ask first$/ }),
  ).toHaveCount(1);
  await access.getByRole("button", { name: /Auto \(Claude decides\)/ }).click();
  await expect(
    page.getByRole("button", {
      name: "Access: Auto (Claude decides)",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Access: Auto (Claude decides)", exact: true })
    .click();
  await expect(access).toContainText(
    "Runs commands and edits files without asking. Use only in a folder you can afford to lose.",
  );
  await page.keyboard.press("Escape");
  await startChat(page, "codex");
  await page
    .getByRole("button", { name: "Access: Work in project", exact: true })
    .click();
  await expect(access).toContainText(
    "Edits and runs commands inside the project folder; asks for network and anything outside.",
  );
  await expect(access.getByRole("button")).toHaveCount(3);
});
test("B7/minor Starting shows live launch failures, clears the previous title, and Logs opens read-only events", async ({
  page,
}) => {
  await openDock(page);
  await startChat(page);
  await page.evaluate(async () => {
    const path = "/src/lib/agent-dock-mock.ts";
    const { setMockLaunchDelay } = await import(path);
    setMockLaunchDelay(1500);
  });
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Choose session:/ }),
  ).toHaveText("New chat");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page
    .getByRole("button", { name: "Use global config", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Starting…", exact: true }),
  ).toBeDisabled();
  const steps = page.getByRole("log", { name: "Launch steps" });
  await expect(steps).toContainText("Adapter starting");
  await page.evaluate(async () => {
    const path = "/src/lib/agent-dock-mock.ts";
    const storePath = "/src/features/brain/brain-store.ts";
    const { emitMockDockEvent } = await import(path);
    const { useBrainState } = await import(storePath);
    emitMockDockEvent(useBrainState.getState().selected.chat, {
      kind: "launch_step",
      step: "mcp-board",
      state: "failed",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      message: "mcp__jam-board__startup failed",
    });
  });
  await expect(steps).toContainText("Failedmcp__jam-board__startup failed");
  await expect(
    page.getByRole("button", { name: "Starting…", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Session actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Logs", exact: true }).click();
  await expect(
    page.getByRole("log", { name: "Launch timeline" }),
  ).toContainText("mcp__jam-board__startup failed");
  await expect(
    page.getByRole("button", { name: "Copy raw", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Session logs" })).toBeHidden();
});

test("I1-R1 Logs follows new events until the reader scrolls up and Copy raw includes displayed events", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openDock(page);
  await startChat(page);
  const append = async (count: number, label: string) =>
    page.evaluate(
      async ({ count, label }) => {
        const mockPath = "/src/lib/agent-dock-mock.ts";
        const storePath = "/src/features/brain/brain-store.ts";
        const { emitMockDockEvent } = await import(mockPath);
        const { useBrainState } = await import(storePath);
        for (let i = 0; i < count; i++)
          emitMockDockEvent(useBrainState.getState().selected.chat, {
            kind: "launch_log",
            message: `${label} ${i}`,
          });
      },
      { count, label },
    );
  await append(60, "Fixture adapter line");
  await page
    .getByRole("button", { name: "Session actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Logs", exact: true }).click();
  const timeline = page.getByRole("log", { name: "Launch timeline" });
  await expect(timeline).toContainText("Fixture adapter line 59");
  const distance = () =>
    timeline.evaluate(
      (node) => node.scrollHeight - node.scrollTop - node.clientHeight,
    );
  await expect.poll(distance).toBeLessThan(24);
  await append(1, "Newest adapter line");
  await expect(timeline).toContainText("Newest adapter line 0");
  await expect.poll(distance).toBeLessThan(24);
  await timeline.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await append(1, "While reading earlier lines");
  await expect(timeline).toContainText("While reading earlier lines 0");
  expect(await timeline.evaluate((node) => node.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "Copy raw", exact: true }).click();
  await expect(
    page.getByText("Raw events copied", { exact: true }),
  ).toBeVisible();
  const copied = await page.evaluate(async () =>
    JSON.parse(await navigator.clipboard.readText()),
  );
  expect(copied.at(-1).message).toBe("While reading earlier lines 0");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Session actions", exact: true }),
  ).toBeFocused();
});

test("I1-R4 Claude and Codex model options stay scoped to the selected connection", async ({
  page,
}) => {
  await openDock(page);
  await startChat(page, "claude-code");
  await startChat(page, "codex");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const launcher = page.getByRole("region", { name: "New chat", exact: true });
  await expect(
    launcher.getByRole("button", { name: "GPT-6.1 Sol", exact: true }),
  ).toBeVisible();
  await expect(launcher).not.toContainText("Claude Sonnet");
  await launcher
    .getByRole("combobox", { name: "Connection", exact: true })
    .click();
  await page.getByRole("option", { name: "Claude Code", exact: true }).click();
  await expect(
    launcher.getByRole("button", { name: "Claude Sonnet 4.6", exact: true }),
  ).toBeVisible();
  await expect(launcher).not.toContainText("GPT-6.1");
  await launcher
    .getByRole("combobox", { name: "Connection", exact: true })
    .click();
  await page.getByRole("option", { name: "Codex", exact: true }).click();
  await expect(
    launcher.getByRole("button", { name: "GPT-6.1 Terra", exact: true }),
  ).toBeVisible();
  await expect(launcher).not.toContainText("Claude Opus");
});

for (const variant of [
  { name: "1440-light", width: 1440, theme: "light" },
  { name: "1440-dark", width: 1440, theme: "dark" },
  { name: "1000-light", width: 1000, theme: "light" },
  { name: "375-light", width: 375, theme: "light" },
]) {
  test(`R10-A/BC07 More options ${variant.name}`, async ({ page }) => {
    await page.setViewportSize({ width: variant.width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDock(page);
    await startChat(page);
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    }, variant.theme);
    await page.evaluate(() => document.fonts.ready);
    const trigger = page.getByRole("button", {
      name: "More options",
      exact: true,
    });
    const indicator = trigger.getByRole("status");
    const row = page.locator(".brain-composer-actions");
    const checkRow = async () => {
      expect((await row.boundingBox())?.height).toBe(36);
      expect((await trigger.boundingBox())?.height).toBe(32);
      expect((await trigger.boundingBox())?.width).toBe(32);
      expect(await trigger.textContent()).toBe("");
      if (variant.width >= 1000) {
        const modelLabel = page.locator(
          ".brain-model-anchor .brain-control-chip > span",
        );
        await expect(modelLabel).toHaveText("Claude Sonnet 4.6 · Auto");
        expect(
          await modelLabel.evaluate(
            (label) => label.scrollWidth <= label.clientWidth,
          ),
        ).toBe(true);
      }
      const inside = await row.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [...element.querySelectorAll("button")]
          .filter((button) => !button.closest("[data-brain-popover]"))
          .every((button) => {
            const rect = button.getBoundingClientRect();
            return rect.left >= box.left && rect.right <= box.right;
          });
      });
      expect(inside).toBe(true);
    };
    const shot = async (state: string) => {
      await page.screenshot({
        path: `../../test-visuals/round10/r10-more-options/${variant.name}-${state}.png`,
      });
    };
    await expect(trigger).toBeVisible();
    await expect(indicator).toHaveCount(0);
    await checkRow();
    await shot("off");
    await trigger.click();
    const popover = page
      .locator("[data-brain-popover]")
      .filter({ has: page.getByRole("switch", { name: "Fast mode" }) });
    await expect(
      popover.getByText("Faster responses on supported models"),
    ).toBeVisible();
    await expect(
      popover.getByRole("combobox", { name: "Response style" }),
    ).toBeVisible();
    const bounds = await popover.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(8);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
      variant.width - 8,
    );
    await checkRow();
    await shot("open");
    const toggle = popover.getByRole("switch", { name: "Fast mode" });
    const measurements: Record<string, unknown> = {};
    const inspectSwitch = async (state: "off" | "on") => {
      // Enter keyboard modality and return to the switch from its neighbour.
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(toggle).toBeFocused();
      const measured = await toggle.evaluate((button) => {
        const surface = getComputedStyle(
          button.closest("[data-brain-popover]") as HTMLElement,
        ).backgroundColor;
        const track = getComputedStyle(button, "::before");
        const thumb = getComputedStyle(
          button.querySelector("span") as HTMLElement,
        );
        const control = getComputedStyle(button);
        const luminance = (color: string) => {
          const rgb = color.match(/[\d.]+/g)?.map(Number) ?? [];
          if (rgb.length !== 3)
            throw new Error(`Expected opaque RGB color: ${color}`);
          const [red = 0, green = 0, blue = 0] = rgb.map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        };
        const contrast = (first: string, second: string) => {
          const a = luminance(first),
            b = luminance(second);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        return {
          colors: {
            surface,
            track: track.backgroundColor,
            border: track.borderTopColor,
            thumb: thumb.backgroundColor,
            focus: control.outlineColor,
          },
          ratios: {
            boundaryToSurface: contrast(track.borderTopColor, surface),
            trackToSurface: contrast(track.backgroundColor, surface),
            thumbToTrack: contrast(
              thumb.backgroundColor,
              track.backgroundColor,
            ),
            focusToSurface: contrast(control.outlineColor, surface),
          },
          focusVisible: button.matches(":focus-visible"),
          outlineWidth: control.outlineWidth,
          outlineStyle: control.outlineStyle,
          outlineOffset: control.outlineOffset,
        };
      });
      expect(measured.ratios.boundaryToSurface).toBeGreaterThanOrEqual(3);
      expect(measured.ratios.thumbToTrack).toBeGreaterThanOrEqual(3);
      expect(measured.ratios.focusToSurface).toBeGreaterThanOrEqual(3);
      if (state === "on")
        expect(measured.ratios.trackToSurface).toBeGreaterThanOrEqual(3);
      expect(measured.focusVisible).toBe(true);
      expect(measured.outlineWidth).toBe("2px");
      expect(measured.outlineStyle).toBe("solid");
      expect(measured.outlineOffset).toBe("2px");
      measurements[state] = measured;
      if (variant.width === 1440) {
        const box = await toggle.boundingBox();
        if (!box) throw new Error("Switch has no bounds");
        const width = Math.ceil(box.width + 16),
          height = Math.ceil(box.height + 16);
        const crop = await page.screenshot({
          clip: { x: box.x - 8, y: box.y - 8, width, height },
        });
        await sharp(crop)
          .resize(width * 3, height * 3, { kernel: "nearest" })
          .toFile(
            `../../test-visuals/round10/r10-more-options/switch-${variant.theme}-${state}-3x.png`,
          );
      }
    };
    await inspectSwitch("off");
    await toggle.press("Space");
    await expect(
      popover.getByRole("switch", { name: "Fast mode" }),
    ).toBeChecked();
    await inspectSwitch("on");
    await writeFile(
      `../../test-visuals/round10/r10-more-options/contrast-${variant.name}.json`,
      JSON.stringify(measurements, null, 2),
    );
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(indicator).toBeVisible();
    await checkRow();
    await shot("on");
    await trigger.click();
    await popover.getByRole("combobox", { name: "Response style" }).click();
    await page.getByRole("option", { name: "Concise", exact: true }).click();
    await expect(
      popover.getByRole("combobox", { name: "Response style" }),
    ).toContainText("Concise");
    await expect(
      popover.getByRole("switch", { name: "Fast mode" }),
    ).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(indicator).toHaveAttribute(
      "aria-label",
      "2 active session options",
    );
  });
}
