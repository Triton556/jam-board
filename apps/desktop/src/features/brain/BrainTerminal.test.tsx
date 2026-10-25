import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { mockDockApi, resetMockDock } from "../../lib/agent-dock-mock";
import { mockApi } from "../../lib/mock-bridge";
import { BrainTerminal } from "./BrainTerminal";

const xterm = vi.hoisted(() => ({
  write: vi.fn(),
  dispose: vi.fn(),
  focus: vi.fn(),
  onInput: (_: string) => {},
}));
vi.mock("../../lib/agent-dock", async () => ({
  agentDockApi: (await import("../../lib/agent-dock-mock")).mockDockApi,
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {};
    cols = 80;
    rows = 24;
    open() {}
    loadAddon() {}
    write = xterm.write;
    dispose = xterm.dispose;
    focus = xterm.focus;
    onData(cb: (data: string) => void) {
      xterm.onInput = cb;
      return { dispose: vi.fn() };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
afterEach(() => vi.restoreAllMocks());
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
