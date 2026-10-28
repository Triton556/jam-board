import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { agentDockApi } from "../../lib/agent-dock";
import type { AgentSessionView } from "../../lib/agent-dock-api";
import { BrainLaunchLogs, BrainLaunchSteps } from "./BrainLaunchLogs";
import { BrainProviderError } from "./BrainProviderError";
import { SessionControls } from "./BrainSessionControls";
import { BrainSessionPicker, sessionFolder } from "./BrainSessionPicker";
import {
  type LimitErrorEvent,
  providerErrorTitle,
  usageLimit,
  usageResetTime,
} from "./brain-retry";
import { accessLabel } from "./brain-settings";
import { setTerminalTitle, useBrainState } from "./brain-store";

const session: AgentSessionView = {
  id: "one",
  profileId: "claude-code",
  projectId: "project",
  kind: "terminal",
  title: "Claude CLI",
  status: "ready",
  cwd: "C:/work/fictional-project",
  createdAt: "2026-10-28T04:12:00Z",
  capabilities: {
    images: false,
    audio: false,
    embeddedContext: true,
    configOptions: true,
  },
};
const limit: LimitErrorEvent = {
  kind: "error",
  sessionId: "one",
  seq: 2,
  at: session.createdAt,
  code: "agent",
  retryable: true,
  message:
    "You've hit your usage limit. Please try again at Nov 2nd, 2026 4:27 PM.",
  data: { codexErrorInfo: "usageLimitExceeded" },
};
beforeEach(() => {
  vi.restoreAllMocks();
  useBrainState.setState({
    projectId: "project",
    sessions: [session],
    events: {},
    terminalTitles: {},
    hiddenSessions: {},
    selected: { chat: null, terminal: "one" },
  });
});
it("B10/W5 gives each provider distinct access labels and the requested full-auto copy", () => {
  for (const [kind, values, expected] of [
    [
      "claude",
      ["default", "acceptEdits", "plan", "auto", "bypassPermissions"],
      [
        "Ask first",
        "Auto-edit files",
        "Plan only",
        "Auto (Claude decides)",
        "Full auto",
      ],
    ],
    [
      "codex",
      ["read-only", "auto", "full-access"],
      ["Read only", "Work in project", "Full auto"],
    ],
  ] as const) {
    const labels = values.map(
      (value) => accessLabel({ value, name: value }, kind).label,
    );
    expect(labels).toEqual(expected);
    expect(new Set(labels).size).toBe(values.length);
    expect(
      accessLabel({ value: values.at(-1) ?? "", name: "" }, kind).description,
    ).toBe(
      "Runs commands and edits files without asking. Use only in a folder you can afford to lose.",
    );
  }
});
it("B10 labels the live Claude menu using its connection identity", async () => {
  vi.spyOn(agentDockApi, "profiles").mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionControls
        session={{ ...session, kind: "acp" }}
        options={[
          {
            id: "mode",
            category: "mode",
            name: "Access",
            value: "default",
            values: ["default", "auto"].map((value) => ({
              value,
              name: value,
            })),
          },
        ]}
        disabled={false}
        fail={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Access: Ask first" }));
  expect(screen.getByText("Auto (Claude decides)")).toBeVisible();
  expect(screen.getAllByText("Ask first")).toHaveLength(2);
});
it("B9 parses ordinal reset dates and suppresses Retry even for a failed retryable turn", () => {
  expect(usageLimit(limit)?.reset).toEqual(new Date(2026, 10, 2, 16, 27));
  expect(providerErrorTitle(limit)).toBe(
    `Usage limit reached — resets ${usageResetTime(new Date(2026, 10, 2, 16, 27))}`,
  );
  const change = vi.fn();
  render(
    <BrainProviderError
      event={limit}
      active
      failedTurn
      ready
      connections={change}
    />,
  );
  expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Switch connection" }));
  expect(change).toHaveBeenCalledOnce();
});
it("B9 handles structured-only limits, unknown reset dates and Claude limit messages without treating a short rate limit as usage exhaustion", () => {
  expect(usageLimit({ ...limit, message: "Try later" })).toEqual({
    reset: null,
  });
  expect(
    usageLimit({
      ...limit,
      data: undefined,
      message: "You've hit your limit · resets 5pm",
    }),
  ).toEqual({ reset: null });
  expect(
    usageLimit({
      ...limit,
      data: undefined,
      message: "Usage limit reached. Try again at not-a-date.",
    }),
  ).toEqual({ reset: null });
  expect(
    usageLimit({
      ...limit,
      data: undefined,
      code: "rate_limited",
      message: "Too many requests",
    }),
  ).toBeNull();
});
it("B1 keeps OSC titles in the store and clears only stopped picker rows while retaining sessions and drafts", () => {
  const stopped = { ...session, id: "two", status: "stopped" as const };
  useBrainState.setState({
    sessions: [session, stopped],
    drafts: { "project:two": { text: "Retain", context: [] } },
  });
  setTerminalTitle("one", "Review dock UX");
  const choose = vi.fn();
  render(
    <BrainSessionPicker
      sessions={[session, stopped]}
      selected="one"
      choose={choose}
    />,
  );
  expect(screen.getByText("Review dock UX")).toBeVisible();
  expect(screen.getByLabelText("Current session")).toBeVisible();
  expect(
    screen.getAllByText(/started \d\d:\d\d · fictional-project/),
  ).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Clear stopped" }));
  expect(screen.queryByRole("region", { name: "Stopped" })).toBeNull();
  expect(useBrainState.getState().sessions).toHaveLength(2);
  expect(useBrainState.getState().drafts["project:two"]?.text).toBe("Retain");
});
it("B1 names a chat from its first human prompt and keeps it on later turns", () => {
  useBrainState.setState({
    sessions: [{ ...session, kind: "acp", title: "Claude Code" }],
  });
  useBrainState.getState().ingest({
    kind: "user_message",
    sessionId: "one",
    seq: 1,
    at: session.createdAt,
    messageId: "u",
    content: [{ type: "text", text: "Review the release" }],
  });
  useBrainState.getState().ingest({
    kind: "user_message",
    sessionId: "one",
    seq: 2,
    at: session.createdAt,
    messageId: "u2",
    content: [{ type: "text", text: "Next turn" }],
  });
  expect(useBrainState.getState().sessions[0]?.title).toBe(
    "Review the release",
  );
});
it("B1 preserves an existing backend chat title when replaying its first human message", () => {
  useBrainState.setState({
    sessions: [{ ...session, kind: "acp", title: "Renamed review" }],
  });
  useBrainState.getState().ingest({
    kind: "user_message",
    sessionId: "one",
    seq: 1,
    at: session.createdAt,
    messageId: "old",
    content: [{ type: "text", text: "Original request" }],
  });
  expect(useBrainState.getState().sessions[0]?.title).toBe("Renamed review");
});
it("B7 renders real launch-step states and a readable timeline", () => {
  const events = (["ok", "failed", "skipped", "running"] as const).map(
    (state, seq) => ({
      kind: "launch_step" as const,
      sessionId: "one",
      seq,
      at: session.createdAt,
      step: state,
      state,
      message: state === "failed" ? "MCP failed" : `Step ${state}`,
      startedAt: session.createdAt,
      endedAt: null,
    }),
  );
  const view = render(<BrainLaunchSteps events={events} />);
  expect(screen.getByRole("log")).toHaveTextContent("FailedMCP failed");
  expect(screen.getByRole("log")).toHaveTextContent("SkippedStep skipped");
  expect(screen.getByRole("log")).toHaveTextContent("RunningStep running");
  view.unmount();
  const close = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrainLaunchLogs title="Review" events={events} close={close} />
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole("log", { name: "Launch timeline" }),
  ).toHaveTextContent("MCP failed");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.keyDown(screen.getByRole("log", { name: "Launch timeline" }), {
    key: "Escape",
  });
  expect(close).toHaveBeenCalledOnce();
});
it("I1-R2 displays the cwd folder, retains its full-path tooltip and never prints a session ID", () => {
  const id = "626343be-139a-4e20-8bbf-111111111111";
  const cwd = "C:\\work\\cozy-jam\\";
  render(
    <BrainSessionPicker
      sessions={[{ ...session, id, cwd }]}
      selected={id}
      choose={vi.fn()}
    />,
  );
  const metadata = screen.getByText(/ready · started \d\d:\d\d · cozy-jam/);
  expect(metadata).toHaveAttribute("title", cwd);
  expect(metadata).not.toHaveTextContent(id);
  expect(sessionFolder("/home/fixture/Проект/")).toBe("Проект");
  expect(sessionFolder(`agent-workspace/${id}`)).toBe("Project workspace");
});
it("I1-R3 reset dates use a short month and minute precision, adding the year only across years", () => {
  const now = new Date(2026, 9, 28);
  expect(usageResetTime(new Date(2026, 10, 2, 16, 27, 55), now, "en-GB")).toBe(
    "2 Nov, 16:27",
  );
  expect(usageResetTime(new Date(2027, 10, 2, 16, 27, 55), now, "en-GB")).toBe(
    "2 Nov 2027, 16:27",
  );
  expect(usageResetTime(new Date(2026, 10, 2, 16, 27, 55), now, "en-US")).toBe(
    "Nov 2, 04:27 PM",
  );
});
it("I1-R1 copies the visible timeline events as JSON and keeps reader scroll position on append", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const events: [
    Extract<
      import("../../lib/agent-dock-api").AgentDockEvent,
      { kind: "launch_log" }
    >,
  ] = [
    {
      kind: "launch_log" as const,
      sessionId: "one",
      seq: 1,
      at: session.createdAt,
      message: "adapter stderr line",
    },
  ];
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <BrainLaunchLogs title="Review" events={events} close={vi.fn()} />
    </QueryClientProvider>,
  );
  const timeline = screen.getByRole("log", { name: "Launch timeline" });
  expect(screen.getByText("adapter stderr line").tagName).toBe("PRE");
  expect(timeline.querySelector("time")).toHaveTextContent(/^\d\d:\d\d:\d\d$/);
  fireEvent.click(screen.getByRole("button", { name: "Copy raw" }));
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify(events, null, 2),
    ),
  );
  Object.defineProperties(timeline, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 200 },
  });
  timeline.scrollTop = 100;
  fireEvent.scroll(timeline);
  const next = [...events, { ...events[0], seq: 2, message: "next line" }];
  view.rerender(
    <QueryClientProvider client={client}>
      <BrainLaunchLogs title="Review" events={next} close={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(timeline.scrollTop).toBe(100);
  timeline.scrollTop = 800;
  fireEvent.scroll(timeline);
  view.rerender(
    <QueryClientProvider client={client}>
      <BrainLaunchLogs
        title="Review"
        events={[...next, { ...events[0], seq: 3 }]}
        close={vi.fn()}
      />
    </QueryClientProvider>,
  );
  expect(timeline.scrollTop).toBe(1000);
});
