import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Drawer } from "../../components/ui";
import type { AgentDockEvent } from "../../lib/agent-dock-api";
import {
  emitMockDockEvent,
  mockDockApi,
  resetMockDock,
  setMockLaunchDelay,
} from "../../lib/agent-dock-mock";
import {
  resetMockPhase4,
  seedMockHistory,
} from "../../lib/agent-dock-phase4-mock";
import { mockApi } from "../../lib/mock-bridge";
import { appQuery } from "../../lib/queries";
import { useUiStore } from "../../lib/ui-store";
import { BrainConnections } from "./BrainConnections";
import { BrainDock } from "./BrainDock";
import {
  BrainButton,
  BrainDockController,
  useDockLayout,
} from "./BrainDockShell";
import { pendingSessionChoices, sessionOptions } from "./brain-settings";
import { useBrainDock, useBrainState } from "./brain-store";

vi.mock("../../lib/agent-dock", async () => ({
  agentDockApi: (await import("../../lib/agent-dock-mock")).mockDockApi,
}));
vi.mock("../../lib/agent-dock-phase4", async (original) => ({
  ...(await original<typeof import("../../lib/agent-dock-phase4")>()),
  phase4Api: (await import("../../lib/agent-dock-phase4-mock")).mockPhase4Api,
}));
// Canvas rendering requires separate browser verification.
vi.mock("./BrainTerminal", () => ({
  BrainTerminal: () => <div>Terminal fixture</div>,
}));

function Harness() {
  const layout = useDockLayout();
  const app = useQuery(appQuery);
  const location = useRouterState({ select: (s) => s.location.href });
  const brain = useBrainDock();
  return (
    <div style={layout.style}>
      <input aria-label="Outside input" />
      <BrainButton />
      {app.data?.jam && <BrainDockController projectId={app.data.jam.id} />}
      <output aria-label="Current route">{location}</output>
      <button
        type="button"
        onClick={() => brain.compose({ text: "Prepared only" })}
      >
        Compose bridge
      </button>
      {layout.open && <BrainDock overlay={layout.overlay} />}
      {location.startsWith("/settings") && <BrainConnections />}
    </div>
  );
}
function mount(path = "/board") {
  const root = createRootRoute({ component: Harness });
  const routes = ["/board", "/plan", "/plan/$epicKey", "/settings"].map(
    (path) => createRoute({ getParentRoute: () => root, path }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
it("R8-C Session status menu opens the popover and Escape returns focus to session actions", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Brain chat · Ctrl+J" }),
  );
  await user.click(await screen.findByRole("button", { name: "Start chat" }));
  await user.click(await screen.findByRole("button", { name: "Start" }));
  const actions = screen.getByRole("button", { name: "Session actions" });
  await waitFor(() => expect(actions).toBeEnabled());
  await user.click(actions);
  await user.click(screen.getByRole("button", { name: "Session status" }));
  expect(screen.getByRole("region", { name: "Session status" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Session status" })).toBeNull();
  expect(actions).toHaveFocus();
});
async function openChat() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Brain chat · Ctrl+J" }),
  );
  await user.click(await screen.findByRole("button", { name: "Start chat" }));
  await user.click(await screen.findByRole("button", { name: "Start" }));
  await screen.findByRole(
    "textbox",
    { name: "Message the brain" },
    { timeout: 3000 },
  );
  return user;
}

it("BC03 New terminal closes the picker for a pending session so its size handshake can mount", async () => {
  mount();
  const user = userEvent.setup();
  const original = mockDockApi.startSession;
  vi.spyOn(mockDockApi, "startSession").mockImplementation(async (input) => ({
    ...(await original(input)),
    status: "starting",
  }));
  vi.spyOn(mockDockApi, "history").mockResolvedValue([]);
  const log = vi.spyOn(console, "debug").mockImplementation(() => {});
  await user.click(
    await screen.findByRole("button", { name: "Brain chat · Ctrl+J" }),
  );
  await user.click(screen.getByRole("tab", { name: "Terminal" }));
  await user.click(
    await screen.findByRole("button", { name: "Open terminal" }),
  );
  await screen.findByText("Terminal fixture");
  await user.click(screen.getByRole("button", { name: "New terminal" }));
  await user.click(
    await screen.findByRole("button", { name: "Open terminal" }),
  );
  await screen.findByText("Terminal fixture");
  expect(
    screen.queryByRole("button", { name: "Open terminal" }),
  ).not.toBeInTheDocument();
  expect(log).toHaveBeenLastCalledWith("[terminal-startup]", {
    sessionId: useBrainState.getState().selected.terminal,
    clickedAt: expect.any(String),
    clickToPendingMs: expect.any(Number),
  });
});
it("R6-H10 opening a past transcript starts nothing; New leaves read-only mode and cannot stop an unrelated chat", async () => {
  mount();
  const user = await openChat();
  const start = vi.spyOn(mockDockApi, "startSession");
  await user.click(screen.getByRole("tab", { name: "History" }));
  const history = await screen.findByRole("region", { name: "History" });
  await user.click(
    await within(history).findByRole("button", { name: /^Open / }),
  );
  await screen.findByRole("region", { name: "Read-only transcript" });
  expect(start).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("textbox", { name: "Message the brain" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Session actions" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "New chat" }));
  expect(
    screen.queryByRole("region", { name: "Read-only transcript" }),
  ).toBeNull();
  await user.click(await screen.findByRole("button", { name: "Start" }));
  await screen.findByRole("textbox", { name: "Message the brain" });
  expect(start).toHaveBeenCalledTimes(1);
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  resetMockDock();
  await mockDockApi.saveUserConfigDefault("include");
  resetMockPhase4();
  seedMockHistory([]);
  await mockApi.resetDemo();
  localStorage.clear();
  useUiStore.setState({
    brainDockOpen: false,
    brainDockWidth: 420,
    brainPreferences: {},
  });
  useBrainState.setState({
    projectId: null,
    sessions: [],
    events: {},
    selected: { chat: null, terminal: null },
    tab: "chat",
    drafts: {},
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1440,
  });
  vi.restoreAllMocks();
  for (const profileId of ["api-openrouter", "api-zai", "api-custom"]) {
    const profile = (await mockDockApi.profiles()).find(
      (p) => p.id === profileId,
    );
    if (profile)
      await mockDockApi.saveProfile({
        id: profileId,
        label: profile.label,
        kind: "api",
        model: null,
      });
    await mockDockApi.clearSecret(profileId, "API_KEY");
  }
});
it("working, permission and error dots stay visible with the dock closed", async () => {
  mount();
  const user = await openChat();
  act(() => inject({ kind: "status", status: "running" }));
  await user.click(screen.getByRole("button", { name: "Close brain dock" }));
  expect(
    screen.getByRole("button", { name: "Brain chat · Ctrl+J" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("status", { name: "Brain working" })).toBeVisible();
  act(() => {
    inject({ kind: "status", status: "awaiting_permission" });
    inject({
      kind: "permission_request",
      requestId: "closed",
      title: "Run tests",
      options: [],
    });
  });
  expect(screen.getByRole("status", { name: "Brain needs you" })).toBeVisible();
  act(() => {
    inject({
      kind: "permission_resolved",
      requestId: "closed",
      optionId: "once",
    });
    inject({ kind: "status", status: "ready" });
  });
  expect(screen.queryByRole("status", { name: "Brain needs you" })).toBeNull();
  expect(screen.queryByRole("status", { name: "Brain working" })).toBeNull();
  act(() => inject({ kind: "status", status: "failed" }));
  expect(screen.getByRole("status", { name: "Brain error" })).toBeVisible();
});
it("container resize keeps a pinned transcript at the bottom and preserves an unpinned position with Jump", async () => {
  const observers: { callback: ResizeObserverCallback; nodes: Set<Element> }[] =
    [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      entry: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, nodes: new Set() };
        observers.push(this.entry);
      }
      observe(node: Element) {
        this.entry.nodes.add(node);
      }
      unobserve(node: Element) {
        this.entry.nodes.delete(node);
      }
      disconnect() {}
    },
  );
  try {
    mount();
    await openChat();
    const log = screen.getByRole("log", { name: "Brain conversation" });
    let viewportHeight = 600;
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, get: () => 700 },
      clientHeight: { configurable: true, get: () => viewportHeight },
    });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    const observer = observers.find((entry) => entry.nodes.has(log));
    expect(observer).toBeDefined();
    viewportHeight = 468;
    act(() => observer?.callback([], {} as ResizeObserver));
    expect(log.scrollTop).toBeGreaterThanOrEqual(232);
    expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
    log.scrollTop = 20;
    fireEvent.scroll(log);
    viewportHeight = 400;
    act(() => observer?.callback([], {} as ResizeObserver));
    expect(log.scrollTop).toBe(20);
    expect(
      screen.getByRole("button", { name: /Jump to latest/ }),
    ).toBeVisible();
  } finally {
    vi.unstubAllGlobals();
  }
});
it.each([undefined, "0", "true", "1"])(
  "mock controls are available only with VITE_MOCK_BRIDGE=1 (value: %s)",
  async (value) => {
    vi.stubEnv("VITE_MOCK_BRIDGE", value);
    mount("/settings");
    const user = userEvent.setup();
    const label = await screen.findByText("Claude Code");
    const row = label.closest(".brain-connection-row") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByText("Advanced"));
    expect(
      !!screen.queryByRole("checkbox", { name: "Simulate signed-out" }),
    ).toBe(value === "1");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(
      screen.getByRole("button", { name: "Brain chat · Ctrl+J" }),
    );
    await user.click(await screen.findByRole("button", { name: "Start chat" }));
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("textbox", { name: "Message the brain" });
    await user.click(screen.getByRole("button", { name: "Session actions" }));
    expect(!!screen.queryByRole("button", { name: "Simulate crash" })).toBe(
      value === "1",
    );
  },
);
it("mock signed-out and crash states are reachable through UI, with inline code in the scripted reply", async () => {
  vi.stubEnv("VITE_MOCK_BRIDGE", "1");
  mount("/settings");
  const user = userEvent.setup();
  const row = (await screen.findByText("Claude Code")).closest(
    ".brain-connection-row",
  ) as HTMLElement;
  await user.click(within(row).getByRole("button", { name: "Edit" }));
  await user.click(await screen.findByText("Advanced"));
  await user.click(
    screen.getByRole("checkbox", { name: "Simulate signed-out" }),
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Brain chat · Ctrl+J" }));
  await user.click(await screen.findByRole("button", { name: "Start chat" }));
  await user.click(await screen.findByRole("button", { name: "Start" }));
  expect(await screen.findByText("Claude Code isn't signed in")).toBeVisible();
  expect(screen.getByText("Not logged in (mock)")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Use an API key" }));
  await user.click(await screen.findByText("Advanced"));
  const checkbox = await screen.findByRole("checkbox", {
    name: "Simulate signed-out",
  });
  await waitFor(() => expect(checkbox).toBeChecked());
  await user.click(checkbox);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByText("Claude Code isn't signed in")).toBeNull(),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Message the brain" }),
    "Preview the checks{Enter}",
  );
  await waitFor(
    () =>
      expect(
        screen.getByRole("log").querySelector(".brain-markdown code"),
      ).toHaveTextContent("npm test"),
    { timeout: 3000 },
  );
  await user.click(screen.getByRole("button", { name: "Session actions" }));
  await user.click(screen.getByRole("button", { name: "Simulate crash" }));
  const crash = await screen.findByRole("alert", {
    name: "The agent ran into a problem",
  });
  await user.click(within(crash).getByText("Details"));
  expect(screen.getByText(/Mock agent crashed/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close brain dock" }));
  expect(screen.getByRole("status", { name: "Brain error" })).toBeVisible();
});
it("Ctrl+J toggles from an input and leaves the xterm Ctrl+J alone", async () => {
  mount();
  const input = await screen.findByRole("textbox", { name: "Outside input" });
  await waitFor(() =>
    expect(useBrainState.getState().projectId).not.toBeNull(),
  );
  fireEvent.keyDown(input, { key: "j", ctrlKey: true });
  expect(
    await screen.findByRole("complementary", { name: "Brain dock" }),
  ).toBeVisible();
  const terminal = document.createElement("div");
  terminal.className = "xterm";
  document.body.append(terminal);
  fireEvent.keyDown(terminal, { key: "j", ctrlKey: true });
  expect(useUiStore.getState().brainDockOpen).toBe(true);
  terminal.remove();
  fireEvent.keyDown(input, { key: "j", ctrlKey: true });
  expect(screen.queryByRole("complementary")).toBeNull();
});
it("start chat streams markdown, tool result, plan and retained session context", async () => {
  mount();
  const user = await openChat();
  await user.type(
    screen.getByRole("textbox", { name: "Message the brain" }),
    "Review the brief{Enter}",
  );
  expect(
    await screen.findByText(
      "I’ve reviewed the context.",
      {},
      { timeout: 3000 },
    ),
  ).toBeVisible();
  expect(
    (
      await screen.findAllByRole("button", { name: "JB-21" }, { timeout: 3000 })
    ).find((node) => node.closest("summary")),
  ).toBeVisible();
  expect(
    await screen.findByText("Review project context", {}, { timeout: 3000 }),
  ).toBeVisible();
  expect(screen.getByText("Session context")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close brain dock" }));
  await user.click(screen.getByRole("button", { name: "Brain chat · Ctrl+J" }));
  expect(
    (await screen.findAllByRole("button", { name: "JB-21" })).find((node) =>
      node.closest("summary"),
    ),
  ).toBeVisible();
});
it("Shift+Enter retains a newline; Enter sends once and IME Enter never sends", async () => {
  const send = vi.spyOn(mockDockApi, "sendPrompt");
  mount();
  const user = await openChat();
  const input = screen.getByRole("textbox", { name: "Message the brain" });
  await user.type(input, "First{Shift>}{Enter}{/Shift}second");
  expect(input).toHaveValue("First\nsecond");
  expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(send).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(send).toHaveBeenCalledTimes(1);
});
it("Stop cancels the stream and retains the composer draft", async () => {
  mount();
  const user = await openChat();
  await user.type(
    screen.getByRole("textbox", { name: "Message the brain" }),
    "First{Enter}",
  );
  await user.click(await screen.findByRole("button", { name: "Stop" }));
  expect(await screen.findByText("Stopped")).toBeVisible();
  const session = useBrainState.getState().sessions[0];
  expect(
    (await mockDockApi.history(session?.id ?? "")).some(
      (e) => e.kind === "turn_end" && e.stopReason === "cancelled",
    ),
  ).toBe(true);
});
// Two complete mock turns include 180 ms per streamed event plus a human
// permission pause. This is a permission-flow assertion, not a 5 s latency SLA.
it("permission blocks the second turn, turns the dot coral, and resolves once", async () => {
  mount();
  const user = await openChat();
  const input = screen.getByRole("textbox", { name: "Message the brain" });
  await user.type(input, "One{Enter}");
  await screen.findByText("Review project context", {}, { timeout: 3000 });
  await waitFor(() =>
    expect(useBrainState.getState().sessions[0]?.status).toBe("ready"),
  );
  await user.type(input, "Two{Enter}");
  const allow = await screen.findByRole(
    "button",
    { name: "Allow once" },
    { timeout: 4000 },
  );
  expect(screen.getByRole("status", { name: "Brain needs you" })).toBeVisible();
  const session = useBrainState.getState().sessions[0];
  expect(
    (await mockDockApi.history(session?.id ?? "")).filter(
      (e) => e.kind === "turn_end",
    ),
  ).toHaveLength(1);
  await user.click(allow);
  expect(await screen.findByText(/Allowed once/)).toBeVisible();
  await waitFor(() =>
    expect(useBrainState.getState().sessions[0]?.status).toBe("ready"),
  );
}, 10000);
it("board key chip opens the task route", async () => {
  mount();
  const user = await openChat();
  await user.type(
    screen.getByRole("textbox", { name: "Message the brain" }),
    "Read{Enter}",
  );
  await user.click(
    await screen.findByRole("button", { name: "JB-12" }, { timeout: 3000 }),
  );
  expect(screen.getByLabelText("Current route")).toHaveTextContent(
    "/board?task=JB-12",
  );
});
it("current task context is removable and @ mention sends a board_ref", async () => {
  mount("/board?task=JB-1");
  const send = vi.spyOn(mockDockApi, "sendPrompt");
  const user = await openChat();
  const chip = await screen.findByRole("button", { name: /Remove JB-1 ·/ });
  await user.click(chip);
  expect(screen.queryByRole("button", { name: /Remove JB-1 ·/ })).toBeNull();
  const tasks = Object.values(await mockApi.listBoardTasks()).flat();
  const task = tasks[0];
  expect(task).toBeDefined();
  await user.type(
    screen.getByRole("textbox", { name: "Message the brain" }),
    `@${task?.key}`,
  );
  const picker = await screen.findByRole("region", {
    name: "Mention a board item",
  });
  await user.click(
    within(picker).getByRole("button", {
      name: `${task?.key} · ${task?.title}`,
    }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Message the brain" }),
    "Inspect{Enter}",
  );
  expect(send.mock.calls[0]?.[0].content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "board_ref",
        uri: `jam://task/${task?.key}`,
        text: expect.stringContaining(task?.title ?? ""),
      }),
    ]),
  );
});
it("width clamps, persists and supports keyboard resize", async () => {
  mount();
  const user = await openChat();
  const handle = screen.getByRole("separator", { name: "Resize brain dock" });
  handle.focus();
  await user.keyboard("{ArrowLeft}");
  expect(localStorage.getItem("jam.brainDockWidth")).toBe("440");
  await user.keyboard("{End}");
  expect(useUiStore.getState().brainDockWidth).toBe(720);
  await user.click(screen.getByRole("button", { name: "Close brain dock" }));
  await user.click(screen.getByRole("button", { name: "Brain chat · Ctrl+J" }));
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "720");
});
it("BDW-03 tabs rove focus, activate with arrows and retain chat drafts", async () => {
  mount();
  const user = await openChat();
  await user.type(
    screen.getByRole("textbox", { name: "Message the brain" }),
    "Keep this draft",
  );
  const chat = screen.getByRole("tab", { name: "Chat" }),
    terminal = screen.getByRole("tab", { name: "Terminal" });
  chat.focus();
  await user.keyboard("{ArrowRight}");
  expect(terminal).toHaveFocus();
  expect(terminal).toHaveAttribute("aria-selected", "true");
  expect(chat).toHaveAttribute("tabindex", "-1");
  await user.keyboard("{ArrowLeft}");
  expect(chat).toHaveAttribute("aria-selected", "true");
  expect(
    await screen.findByRole("textbox", { name: "Message the brain" }),
  ).toHaveValue("Keep this draft");
  expect(chat).toHaveFocus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "History" })).toHaveFocus();
  expect(screen.getByRole("region", { name: "History" })).toBeVisible();
  await user.keyboard("{Home}");
  expect(chat).toHaveFocus();
});
it("BDW-04 session menus enter their items, traverse with arrows and return focus on Escape", async () => {
  mount();
  const user = await openChat();
  const second = await mockDockApi.startSession({ profileId: "codex" });
  act(() =>
    useBrainState.setState((state) => ({
      sessions: [
        second,
        ...state.sessions.filter((session) => session.id !== second.id),
      ],
    })),
  );
  const picker = document.querySelector(
    ".brain-session-title",
  ) as HTMLButtonElement;
  await user.click(picker);
  const region = screen.getByRole("region", { name: "Sessions" });
  const items = within(region)
    .getAllByRole("button")
    .filter((button) => !button.closest(".brain-history"));
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(items[1 % items.length]).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Sessions" })).toBeNull();
  expect(picker).toHaveFocus();
  const actions = screen.getByRole("button", { name: "Session actions" });
  await user.click(actions);
  expect(screen.getByRole("button", { name: "Stop session" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("button", { name: "Logs" })).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("button", { name: "Stop session" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Session actions" })).toBeNull();
  expect(actions).toHaveFocus();
});
it("BDW-08 Escape during pointer resize restores the persisted width and ignores subsequent movement/release", async () => {
  mount();
  await openChat();
  const handle = screen.getByRole("separator", { name: "Resize brain dock" });
  Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() });
  handle.focus();
  fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
  expect(useUiStore.getState().brainDockWidth).toBe(520);
  fireEvent.keyDown(handle, { key: "Escape" });
  expect(useUiStore.getState().brainDockWidth).toBe(420);
  expect(localStorage.getItem("jam.brainDockWidth")).toBe("420");
  fireEvent.pointerMove(handle, { clientX: 850, pointerId: 1 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(useUiStore.getState().brainDockWidth).toBe(420);
  expect(
    screen.getByRole("complementary", { name: "Brain dock" }),
  ).toBeVisible();
});
it("BDW-09 Escape keeps the wide workspace dock open", async () => {
  mount();
  const user = await openChat();
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("complementary", { name: "Brain dock" }),
  ).toBeVisible();
});
it("below 1100px the overlay closes on Escape and returns focus", async () => {
  window.innerWidth = 1024;
  mount();
  const user = userEvent.setup();
  const trigger = await screen.findByRole("button", {
    name: "Brain chat · Ctrl+J",
  });
  await user.click(trigger);
  expect(
    await screen.findByRole("dialog", { name: "Brain dock" }),
  ).toHaveAttribute("aria-modal", "true");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});
it("saving a key clears the password and reopening never reads its value", async () => {
  mount("/settings");
  const user = userEvent.setup();
  const row = (await screen.findByText("Claude via z.ai")).closest(
    ".brain-connection-row",
  );
  expect(row).not.toBeNull();
  await user.click(
    within(row as HTMLElement).getByRole("button", { name: "Edit" }),
  );
  const input = screen.getByLabelText("API key");
  await user.type(input, "fictional-private-key");
  await user.type(screen.getByLabelText("Model"), "fixture-model");
  const profileWrite = vi.spyOn(mockDockApi, "saveProfile");
  const secretWrite = vi.spyOn(mockDockApi, "setSecret");
  expect(screen.queryByRole("button", { name: "Save key" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(input).toHaveValue("");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(profileWrite).toHaveBeenCalledOnce();
  expect(profileWrite).toHaveBeenCalledWith(
    expect.objectContaining({ id: "claude-zai", model: "fixture-model" }),
  );
  expect(secretWrite).toHaveBeenCalledWith(
    "claude-zai",
    "ANTHROPIC_AUTH_TOKEN",
    "fictional-private-key",
  );
  expect(JSON.stringify(await mockDockApi.profiles())).not.toContain(
    "fictional-private-key",
  );
  expect(localStorage.getItem("jam.brainDockWidth") ?? "").not.toContain(
    "fictional-private-key",
  );
  await user.click(
    within(row as HTMLElement).getByRole("button", { name: "Edit" }),
  );
  expect(screen.getByLabelText("API key")).toHaveValue("");
  expect(screen.getByText("Key saved")).toBeVisible();
  expect(document.body.textContent).not.toContain("fictional-private-key");
  await mockDockApi.clearSecret("claude-zai", "ANTHROPIC_AUTH_TOKEN");
});
it("compose bridge opens and fills without sending", async () => {
  mount();
  const send = vi.spyOn(mockDockApi, "sendPrompt");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Compose bridge" }),
  );
  await user.click(await screen.findByRole("button", { name: "Start chat" }));
  await user.click(await screen.findByRole("button", { name: "Start" }));
  expect(
    await screen.findByRole("textbox", { name: "Message the brain" }),
  ).toHaveValue("Prepared only");
  expect(send).not.toHaveBeenCalled();
});
it("a portaled task drawer keeps its scope while Escape dismisses dock suggestions", async () => {
  mount();
  const user = await openChat();
  const closed = vi.fn();
  render(
    <Drawer title="JB-1" onClose={closed} modal={false}>
      <button type="button">Task action</button>
    </Drawer>,
  );
  const input = screen.getByRole("textbox", { name: "Message the brain" });
  await user.type(input, "@JB");
  expect(
    await screen.findByRole("region", { name: "Mention a board item" }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("region", { name: "Mention a board item" }),
  ).toBeNull();
  expect(closed).not.toHaveBeenCalled();
  expect(document.documentElement.style.getPropertyValue("--dock-width")).toBe(
    "420px",
  );
});
it("slash commands and config options come from the session and remain explicit actions", async () => {
  mount();
  const user = await openChat();
  const input = screen.getByRole("textbox", { name: "Message the brain" });
  const config = vi.spyOn(mockDockApi, "setConfigOption");
  await user.click(screen.getByRole("button", { name: "Access: Ask first" }));
  await user.click(
    screen.getByRole("button", { name: /Plan only Reads and proposes/ }),
  );
  expect(config).toHaveBeenCalledWith(
    expect.objectContaining({ optionId: "mode", value: "plan" }),
  );
  await user.type(input, "/");
  await user.click(
    within(
      await screen.findByRole("region", { name: "Agent commands" }),
    ).getByRole("button", { name: /compact/ }),
  );
  expect(input).toHaveValue("/compact ");
});
it("BDW-07 unmatched commands explain the empty result and Escape dismisses without clearing the draft", async () => {
  mount();
  const user = await openChat();
  const input = screen.getByRole("textbox", { name: "Message the brain" });
  await user.type(input, "/zzzz");
  expect(await screen.findByText("No matching commands")).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Agent commands" })).queryByRole(
      "button",
    ),
  ).toBeNull();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Agent commands" })).toBeNull();
  expect(input).toHaveValue("/zzzz");
  await user.clear(input);
  await user.type(input, "/");
  expect(await screen.findByRole("button", { name: /compact/ })).toBeVisible();
});
it("Connections can add a custom terminal and hide or show it without starting a session", async () => {
  mount("/settings");
  const user = userEvent.setup();
  const start = vi.spyOn(mockDockApi, "startSession");
  await user.click(
    await screen.findByRole("button", { name: "Add custom agent" }),
  );
  await user.type(screen.getByLabelText("Label"), "Fixture CLI");
  await user.click(screen.getByRole("combobox", { name: "Connection" }));
  await user.click(screen.getByRole("option", { name: "Terminal command" }));
  await user.type(screen.getByLabelText("Command"), "fixture-cli");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const label = await screen.findByText("Fixture CLI");
  const row = label.closest(".brain-connection-row") as HTMLElement;
  await user.click(within(row).getByRole("button", { name: "Hide" }));
  expect(await within(row).findByText(/Hidden/)).toBeVisible();
  await user.click(within(row).getByRole("button", { name: "Show" }));
  expect(start).not.toHaveBeenCalled();
  const profile = (await mockDockApi.profiles()).find(
    (p) => p.label === "Fixture CLI",
  );
  if (profile) await mockDockApi.deleteProfile(profile.id);
});
function inject(payload: Record<string, unknown>) {
  const state = useBrainState.getState();
  const id = state.selected.chat;
  if (!id) throw new Error("No chat session");
  state.ingest({
    sessionId: id,
    seq: (state.events[id]?.at(-1)?.seq ?? 0) + 1,
    at: new Date().toISOString(),
    ...payload,
  } as AgentDockEvent);
}
it("focuses the composer after Start, New and picking an existing chat", async () => {
  mount();
  const user = await openChat();
  expect(
    await screen.findByRole("textbox", { name: "Message the brain" }),
  ).toHaveFocus();
  await user.keyboard("Immediate input");
  expect(
    screen.getByRole("textbox", { name: "Message the brain" }),
  ).toHaveValue("Immediate input");
  const initial = useBrainState.getState().selected.chat;
  await user.click(screen.getByRole("button", { name: "New chat" }));
  await user.click(screen.getByRole("button", { name: "Start" }));
  await waitFor(() =>
    expect(useBrainState.getState().selected.chat).not.toBe(initial),
  );
  expect(
    await screen.findByRole("textbox", { name: "Message the brain" }),
  ).toHaveFocus();
  await user.click(
    screen.getByRole("button", { name: /Claude Code/, expanded: false }),
  );
  const sessions = await screen.findByRole("region", { name: "Sessions" });
  await user.click(
    within(sessions)
      .getAllByRole("button")
      .filter((button) => !button.closest(".brain-history"))
      .at(-1) as HTMLElement,
  );
  expect(
    await screen.findByRole("textbox", { name: "Message the brain" }),
  ).toHaveFocus();
  expect(useBrainState.getState().selected.chat).toBe(initial);
});
it("pins new output and permission results, shows Jump when scrolled up, and always jumps after Send", async () => {
  mount();
  const user = await openChat();
  const log = screen.getByRole("log", { name: "Brain conversation" });
  let height = 500;
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, get: () => 200 },
  });
  log.scrollTop = 300;
  fireEvent.scroll(log);
  height = 700;
  act(() =>
    inject({
      kind: "agent_message_delta",
      messageId: "pin",
      text: "More output",
    }),
  );
  expect(log.scrollTop).toBe(700);
  height = 900;
  act(() =>
    inject({
      kind: "permission_resolved",
      requestId: "permission",
      optionId: "once",
    }),
  );
  expect(log.scrollTop).toBe(900);
  log.scrollTop = 20;
  fireEvent.scroll(log);
  height = 1000;
  act(() =>
    inject({
      kind: "plan",
      entries: [{ content: "Below the fold", status: "pending" }],
    }),
  );
  expect(log.scrollTop).toBe(20);
  expect(screen.getByRole("button", { name: /Jump to latest/ })).toBeVisible();
  vi.spyOn(mockDockApi, "sendPrompt").mockImplementation(
    async ({ content }) => {
      inject({ kind: "user_message", messageId: "sent", content });
    },
  );
  await user.type(
    screen.getByRole("textbox", { name: "Message the brain" }),
    "Send while scrolled up{Enter}",
  );
  expect(log.scrollTop).toBe(1000);
  expect(screen.queryByRole("button", { name: /Jump to latest/ })).toBeNull();
});
it("keeps list markup, inline permission code and the caret in the last text run", async () => {
  mount();
  await openChat();
  act(() => {
    inject({ kind: "status", status: "running" });
    inject({
      kind: "agent_message_delta",
      messageId: "markdown",
      text: "Items:\n\n- One\n- Two\n\n1. First\n2. Second\n\nStill streaming",
    });
  });
  const log = screen.getByRole("log");
  expect(log.querySelector("ul > li")).toHaveTextContent("One");
  expect(log.querySelector("ol > li")).toHaveTextContent("First");
  const caret = await screen.findByRole("status", { name: "Streaming" });
  expect(caret.closest("p")).toHaveTextContent("Still streaming");
  act(() => {
    inject({ kind: "status", status: "awaiting_permission" });
    inject({
      kind: "permission_request",
      requestId: "inline",
      title: "Run `npm test`",
      options: [],
    });
  });
  expect(screen.queryByRole("status", { name: "Streaming" })).toBeNull();
  expect(log.querySelector(".brain-permission code")).toHaveTextContent(
    "npm test",
  );
  act(() =>
    inject({
      kind: "permission_resolved",
      requestId: "inline",
      optionId: null,
    }),
  );
  expect(log.querySelector(".brain-permission-done code")).toHaveTextContent(
    "npm test",
  );
});
it("API-key auth prioritizes Add API key, focuses its editor and clears on ok", async () => {
  await mockDockApi.clearSecret("claude-openrouter", "ANTHROPIC_AUTH_TOKEN");
  await mockDockApi.startSession({ profileId: "claude-openrouter" });
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Brain chat · Ctrl+J" }),
  );
  expect(
    await screen.findByText("Claude via OpenRouter isn't signed in"),
  ).toBeVisible();
  expect(screen.getByText("No API key")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Add API key" }));
  expect(
    await screen.findByRole("dialog", { name: "Edit Claude via OpenRouter" }),
  ).toBeVisible();
  expect(screen.getByLabelText("API key")).toHaveValue("");
  expect(screen.getByLabelText("API key")).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  act(() => inject({ kind: "auth", state: "ok", label: "Signed in" }));
  expect(
    screen.queryByText("Claude via OpenRouter isn't signed in"),
  ).toBeNull();
  act(() =>
    inject({ kind: "auth", state: "required", label: "Sign in again" }),
  );
  expect(
    screen.queryByRole("button", { name: "Sign in with the CLI" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Add API key" })).toHaveClass(
    "primary",
  );
});
it.each(["claude-code", "codex"])(
  "%s auth keeps CLI primary and API key secondary",
  async (profileId) => {
    await mockDockApi.startSession({ profileId });
    mount();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Brain chat · Ctrl+J" }),
    );
    await screen.findByRole("textbox", { name: "Message the brain" });
    act(() =>
      inject({ kind: "auth", state: "required", label: "Not logged in" }),
    );
    expect(
      screen.getByRole("button", { name: "Sign in with the CLI" }),
    ).toHaveClass("primary");
    expect(
      screen.getByRole("button", { name: "Use an API key" }),
    ).not.toHaveClass("primary");
    expect(screen.queryByRole("button", { name: "Add API key" })).toBeNull();
    const start = vi.spyOn(mockDockApi, "startSession");
    await user.click(
      screen.getByRole("button", { name: "Sign in with the CLI" }),
    );
    await waitFor(() => expect(useBrainState.getState().tab).toBe("terminal"));
    expect(start).toHaveBeenCalledWith({
      profileId: profileId === "codex" ? "codex-cli" : "claude-cli",
      userConfig: "include",
    });
  },
);
it.each([false, true])(
  "Add key opens a focused editor without starting (New picker: %s)",
  async (fromNew) => {
    await mockDockApi.clearSecret("claude-zai", "ANTHROPIC_AUTH_TOKEN");
    mount();
    const user = userEvent.setup();
    if (fromNew) {
      await openChat();
      await user.click(
        screen.getByRole("button", {
          name: "New chat",
        }),
      );
    } else
      await user.click(
        await screen.findByRole("button", { name: "Brain chat · Ctrl+J" }),
      );
    const start = vi.spyOn(mockDockApi, "startSession");
    if (fromNew) {
      await user.click(screen.getByRole("combobox", { name: "Connection" }));
      await user.click(screen.getByRole("option", { name: "Claude via z.ai" }));
      await user.click(screen.getByRole("button", { name: "Start" }));
    } else
      await user.click(
        await screen.findByRole("button", { name: /Claude via z.ai Add key/ }),
      );
    const key = await screen.findByLabelText("API key");
    expect(key).toHaveFocus();
    await user.type(key, "fixture-zai-secret");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(key).toHaveValue("");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    if (!fromNew)
      expect(
        screen.getByRole("button", { name: /Claude via z.ai Ready/ }),
      ).toBeVisible();
    expect(start).not.toHaveBeenCalled();
    if (!fromNew)
      await user.click(screen.getByRole("button", { name: "Start chat" }));
    await user.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByRole("textbox", { name: "Message the brain" });
    expect(start).toHaveBeenCalledOnce();
    await mockDockApi.clearSecret("claude-zai", "ANTHROPIC_AUTH_TOKEN");
  },
);
// Profile validation, credential save and the staged 180 ms/event mock stream
// share one scenario. Keep all permission/history assertions with a local budget.
it("API groups, required model validation and a first-turn board permission use the shared chat UI", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Brain chat · Ctrl+J" }),
  );
  expect(
    await screen.findByRole("group", { name: "Agents" }),
  ).toHaveTextContent("Claude Code, Codex and other agent CLIs");
  const group = screen.getByRole("group", { name: "API" });
  expect(group).toHaveTextContent(
    "Your own key — OpenRouter, z.ai or any OpenAI-compatible endpoint",
  );
  await user.click(
    within(group).getByRole("button", { name: "OpenRouter Choose a model" }),
  );
  const start = vi.spyOn(mockDockApi, "startSession");
  await user.click(screen.getByRole("button", { name: "Start chat" }));
  expect(screen.getByRole("heading", { name: "Connection" })).toBeVisible();
  expect(
    await screen.findByRole("button", {
      name: /Claude Sonnet 4.6 Vision · Reasoning · 200K · \$3 \/ \$15 per 1M/,
    }),
  ).toBeVisible();
  await user.type(
    screen.getByRole("textbox", { name: "Search models" }),
    "provider/fixture-model",
  );
  await user.click(
    screen.getByRole("button", { name: "Use “provider/fixture-model”" }),
  );
  expect(start).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Start" }));
  const key = await screen.findByLabelText("API key");
  expect(key).toHaveFocus();
  await user.type(key, "fixture-api-secret");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(key).toHaveValue("");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(start).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("fixture-api-secret");
  await user.click(screen.getByRole("button", { name: "Start" }));
  const input = await screen.findByRole("textbox", {
    name: "Message the brain",
  });
  await user.click(input);
  await user.paste("Propose a task");
  await user.keyboard("{Enter}");
  const allow = await screen.findByRole(
    "button",
    { name: "Allow once" },
    { timeout: 3500 },
  );
  const sessionId = useBrainState.getState().selected.chat ?? "";
  expect(
    (await mockDockApi.history(sessionId)).some(
      (event) => event.kind === "tool_call_update",
    ),
  ).toBe(false);
  await user.click(allow);
  await waitFor(() =>
    expect(useBrainState.getState().sessions[0]?.status).toBe("ready"),
  );
  expect(
    (await mockDockApi.history(sessionId)).some(
      (event) =>
        event.kind === "tool_call_update" && event.status === "completed",
    ),
  ).toBe(true);
  expect(
    (await mockDockApi.history(sessionId)).filter(
      (event) => event.kind === "tool_call",
    ),
  ).toHaveLength(1);
  act(() =>
    inject({ kind: "auth", state: "required", label: "API key expired" }),
  );
  expect(screen.getByRole("button", { name: "Add API key" })).toHaveClass(
    "primary",
  );
  expect(
    screen.queryByRole("button", { name: "Sign in with the CLI" }),
  ).toBeNull();
}, 10000);
it("z.ai API exposes its coding-plan hint and Settings has a single Agents / API / Terminal heading level", async () => {
  mount("/settings");
  const user = userEvent.setup();
  const apiHeading = await screen.findByRole("heading", { name: "API" });
  expect(
    screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
  ).toEqual(["Agents", "API", "Terminal"]);
  expect(screen.queryByRole("heading", { name: "Chat" })).toBeNull();
  expect(screen.queryByRole("heading", { level: 4 })).toBeNull();
  await waitFor(() =>
    expect(apiHeading.parentElement).toHaveTextContent("OpenRouter"),
  );
  expect(apiHeading.parentElement).toHaveTextContent("z.ai");
  expect(apiHeading.parentElement).toHaveTextContent("Custom API");
  const row = screen
    .getByText("z.ai")
    .closest(".brain-connection-row") as HTMLElement;
  await user.click(within(row).getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Endpoint")).toHaveValue(
    "https://api.z.ai/api/paas/v4",
  );
  expect(
    screen.getByText(
      "GLM Coding Plan keys use https://api.z.ai/api/coding/paas/v4",
    ),
  ).toBeVisible();
});

it("BC12 launcher remembers model and effort per connection and requires explicit Start", async () => {
  mount();
  const start = vi.spyOn(mockDockApi, "startSession");
  const user = await openChat();
  await user.click(screen.getByRole("button", { name: /Model and effort:/ }));
  await user.click(screen.getByRole("button", { name: "Claude Opus 4.6" }));
  await user.click(screen.getByRole("button", { name: "High" }));
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("button", { name: /Claude Code · Claude Opus/ }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "New chat" }));
  expect(start).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", { name: "Claude Opus 4.6" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "High" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("combobox", { name: "Connection" }));
  await user.click(screen.getByRole("option", { name: "Codex" }));
  expect(screen.getByRole("button", { name: "Agent default" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByRole("group", { name: "Effort" })).toBeNull();
  await user.click(screen.getByRole("combobox", { name: "Connection" }));
  await user.click(screen.getByRole("option", { name: "Claude Code" }));
  expect(screen.getByRole("button", { name: "High" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("textbox", { name: "Message the brain" });
  expect(start).toHaveBeenLastCalledWith({
    profileId: "claude-code",
    userConfig: "include",
    model: "claude-opus-4-6",
    effort: "high",
  });
  expect(
    JSON.parse(localStorage.getItem("jam.brainPreferences") ?? "{}")[
      "claude-code"
    ],
  ).toMatchObject({ model: "claude-opus-4-6", effort: "high" });
});

it("BC13 category chips hide independently and Access explains known and agent-defined values", async () => {
  mount();
  const user = await openChat();
  await user.click(screen.getByRole("button", { name: "Access: Ask first" }));
  for (const text of [
    "Asks before editing files, running commands or changing the board.",
    "Edits files without asking; asks for everything else.",
    "Reads and proposes a plan; changes nothing.",
    "Runs commands and edits files without asking. Use only in a folder you can afford to lose.",
  ])
    expect(screen.getByText(text)).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Full auto Runs commands/ }),
  ).toHaveClass("brain-access-danger");
  await user.keyboard("{Escape}");
  act(() =>
    inject({
      kind: "config_options",
      options: [
        {
          id: "custom-model",
          category: "model",
          name: "Agent model",
          value: "combined",
          values: [{ value: "combined", name: "Model (high)" }],
        },
      ],
    }),
  );
  expect(
    screen.getByRole("button", { name: "Model and effort: Model (high)" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Access:/ })).toBeNull();
  act(() =>
    inject({
      kind: "config_options",
      options: [
        {
          id: "model",
          category: null,
          name: "Uncategorized model",
          value: "default",
          values: [{ value: "default", name: "Agent default" }],
        },
      ],
    }),
  );
  expect(
    screen.queryByRole("button", { name: /Model and effort:/ }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "More options" })).toBeVisible();
  act(() =>
    inject({
      kind: "config_options",
      options: [
        {
          id: "access",
          category: "mode",
          name: "Access",
          value: "review",
          values: [
            {
              value: "review",
              name: "Review workspace",
              description: "Only reviews this workspace.",
            },
          ],
        },
      ],
    }),
  );
  expect(
    screen.queryByRole("button", { name: /Model and effort:/ }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Access: Review workspace" }),
  );
  expect(screen.getByText("Only reviews this workspace.")).toBeVisible();
});

it("BC13 changes add quiet dividers only after a first message", async () => {
  mount();
  await openChat();
  const state = useBrainState.getState();
  const options = sessionOptions(
    state.events[state.selected.chat ?? ""] ?? [],
  ).map((o) =>
    o.category === "model" ? { ...o, value: "claude-opus-4-6" } : o,
  );
  act(() => inject({ kind: "config_options", options }));
  expect(document.querySelector(".brain-config-divider")).toBeNull();
  act(() => {
    inject({
      kind: "user_message",
      messageId: "first",
      content: [{ type: "text", text: "Plan this" }],
    });
    inject({
      kind: "config_options",
      options: options.map((o) =>
        o.category === "thought_level" ? { ...o, value: "high" } : o,
      ),
    });
  });
  expect(screen.getByText("Effort → High")).toBeVisible();
  act(() =>
    inject({
      kind: "config_options",
      options: options.map((o) =>
        o.category === "mode"
          ? { ...o, value: "plan" }
          : o.category === "thought_level"
            ? { ...o, value: "high" }
            : o,
      ),
    }),
  );
  expect(screen.getByText("Access → Plan only")).toBeVisible();
  act(() =>
    inject({
      kind: "config_options",
      options: options.map((o) =>
        o.category === "model"
          ? { ...o, value: "claude-sonnet-4-6" }
          : o.category === "mode"
            ? { ...o, value: "plan" }
            : o.category === "thought_level"
              ? { ...o, value: "high" }
              : o,
      ),
    }),
  );
  expect(screen.getByText("Model → Claude Sonnet 4.6")).toBeVisible();
});

it("BC13 compact Access retains its accessible label and explanatory tooltip, including while running", async () => {
  mount();
  const user = await openChat();
  const access = screen.getByRole("button", { name: "Access: Ask first" });
  const model = screen.getByRole("button", { name: /Model and effort:/ });
  expect(access).toHaveClass("brain-access-chip");
  expect(access.closest(".brain-access-anchor")).not.toBeNull();
  expect(model.closest(".brain-model-anchor")).not.toBeNull();
  await user.hover(access);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Ask first · Asks before editing files, running commands or changing the board.",
  );
  act(() => inject({ kind: "status", status: "running" }));
  expect(access).toBeDisabled();
  expect(screen.getByRole("tooltip")).toHaveTextContent("Ask first");
  expect(screen.getByRole("tooltip")).toHaveTextContent(
    "Available after this turn",
  );
});

it("BC14 ten attachments retain the editable draft, available Send, and individual removal", async () => {
  mount();
  const user = await openChat();
  const input = screen.getByRole("textbox", { name: "Message the brain" });
  await user.type(input, "Keep this draft visible");
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: {
      files: Array.from(
        { length: 10 },
        (_, i) => new File(["image"], `tile-${i}.png`, { type: "image/png" }),
      ),
    },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
  );
  expect(
    document.querySelectorAll(
      ".brain-composer > .brain-attachment-row .brain-attachment",
    ),
  ).toHaveLength(10);
  expect(input).toBeEnabled();
  expect(input).toHaveValue("Keep this draft visible");
  await user.click(screen.getByRole("button", { name: "Remove tile-9.png" }));
  expect(
    document.querySelectorAll(
      ".brain-composer > .brain-attachment-row .brain-attachment",
    ),
  ).toHaveLength(9);
});

it("BC13 running chips retain their place, disable open popover choices, and explain availability", async () => {
  mount();
  const user = await openChat();
  const model = screen.getByRole("button", { name: /Model and effort:/ });
  const access = screen.getByRole("button", { name: /^Access:/ });
  await user.click(model);
  const set = vi.spyOn(mockDockApi, "setConfigOption");
  act(() => inject({ kind: "status", status: "running" }));
  expect(model).toBeDisabled();
  expect(access).toBeDisabled();
  expect(screen.getByRole("button", { name: "High" })).toBeDisabled();
  fireEvent.mouseEnter(model.parentElement as HTMLElement);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Available after this turn",
  );
  expect(set).not.toHaveBeenCalled();
});

it("BC14 attachments copy with progress, send without text, open a lightbox and add a copied canvas image", async () => {
  mount();
  const user = await openChat();
  const send = vi.spyOn(mockDockApi, "sendPrompt");
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: {
      files: [
        new File([new Uint8Array([137, 80, 78, 71])], "mood.png", {
          type: "image/png",
        }),
      ],
    },
  });
  expect(screen.getByText("Copying…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      content: [expect.objectContaining({ type: "attachment" })],
    }),
  );
  expect(screen.queryByRole("button", { name: "Remove mood.png" })).toBeNull();
  await user.click(
    await screen.findByRole("button", { name: "Open mood.png" }),
  );
  expect(screen.getByRole("dialog", { name: "mood.png" })).toBeVisible();
  await user.keyboard("{Escape}");
  const id = Object.keys(useBrainState.getState().attachments).at(-1) ?? "";
  act(() =>
    useBrainState.setState((s) => ({
      attachments: {
        ...s.attachments,
        [id]: {
          ...(s.attachments[id] ?? {
            id,
            name: "mood.png",
            mimeType: "image/png",
            size: 4,
            isImage: true,
            thumbnail: null,
            previewUrl: null,
          }),
          path: "C:/mock/agent-attachments/mood.png",
        },
      },
    })),
  );
  const add = vi.spyOn(mockApi, "addReference");
  await user.click(screen.getByRole("button", { name: "Add to canvas" }));
  await waitFor(() =>
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "C:/mock/agent-attachments/mood.png",
        copy: true,
      }),
    ),
  );
  await mockDockApi.cancelTurn(useBrainState.getState().selected.chat ?? "");
});

it("BC14 paste and HTML file drop attach to the dock; refusals block Send and survive close/reopen", async () => {
  mount();
  const user = await openChat();
  const composer = screen.getByRole("textbox", { name: "Message the brain" });
  fireEvent.paste(composer, {
    clipboardData: {
      files: [new File(["brief"], "brief.txt", { type: "text/plain" })],
    },
  });
  await screen.findByRole("button", { name: "Remove brief.txt" });
  const dock = screen.getByRole("complementary", { name: "Brain dock" });
  const dataTransfer = {
    types: ["Files"],
    files: [new File(["x"], "refused-copy.txt", { type: "text/plain" })],
  };
  fireEvent.dragOver(dock, { dataTransfer });
  expect(screen.getByText("Drop to attach")).toBeVisible();
  fireEvent.drop(dock, { dataTransfer });
  expect(screen.queryByText("Drop to attach")).toBeNull();
  expect(await screen.findByText(/Could not copy this file/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Close brain dock" }));
  await user.click(screen.getByRole("button", { name: "Brain chat · Ctrl+J" }));
  expect(
    await screen.findByRole("button", { name: "Remove brief.txt" }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Remove refused-copy.txt" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
  );
});

it("BC14 API refusals re-evaluate when the model changes and unsupported files stay unsent", async () => {
  await mockDockApi.saveProfile({
    id: "api-openrouter",
    label: "OpenRouter",
    kind: "api",
    model: "glm-4.6",
  });
  await mockDockApi.setSecret("api-openrouter", "API_KEY", "fixture");
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Brain chat · Ctrl+J" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "OpenRouter Ready" }),
  );
  await user.click(screen.getByRole("button", { name: "Start chat" }));
  await user.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("textbox", { name: "Message the brain" });
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: {
      files: [
        new File(["image"], "vision.png", { type: "image/png" }),
        new File(["archive"], "archive.zip", { type: "application/zip" }),
      ],
    },
  });
  expect(
    await screen.findByText(
      "This model can't see images — pick a vision model",
    ),
  ).toBeVisible();
  expect(
    await screen.findByText(
      "Not supported in API chat — use an agent connection",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Access:/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: /Model and effort:/ }));
  await user.click(
    screen.getByRole("button", { name: /Claude Sonnet 4.6 Vision/ }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText("This model can't see images — pick a vision model"),
    ).toBeNull(),
  );
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Remove archive.zip" }));
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
});

it("BC14 board-ref drop targets the composer, deduplicates chips and never sends automatically", async () => {
  mount();
  const user = await openChat();
  const send = vi.spyOn(mockDockApi, "sendPrompt");
  const refs = [
    { uri: "jam://frame/moodboard", label: "Moodboard", text: "A board frame" },
  ];
  expect(
    document.querySelector('[data-board-ref-drop="brain-composer"]'),
  ).toBeVisible();
  act(() =>
    window.dispatchEvent(
      new CustomEvent("jam:board-ref-drop", {
        detail: { target: "task-references", refs },
      }),
    ),
  );
  expect(screen.queryByText("Moodboard")).toBeNull();
  act(() => {
    for (let i = 0; i < 2; i++)
      window.dispatchEvent(
        new CustomEvent("jam:board-ref-drop", {
          detail: { target: "brain-composer", refs },
        }),
      );
  });
  expect(
    screen.getAllByRole("button", { name: "Remove Moodboard" }),
  ).toHaveLength(1);
  expect(send).not.toHaveBeenCalled();
  await user.hover(screen.getByRole("button", { name: "Remove Moodboard" }));
  fireEvent.mouseEnter(
    screen.getByRole("button", { name: "Remove Moodboard" })
      .parentElement as HTMLElement,
  );
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Remove Moodboard",
  );
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ content: [{ ...refs[0], type: "board_ref" }] }),
  );
  await mockDockApi.cancelTurn(useBrainState.getState().selected.chat ?? "");
});

it("BC16 Brain shared tooltip includes the shortcut and live state", async () => {
  mount();
  const user = await openChat();
  await user.hover(screen.getByRole("button", { name: "Brain chat · Ctrl+J" }));
  fireEvent.mouseEnter(
    screen.getByRole("button", { name: "Brain chat · Ctrl+J" })
      .parentElement as HTMLElement,
  );
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Brain chat · Ctrl+J",
  );
  act(() => inject({ kind: "status", status: "running" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent(
    "Claude Code · working",
  );
  act(() => inject({ kind: "status", status: "awaiting_permission" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Needs you");
  act(() => inject({ kind: "status", status: "failed" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("Error — open to see");
});

it("BC12 API catalog offers Starred, free-text IDs, Show all models and explicit Refresh", async () => {
  await mockDockApi.saveProfile({
    id: "api-openrouter",
    label: "OpenRouter",
    kind: "api",
    model: "glm-4.6",
  });
  await mockDockApi.setSecret("api-openrouter", "API_KEY", "fixture");
  mount();
  const user = userEvent.setup();
  const catalog = vi.spyOn(mockDockApi, "modelCatalog");
  await user.click(
    await screen.findByRole("button", { name: "Brain chat · Ctrl+J" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "OpenRouter Ready" }),
  );
  await user.click(screen.getByRole("button", { name: "Start chat" }));
  expect(
    screen.queryByRole("button", { name: /Vision preview No board tools/ }),
  ).toBeNull();
  await user.click(screen.getByRole("switch", { name: "Show all models" }));
  expect(
    await screen.findByRole("button", { name: /Vision preview Vision/ }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Star Vision preview" }));
  expect(screen.getByRole("region", { name: "Starred ★" })).toHaveTextContent(
    "Vision preview",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Search models" }),
    "provider/private-model",
  );
  await user.click(
    screen.getByRole("button", { name: "Use “provider/private-model”" }),
  );
  await user.clear(screen.getByRole("textbox", { name: "Search models" }));
  expect(screen.getByRole("region", { name: "Recent" })).toHaveTextContent(
    "provider/private-model",
  );
  await user.click(screen.getByRole("button", { name: "Refresh models" }));
  expect(catalog).toHaveBeenCalledWith({
    profileId: "api-openrouter",
    refresh: true,
  });
});

it("BC14 the eleventh uploaded file is refused before copying and New preserves the old attachment draft", async () => {
  mount();
  const user = await openChat();
  const add = vi.spyOn(mockDockApi, "addAttachment");
  fireEvent.change(screen.getByLabelText("Choose attachments"), {
    target: {
      files: Array.from(
        { length: 11 },
        (_, n) => new File(["x"], `brief-${n}.txt`, { type: "text/plain" }),
      ),
    },
  });
  expect(screen.getByText("Up to 10 files per message")).toBeVisible();
  await waitFor(() => expect(add).toHaveBeenCalledTimes(10));
  const old = useBrainState.getState().selected.chat;
  await user.click(screen.getByRole("button", { name: "New chat" }));
  await user.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("textbox", { name: "Message the brain" });
  expect(useBrainState.getState().selected.chat).not.toBe(old);
  expect(
    screen.queryByRole("button", { name: "Remove brief-0.txt" }),
  ).toBeNull();
  const projectId = useBrainState.getState().projectId;
  expect(
    useBrainState.getState().drafts[`${projectId}:${old}`]?.attachments,
  ).toHaveLength(11);
});

it("BC12 cached ACP choices apply only after ready even when the dock has closed", async () => {
  mount();
  const user = await openChat();
  const id = useBrainState.getState().selected.chat ?? "";
  const apply = vi
    .spyOn(mockDockApi, "setConfigOption")
    .mockImplementation(async () => {
      expect(
        useBrainState.getState().sessions.find((s) => s.id === id)?.status,
      ).toBe("ready");
    });
  act(() => {
    inject({ kind: "status", status: "starting" });
    pendingSessionChoices.set(id, { model: "claude-opus-4-6", effort: "high" });
  });
  await user.click(screen.getByRole("button", { name: "Close brain dock" }));
  expect(apply).not.toHaveBeenCalled();
  act(() => inject({ kind: "status", status: "ready" }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  expect(apply).toHaveBeenCalledWith({
    sessionId: id,
    optionId: "model",
    value: "claude-opus-4-6",
  });
  expect(apply).toHaveBeenCalledWith({
    sessionId: id,
    optionId: "thought_level",
    value: "high",
  });
});

it("R10-A/BC07 More visibly names and describes both paths and returns focus", async () => {
  mount();
  const user = await openChat();
  const trigger = screen.getByRole("button", { name: "More options" });
  expect(trigger).toHaveTextContent("");
  expect(trigger.querySelector("svg")).not.toBeNull();
  await user.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Fast mode", { selector: "label" })).toBeVisible();
  expect(
    screen.getByText("Faster responses on supported models"),
  ).toBeVisible();
  expect(screen.getByRole("switch", { name: "Fast mode" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  expect(screen.getByLabelText("Response style")).toBe(
    screen.getByRole("combobox", { name: "Response style" }),
  );
  expect(screen.getByText("Mock fixture for session choices.")).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("switch", { name: "Fast mode" })).toBeNull();
  expect(trigger).toHaveFocus();
});

it("R10-A/BC07 switch guards pending changes and updates the indicator", async () => {
  mount();
  const user = await openChat();
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = mockDockApi.setConfigOption;
  const apply = vi
    .spyOn(mockDockApi, "setConfigOption")
    .mockImplementation(async (value) => {
      await waiting;
      await original(value);
    });
  await user.click(screen.getByRole("button", { name: "More options" }));
  expect(screen.queryByLabelText("1 active session options")).toBeNull();
  await user.click(screen.getByRole("switch", { name: "Fast mode" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith({
    sessionId: useBrainState.getState().selected.chat,
    optionId: "fast",
    value: "on",
  });
  expect(screen.getByText("Applying session choices…")).toBeVisible();
  expect(screen.getByRole("switch", { name: "Fast mode" })).toBeDisabled();
  expect(
    screen.getByRole("combobox", { name: "Response style" }),
  ).toBeDisabled();
  await act(async () => release());
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Fast mode" })).toBeEnabled(),
  );
  expect(screen.getByRole("switch", { name: "Fast mode" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(screen.getByLabelText("1 active session options")).toBeVisible();
  await user.click(screen.getByRole("switch", { name: "Fast mode" }));
  await waitFor(() =>
    expect(screen.queryByLabelText("1 active session options")).toBeNull(),
  );
});

it("R10-A/BC07 dropdown changes and restores its baseline; running disables both paths", async () => {
  mount();
  const user = await openChat();
  const apply = vi.spyOn(mockDockApi, "setConfigOption");
  await user.click(screen.getByRole("button", { name: "More options" }));
  await user.click(screen.getByRole("combobox", { name: "Response style" }));
  await user.click(screen.getByRole("option", { name: "Concise" }));
  expect(apply).toHaveBeenCalledWith({
    sessionId: useBrainState.getState().selected.chat,
    optionId: "mock-response-style",
    value: "concise",
  });
  expect(screen.getByLabelText("1 active session options")).toBeVisible();
  await user.click(screen.getByRole("combobox", { name: "Response style" }));
  await user.click(screen.getByRole("option", { name: "Balanced" }));
  expect(screen.queryByLabelText("1 active session options")).toBeNull();
  act(() => inject({ kind: "status", status: "running" }));
  expect(screen.getByRole("switch", { name: "Fast mode" })).toBeDisabled();
  expect(
    screen.getByRole("combobox", { name: "Response style" }),
  ).toBeDisabled();
});

it.each([
  ["ON", "OFF"],
  ["True", "False"],
])(
  "R10-A/BC07 %s/%s is case insensitive; initial On is active",
  async (on, off) => {
    mount();
    const user = await openChat();
    act(() =>
      inject({
        kind: "config_options",
        options: [
          {
            id: "toggle",
            name: "Fixture toggle",
            value: on,
            values: [
              { value: on, name: "Enabled" },
              { value: off, name: "Disabled" },
            ],
          },
        ],
      }),
    );
    const apply = vi.spyOn(mockDockApi, "setConfigOption").mockResolvedValue();
    expect(screen.getByLabelText("1 active session options")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(screen.getByRole("switch", { name: "Fixture toggle" }));
    expect(apply).toHaveBeenCalledWith({
      sessionId: useBrainState.getState().selected.chat,
      optionId: "toggle",
      value: off,
    });
  },
);

it("BC13 Send waits for an in-flight model change and retains the message", async () => {
  mount();
  const user = await openChat();
  const input = screen.getByRole("textbox", { name: "Message the brain" });
  await user.type(input, "Use the new model for this message");
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = mockDockApi.setConfigOption;
  vi.spyOn(mockDockApi, "setConfigOption").mockImplementation(async (value) => {
    await waiting;
    await original(value);
  });
  await user.click(screen.getByRole("button", { name: /Model and effort:/ }));
  await user.click(screen.getByRole("button", { name: "Claude Opus 4.6" }));
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(screen.getByText("Applying session choices…")).toBeVisible();
  expect(input).toHaveValue("Use the new model for this message");
  await act(async () => release());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(),
  );
  expect(
    screen.getByRole("button", { name: /Model and effort: Claude Opus/ }),
  ).toBeVisible();
});

it("BC12 a failed startup clears pending choices and keeps Restart actionable", async () => {
  mount();
  await openChat();
  const id = useBrainState.getState().selected.chat ?? "";
  const apply = vi.spyOn(mockDockApi, "setConfigOption");
  act(() => {
    inject({ kind: "status", status: "starting" });
    pendingSessionChoices.set(id, { model: "claude-opus-4-6" });
    useBrainState.setState({ configuring: { [id]: true } });
    inject({ kind: "status", status: "failed" });
  });
  expect(pendingSessionChoices.has(id)).toBe(false);
  expect(screen.queryByText("Applying session choices…")).toBeNull();
  expect(screen.getByRole("button", { name: "Restart session" })).toBeEnabled();
  expect(apply).not.toHaveBeenCalled();
});
it("R7-W4 pointer Undo stays inside the History tab; Escape closes only its action menu", async () => {
  mount();
  const user = await openChat();
  await user.click(screen.getByRole("tab", { name: "History" }));
  const history = await screen.findByRole("region", { name: "History" });
  const open = await within(history).findByRole("button", { name: /^Open / });
  const title = open.textContent;
  const actions = within(history).getByRole("button", {
    name: /^History actions for /,
  });
  await user.click(actions);
  await user.keyboard("{Escape}");
  expect(history).toBeVisible();
  expect(actions).toHaveFocus();
  await user.click(actions);
  await user.click(within(history).getByRole("menuitem", { name: "Delete" }));
  const undo = within(history).getByRole("button", { name: "Undo" });
  expect(undo).toHaveFocus();
  expect(within(history).queryByRole("button", { name: /^Open / })).toBeNull();
  await user.click(undo);
  expect(history).toBeVisible();
  expect(
    within(history).getByRole("button", { name: /^Open / }),
  ).toHaveTextContent(title ?? "");
});
it("R7-B7 Starting streams launch steps, shows the new header and exposes read-only Logs", async () => {
  mount();
  const user = await openChat();
  setMockLaunchDelay(800);
  await user.click(screen.getByRole("button", { name: "New chat" }));
  expect(document.querySelector(".brain-session-title")).toHaveTextContent(
    "New chat",
  );
  await user.click(screen.getByRole("button", { name: "Start" }));
  expect(screen.getByRole("button", { name: "Starting\u2026" })).toBeDisabled();
  expect(screen.getByRole("log", { name: "Launch steps" })).toHaveTextContent(
    "OKAdapter starting",
  );
  act(() =>
    emitMockDockEvent(useBrainState.getState().selected.chat ?? "", {
      kind: "launch_step",
      step: "mcp-board",
      state: "failed",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      message: "mcp__jam-board__startup failed",
    }),
  );
  expect(screen.getByRole("log", { name: "Launch steps" })).toHaveTextContent(
    "Failedmcp__jam-board__startup failed",
  );
  await screen.findByRole("textbox", { name: "Message the brain" });
  await user.click(screen.getByRole("button", { name: "Session actions" }));
  await user.click(screen.getByRole("button", { name: "Logs" }));
  const logs = await screen.findByRole("log", { name: "Launch timeline" });
  await waitFor(() =>
    expect(logs).toHaveTextContent("mcp__jam-board__startup failed"),
  );
  expect(screen.getByRole("button", { name: "Copy raw" })).toBeEnabled();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "Session logs" })).toBeNull();
  expect(screen.getByRole("button", { name: "Session actions" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Session actions" }));
  await user.click(screen.getByRole("button", { name: "Logs" }));
  act(() => useBrainState.setState({ projectId: "other-project" }));
  expect(screen.queryByRole("region", { name: "Session logs" })).toBeNull();
});
it("R7-B7 launch steps remain live before the start command returns, with confirmed project identity", async () => {
  mount();
  const user = await openChat();
  const original = mockDockApi.startSession;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(mockDockApi, "startSession").mockImplementation(async (input) => {
    const session = await original(input);
    await held;
    return session;
  });
  await user.click(screen.getByRole("button", { name: "New chat" }));
  await user.click(screen.getByRole("button", { name: "Start" }));
  await waitFor(() =>
    expect(screen.getByRole("log", { name: "Launch steps" })).toHaveTextContent(
      "OKAdapter starting",
    ),
  );
  expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
  await act(async () => release());
  await screen.findByRole("textbox", { name: "Message the brain" });
});
