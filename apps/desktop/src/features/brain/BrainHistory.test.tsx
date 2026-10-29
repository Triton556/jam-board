import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AgentSessionView, HistoryEntry } from "../../lib/agent-dock-api";
import { mockDockApi, resetMockDock } from "../../lib/agent-dock-mock";
import {
  mockPhase4Api,
  resetMockPhase4,
  seedMockHistory,
} from "../../lib/agent-dock-phase4-mock";
import { mockApi } from "../../lib/mock-bridge";
import { BrainHistory } from "./BrainHistory";
import { useBrainState } from "./brain-store";

vi.mock("../../lib/agent-dock", () => ({ agentDockApi: mockDockApi }));
vi.mock("../../lib/agent-dock-phase4", async (original) => ({
  ...(await original<typeof import("../../lib/agent-dock-phase4")>()),
  phase4Api: mockPhase4Api,
}));

let projectId = "";
const live = (status: AgentSessionView["status"]): AgentSessionView => ({
  id: "live-terminal",
  projectId,
  profileId: "claude-cli",
  kind: "terminal",
  title: "Terminal regression fixture",
  status,
  cwd: "C:\\work\\dotted.project",
  createdAt: new Date().toISOString(),
  model: null,
  effort: null,
  capabilities: {
    images: false,
    audio: false,
    embeddedContext: false,
    configOptions: false,
  },
});
const saved = (empty: boolean): HistoryEntry => ({
  id: "live-terminal",
  projectId,
  profileId: "claude-cli",
  profileLabel: "Claude Code",
  provider: { label: "Claude Code", agentKind: "claude" },
  kind: "terminal",
  title: "Terminal regression fixture",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  empty,
  model: "fixture-model",
  effort: null,
  agentSessionId: "fixture-session",
  resumable: empty ? "none" : "native",
  messageCount: empty ? 0 : 2,
});

beforeEach(async () => {
  vi.restoreAllMocks();
  resetMockDock();
  resetMockPhase4();
  await mockApi.resetDemo();
  projectId = (await mockApi.appState()).jam?.id ?? "";
  useBrainState.setState({
    projectId,
    sessions: [],
    selected: { chat: null, terminal: null },
    tab: "history",
    events: {},
    drafts: {},
  });
});

function mount() {
  const open = vi.fn();
  const resumed = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BrainHistory open={open} resumed={resumed} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
  return { open, resumed };
}

it.each(["starting", "running"] as const)(
  "BC13 R8-H shows %s terminal immediately before history responds and focuses it without resume",
  async (status) => {
    vi.spyOn(mockPhase4Api, "history").mockImplementation(
      () => new Promise(() => {}),
    );
    const resume = vi.spyOn(mockPhase4Api, "resume");
    const start = vi.spyOn(mockDockApi, "startSession");
    useBrainState.setState({ sessions: [live(status)] });
    const { open, resumed } = mount();
    expect(screen.getByText("Running")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Terminal regression fixture" }),
    );
    await waitFor(() => expect(resumed).toHaveBeenCalledOnce());
    expect(useBrainState.getState().selected.terminal).toBe("live-terminal");
    expect(useBrainState.getState().tab).toBe("terminal");
    expect(open).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  },
);

it("BC13 R8-H transitions from live empty history to stopped resumable transcript", async () => {
  seedMockHistory([saved(true)]);
  useBrainState.setState({ sessions: [live("running")] });
  const { open } = mount();
  await screen.findByText("Running");
  seedMockHistory([saved(false)]);
  act(() => useBrainState.setState({ sessions: [live("stopped")] }));
  await screen.findByRole("button", { name: "Resume" });
  expect(screen.queryByText("Running")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Open Terminal regression fixture" }),
  );
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ empty: false, resumable: "native" }),
  );
});

it("BC13 R8-H hides ended empty terminals and excludes other projects", async () => {
  seedMockHistory([saved(true)]);
  useBrainState.setState({
    sessions: [
      live("stopped"),
      { ...live("running"), id: "foreign", projectId: "project-b" },
    ],
  });
  mount();
  await screen.findByText(/No terminal history yet/);
  expect(
    screen.queryByRole("button", { name: "Open Terminal regression fixture" }),
  ).toBeNull();
  expect(screen.queryByText("Running")).toBeNull();
});

it("BC13 R8-H keeps linked live transcripts on the existing tab and hides an unlinked terminal on exit", async () => {
  seedMockHistory([saved(false)]);
  useBrainState.setState({ sessions: [live("running")] });
  mount();
  await screen.findByText("fixture-model", { exact: false });
  expect(screen.getByText("Running")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  // No user transcript was linked when this terminal actually ended.
  seedMockHistory([saved(true)]);
  act(() => useBrainState.setState({ sessions: [live("stopped")] }));
  await screen.findByText(/No terminal history yet/);
  expect(screen.queryByText("Running")).toBeNull();
});
