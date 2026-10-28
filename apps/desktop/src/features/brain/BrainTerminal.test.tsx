import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockDockApi, resetMockDock } from "../../lib/agent-dock-mock";
import { mockApi } from "../../lib/mock-bridge";
import { BrainTerminal } from "./BrainTerminal";
import { useBrainState } from "./brain-store";

const xterm = vi.hoisted(() => ({
  write: vi.fn(),
  dispose: vi.fn(),
  focus: vi.fn(),
  open: vi.fn(),
  fit: vi.fn(),
  refresh: vi.fn(),
  options: {} as Record<string, unknown>,
  instance: null as { cols: number; rows: number } | null,
  fitCols: 80,
  fitRows: 24,
  onInput: (_: string) => {},
  onTitle: (_: string) => {},
  titleDispose: vi.fn(),
}));
vi.mock("../../lib/agent-dock", async () => ({
  agentDockApi: (await import("../../lib/agent-dock-mock")).mockDockApi,
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      xterm.options = options;
      xterm.instance = this;
    }
    cols = 80;
    rows = 24;
    open = xterm.open;
    loadAddon() {}
    write = xterm.write;
    dispose = xterm.dispose;
    focus = xterm.focus;
    refresh = xterm.refresh;
    onData(cb: (data: string) => void) {
      xterm.onInput = cb;
      return { dispose: vi.fn() };
    }
    onTitleChange(cb: (title: string) => void) {
      xterm.onTitle = cb;
      return { dispose: xterm.titleDispose };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {
      if (xterm.instance) {
        xterm.instance.cols = xterm.fitCols;
        xterm.instance.rows = xterm.fitRows;
      }
      xterm.fit();
    }
  },
}));
const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
beforeEach(() => {
  vi.clearAllMocks();
  xterm.fitCols = 80;
  xterm.fitRows = 24;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (fontsDescriptor)
    Object.defineProperty(document, "fonts", fontsDescriptor);
  else Reflect.deleteProperty(document, "fonts");
});
it("keyboard tab activation leaves focus in the tabs until terminal focus is explicitly requested", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  const session = await mockDockApi.startSession({ profileId: "codex-cli" });
  xterm.focus.mockClear();
  const view = render(
    <BrainTerminal session={session} restart={vi.fn()} focusEpoch={-1} />,
  );
  await waitFor(() => expect(xterm.write).toHaveBeenCalled());
  expect(xterm.focus).not.toHaveBeenCalled();
  view.rerender(
    <BrainTerminal session={session} restart={vi.fn()} focusEpoch={1} />,
  );
  expect(xterm.focus).toHaveBeenCalledOnce();
});
it("replays the terminal snapshot before live echo, forwards input and resize, and disposes on remount", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  resetMockDock();
  await mockApi.resetDemo();
  const session = await mockDockApi.startSession({ profileId: "codex-cli" });
  const input = vi.spyOn(mockDockApi, "terminalWrite");
  const resize = vi.spyOn(mockDockApi, "terminalResize");
  const view = render(<BrainTerminal session={session} restart={vi.fn()} />);
  await waitFor(() =>
    expect(xterm.write).toHaveBeenCalledWith(
      expect.stringContaining("mock terminal"),
    ),
  );
  expect(resize).toHaveBeenCalledWith({
    sessionId: session.id,
    cols: 80,
    rows: 24,
  });
  expect(xterm.focus).toHaveBeenCalled();
  xterm.focus.mockClear();
  view.rerender(
    <BrainTerminal session={session} restart={vi.fn()} focusEpoch={1} />,
  );
  expect(xterm.focus).toHaveBeenCalledOnce();
  await act(async () => xterm.onInput("help\r"));
  expect(input).toHaveBeenCalledWith({ sessionId: session.id, data: "help\r" });
  expect(xterm.write).toHaveBeenLastCalledWith("help\r\n> ");
  view.unmount();
  expect(xterm.dispose).toHaveBeenCalled();
  expect(await mockDockApi.terminalSnapshot(session.id)).toContain(
    "help\r\n> ",
  );
});
it("Stop ends the terminal and Restart invokes a new session action", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  const user = userEvent.setup();
  const session = await mockDockApi.startSession({ profileId: "codex-cli" });
  const restart = vi.fn();
  render(<BrainTerminal session={session} restart={restart} />);
  await user.click(screen.getByRole("button", { name: "Stop" }));
  expect((await mockDockApi.sessions())[0]?.status).toBe("stopped");
  await user.click(screen.getByRole("button", { name: "Restart" }));
  expect(restart).toHaveBeenCalledOnce();
});

it("BC03 waits for Latin/Cyrillic fonts, fits, subscribes, then sends the launch size", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  const session = await mockDockApi.startSession({ profileId: "codex-cli" });
  xterm.fitCols = 47;
  xterm.fitRows = 9;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  let loaded!: () => void;
  const fonts = new EventTarget();
  // A single gate stands in for the four font subset/weight requests.
  const gate = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  const load = vi.fn(() => gate);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: Object.assign(fonts, { load, ready: Promise.resolve() }),
  });
  vi.spyOn(mockDockApi, "history").mockResolvedValue([
    {
      sessionId: session.id,
      seq: 1,
      at: session.createdAt,
      kind: "status",
      status: "starting",
      message: 'Terminal renderer: {"backend":"conpty","buildNumber":26100}',
    },
  ]);
  const resize = vi.spyOn(mockDockApi, "terminalResize");
  const subscribe = vi.spyOn(mockDockApi, "onTerminalOutput");
  const snapshot = vi.spyOn(mockDockApi, "terminalSnapshot");
  render(<BrainTerminal session={session} restart={vi.fn()} />);
  expect(xterm.open).not.toHaveBeenCalled();
  expect(resize).not.toHaveBeenCalled();
  expect(snapshot).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledWith(
    '400 12px "JetBrains Mono Variable"',
    "Wm0123456789",
  );
  expect(load).toHaveBeenCalledWith(
    '400 12px "JetBrains Mono Variable"',
    expect.stringContaining("Что"),
  );
  expect(load).toHaveBeenCalledTimes(4);
  await act(async () => loaded());
  await waitFor(() => expect(resize).toHaveBeenCalled());
  expect(xterm.options).toMatchObject({
    convertEol: false,
    windowsPty: { backend: "conpty", buildNumber: 26100 },
  });
  expect(xterm.fit.mock.invocationCallOrder[0]).toBeLessThan(
    snapshot.mock.invocationCallOrder[0] ?? 0,
  );
  expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(
    resize.mock.invocationCallOrder[0] ?? 0,
  );
  expect(resize).toHaveBeenCalledWith({
    sessionId: session.id,
    cols: 47,
    rows: 9,
  });
  await act(async () => fonts.dispatchEvent(new Event("loadingdone")));
  expect(xterm.refresh).toHaveBeenCalledWith(0, 8);
  expect(resize).toHaveBeenCalledTimes(2);
});

it("BC03 keeps a hidden terminal pending until the host has visible dimensions", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  const session = await mockDockApi.startSession({ profileId: "codex-cli" });
  const width = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(0);
  const resize = vi.spyOn(mockDockApi, "terminalResize");
  let changed!: () => void;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        changed = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  render(<BrainTerminal session={session} restart={vi.fn()} />);
  await waitFor(() => expect(xterm.write).toHaveBeenCalled());
  expect(resize).not.toHaveBeenCalled();
  expect(xterm.options.windowsPty).toBeUndefined();
  width.mockReturnValue(400);
  await act(async () => changed());
  expect(resize).toHaveBeenCalledOnce();
});

it("BC03 reports failed font loading and never opens or sends a guessed launch size", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  const session = await mockDockApi.startSession({ profileId: "codex-cli" });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      load: () => Promise.reject(new Error("Font unavailable")),
      ready: Promise.resolve(),
    }),
  });
  const resize = vi.spyOn(mockDockApi, "terminalResize");
  render(<BrainTerminal session={session} restart={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Font unavailable",
  );
  expect(xterm.open).not.toHaveBeenCalled();
  expect(resize).not.toHaveBeenCalled();
});

it("BC03 keeps startup feedback through control-only output until backend printable readiness", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  const session = {
    ...(await mockDockApi.startSession({ profileId: "claude-cli" })),
    status: "starting" as const,
  };
  const profile = (await mockDockApi.profiles()).find(
    (p) => p.id === "claude-cli",
  );
  vi.spyOn(mockDockApi, "terminalSnapshot").mockResolvedValue("");
  let output!: (event: { sessionId: string; data: string }) => void;
  vi.spyOn(mockDockApi, "onTerminalOutput").mockImplementation((cb) => {
    output = cb;
    return vi.fn();
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(session.createdAt));
  const view = render(
    <BrainTerminal session={session} profile={profile} restart={vi.fn()} />,
  );
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent(
    `Starting ${profile?.label}…`,
  );
  expect(screen.getByText("0 s")).toBeInTheDocument();
  await act(async () =>
    output({
      sessionId: session.id,
      data: "\x1b[?25l\x1b]0;CLI title\x07\r\n",
    }),
  );
  await act(async () => vi.advanceTimersByTime(2000));
  expect(screen.getByRole("status")).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByText("5 s")).toBeInTheDocument();
  expect(
    screen.getByText(
      "CLIs can take a while on first start: update check, MCP servers",
    ),
  ).toBeInTheDocument();
  await act(async () => output({ sessionId: "another-session", data: "x" }));
  expect(screen.getByRole("status")).toBeInTheDocument();
  await act(async () => output({ sessionId: session.id, data: "Привет" }));
  view.rerender(
    <BrainTerminal
      session={{ ...session, status: "ready" }}
      profile={profile}
      restart={vi.fn()}
    />,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(xterm.write).toHaveBeenLastCalledWith("Привет");
});

it("R7-B1 forwards OSC titles to A4's terminal title store and disposes the subscription", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  useBrainState.setState({ terminalTitles: {} });
  const session = await mockDockApi.startSession({ profileId: "codex-cli" });
  const view = render(<BrainTerminal session={session} restart={vi.fn()} />);
  await waitFor(() => expect(xterm.open).toHaveBeenCalled());
  await act(async () => xterm.onTitle("  Fixture — Противоречие\x07  "));
  expect(useBrainState.getState().terminalTitles?.[session.id]).toBe(
    "Fixture — Противоречие",
  );
  view.unmount();
  expect(xterm.titleDispose).toHaveBeenCalledOnce();
  await act(async () => xterm.onTitle("stale"));
  expect(useBrainState.getState().terminalTitles?.[session.id]).toBe(
    "Fixture — Противоречие",
  );
});

it("BC03 removes the starting overlay on timeout readiness, failure or stop", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  const session = await mockDockApi.startSession({ profileId: "codex-cli" });
  vi.spyOn(mockDockApi, "terminalSnapshot").mockResolvedValue("");
  const view = render(
    <BrainTerminal
      session={{ ...session, status: "starting" }}
      restart={vi.fn()}
    />,
  );
  expect(screen.getByRole("status")).toBeInTheDocument();
  for (const status of ["ready", "failed", "stopped"] as const) {
    view.rerender(
      <BrainTerminal session={{ ...session, status }} restart={vi.fn()} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  }
});

it("BC03 unmount during font preparation never opens or launches the terminal", async () => {
  resetMockDock();
  await mockApi.resetDemo();
  const session = await mockDockApi.startSession({ profileId: "codex-cli" });
  let loaded!: () => void;
  const gate = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      load: () => gate,
      ready: Promise.resolve(),
    }),
  });
  const resize = vi.spyOn(mockDockApi, "terminalResize");
  const view = render(<BrainTerminal session={session} restart={vi.fn()} />);
  view.unmount();
  await act(async () => loaded());
  expect(xterm.open).not.toHaveBeenCalled();
  expect(resize).not.toHaveBeenCalled();
  expect(xterm.dispose).toHaveBeenCalled();
});
