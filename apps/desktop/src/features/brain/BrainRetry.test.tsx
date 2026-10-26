import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  AgentDockEvent,
  ProviderErrorCode,
} from "../../lib/agent-dock-api";
import { mockDockApi, resetMockDock } from "../../lib/agent-dock-mock";
import { seedMockHistory } from "../../lib/agent-dock-phase4-mock";
import { setMockProviderScenario } from "../../lib/agent-dock-retry-mock";
import { mockApi } from "../../lib/mock-bridge";
import { BrainChat } from "./BrainChat";
import { BrainButton } from "./BrainDockShell";
import { HistoryTranscript } from "./BrainHistory";
import { BrainProviderError } from "./BrainProviderError";
import { connectBrain } from "./brain-controller";
import { activeRetry, latestTurnError } from "./brain-retry";
import { useBrainState } from "./brain-store";

vi.mock("../../lib/agent-dock", async () => ({
  agentDockApi: (await import("../../lib/agent-dock-mock")).mockDockApi,
}));
vi.mock("../../lib/agent-dock-phase4", async (original) => ({
  ...(await original<typeof import("../../lib/agent-dock-phase4")>()),
  phase4Api: (await import("../../lib/agent-dock-phase4-mock")).mockPhase4Api,
}));
vi.mock("./BrainVoiceInput", () => ({ BrainVoiceInput: () => null }));
let projectId = "",
  sessionId = "";
const recovery = {
  restart: vi.fn(async () => {}),
  connections: vi.fn(),
  signIn: vi.fn(async () => {}),
  editConnection: vi.fn(),
};
function event(payload: Record<string, unknown>, seq = 10): AgentDockEvent {
  return {
    sessionId,
    seq,
    at: new Date().toISOString(),
    ...payload,
  } as AgentDockEvent;
}
function errorEvent(code: ProviderErrorCode | null = "overloaded", extra = {}) {
  return event({
    kind: "error",
    code,
    message: "Fictional provider response",
    retryable: true,
    retryAfterMs: null,
    ...extra,
  }) as Extract<AgentDockEvent, { kind: "error" }>;
}
function inject(payload: Record<string, unknown>) {
  const seq =
    (useBrainState.getState().events[sessionId]?.at(-1)?.seq ?? 0) + 1;
  useBrainState.getState().ingest(event(payload, seq));
}
function ChatHarness({ apiKeyAccess = true }: { apiKeyAccess?: boolean }) {
  const session = useBrainState((state) =>
    state.sessions.find((s) => s.id === sessionId),
  );
  useEffect(() => connectBrain(projectId), []);
  return (
    <>
      <BrainButton />
      {session && (
        <BrainChat
          session={session}
          {...recovery}
          apiKeyAccess={apiKeyAccess}
        />
      )}
    </>
  );
}
function mountChat(apiKeyAccess = true) {
  const root = createRootRoute({
    component: () => <ChatHarness apiKeyAccess={apiKeyAccess} />,
  });
  const route = createRoute({ getParentRoute: () => root, path: "/board" });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/board"] }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubEnv("VITE_MOCK_BRIDGE", "1");
  resetMockDock();
  await mockApi.resetDemo();
  projectId = (await mockApi.appState()).jam?.id ?? "";
  const session = await mockDockApi.startSession({ profileId: "claude-code" });
  sessionId = session.id;
  useBrainState.setState({
    projectId,
    sessions: [session],
    events: {},
    activity: null,
    selected: { chat: sessionId, terminal: null },
    drafts: {},
    configuring: {},
  });
});
it.each([
  ["overloaded", "The model is busy right now"],
  ["rate_limited", "Rate limit reached"],
  ["auth", "Check the API key or sign in"],
  ["context_too_long", "The conversation is too long for this model"],
  ["network", "Can't reach the provider"],
  ["provider", "The provider returned an error"],
  ["agent", "The agent ran into a problem"],
] as const)(
  "R6-E01 %s has a plain title and initially collapsed provider Details",
  (code, title) => {
    render(
      <BrainProviderError event={errorEvent(code)} active failedTurn ready />,
    );
    expect(screen.getByRole("alert", { name: title })).toBeVisible();
    const details = screen.getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Details"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Fictional provider response")).toBeVisible();
  },
);
it("R6-E02 Retry honors Retry-After across remount, never auto-sends and guards duplicate clicks", async () => {
  vi.useFakeTimers();
  const error = errorEvent("rate_limited", { retryAfterMs: 6000 });
  const retry = vi.spyOn(mockDockApi, "retryTurn").mockResolvedValue(),
    send = vi.spyOn(mockDockApi, "sendPrompt");
  const view = render(
    <BrainProviderError event={error} active failedTurn ready />,
  );
  expect(screen.getByRole("button", { name: "Retry in 6 s" })).toBeDisabled();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  view.unmount();
  render(<BrainProviderError event={error} active failedTurn ready />);
  expect(screen.getByRole("button", { name: "Retry in 4 s" })).toBeDisabled();
  await act(() => vi.advanceTimersByTimeAsync(4000));
  const button = screen.getByRole("button", { name: "Retry" });
  expect(retry).not.toHaveBeenCalled();
  fireEvent.click(button);
  fireEvent.click(button);
  await act(async () => {});
  expect(retry).toHaveBeenCalledExactlyOnceWith(sessionId);
  expect(send).not.toHaveBeenCalled();
});
it("R6-E03 nonretryable failed requests can retry after a model/key fix; non-turn errors cannot", () => {
  const error = errorEvent("context_too_long", { retryable: false });
  const view = render(<BrainProviderError event={error} active ready />);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  view.rerender(<BrainProviderError event={error} active ready failedTurn />);
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  view.rerender(
    <BrainProviderError
      event={errorEvent("network", { retryable: true })}
      active
      ready
    />,
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});
it("R6-E04 a failed Retry command preserves recovery and shows its error", async () => {
  vi.spyOn(mockDockApi, "retryTurn").mockRejectedValueOnce(
    Error("Wait for the current turn to finish."),
  );
  render(<BrainProviderError event={errorEvent()} active failedTurn ready />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("Wait for the current turn to finish."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});
it("R6-E05 only the latest failed turn offers actions; a fresh send or resumed request retires them", () => {
  const user = event(
      {
        kind: "user_message",
        messageId: "u",
        content: [{ type: "text", text: "Original" }],
      },
      1,
    ),
    error = errorEvent(),
    second = { ...errorEvent(), seq: 11 };
  expect(latestTurnError([user, error, second])?.error).toBe(second);
  expect(
    latestTurnError([
      user,
      error,
      event({ kind: "status", status: "running" }, 12),
    ]),
  ).toBeNull();
  expect(
    latestTurnError([
      user,
      error,
      event({ kind: "user_message", messageId: "new", content: [] }, 12),
    ]),
  ).toBeNull();
  expect(
    latestTurnError([
      user,
      event({ kind: "turn_end", stopReason: "end_turn" }, 2),
      error,
    ])?.failedTurn,
  ).toBe(false);
  render(<BrainProviderError event={error} />);
  expect(
    screen.getByText("The model is busy right now").closest("details"),
  ).not.toHaveAttribute("open");
  expect(screen.queryByRole("button")).toBeNull();
});
it.each(["overloaded", "rate_limited", "context_too_long"] as const)(
  "R6-E06 %s Switch model opens the actual Model · Effort surface without resending",
  async (code) => {
    mountChat();
    await screen.findByRole("textbox", { name: "Message the brain" });
    await screen.findByRole("button", { name: /Model and effort:/ });
    const send = vi.spyOn(mockDockApi, "sendPrompt");
    act(() => {
      inject({
        kind: "user_message",
        messageId: "u",
        content: [{ type: "text", text: "Original" }],
      });
      inject({ kind: "error", code, message: "capacity", retryable: false });
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch model" }));
    expect(
      await screen.findByRole("region", { name: "Model and effort" }),
    ).toBeVisible();
    expect(send).not.toHaveBeenCalled();
  },
);
it.each([true, false])(
  "R6-E07 auth offers the existing recovery card (API key access: %s)",
  async (apiKeyAccess) => {
    mountChat(apiKeyAccess);
    await screen.findByRole("textbox", { name: "Message the brain" });
    act(() =>
      inject({
        kind: "error",
        code: "auth",
        message: "401 rejected",
        retryable: false,
      }),
    );
    expect(document.querySelector(".brain-auth p")).toHaveTextContent(
      "Check the API key or sign in",
    );
    if (apiKeyAccess) {
      fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
      expect(recovery.editConnection).toHaveBeenCalled();
    } else {
      fireEvent.click(
        screen.getByRole("button", { name: "Sign in with the CLI" }),
      );
      expect(recovery.signIn).toHaveBeenCalled();
    }
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    act(() => inject({ kind: "auth", state: "ok", label: "Signed in" }));
    expect(document.querySelector(".brain-auth")).toBeNull();
  },
);
it("R6-E08 history replays error cards with no Retry, Switch model or auth actions", async () => {
  const error = errorEvent("auth"),
    entry = {
      id: "past",
      projectId,
      profileId: "claude-code",
      profileLabel: "Claude Code",
      kind: "acp" as const,
      title: "Past failed turn",
      createdAt: error.at,
      updatedAt: error.at,
      model: null,
      effort: null,
      agentSessionId: null,
      resumable: "none" as const,
      messageCount: 1,
    };
  seedMockHistory([entry], { past: [error] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <HistoryTranscript entry={entry} close={vi.fn()} resumed={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(
    (await screen.findByText("Check the API key or sign in")).closest(
      "details",
    ),
  ).not.toHaveAttribute("open");
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add API key" })).toBeNull();
});
it.each(["auto-success", "auto-exhausted"] as const)(
  "R6-E09 %s counts both backoffs, keeps Brain working, then settles",
  async (scenario) => {
    mountChat();
    await screen.findByRole("textbox", { name: "Message the brain" });
    setMockProviderScenario(sessionId, scenario);
    vi.useFakeTimers();
    await act(() =>
      mockDockApi.sendPrompt({
        sessionId,
        content: [{ type: "text", text: "Original" }],
      }),
    );
    expect(screen.getByText("Retrying in 2 s (2/3)…")).toBeVisible();
    expect(screen.getByRole("status", { name: "Brain working" })).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText("Retrying in 6 s (3/3)…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(screen.queryByText(/^Retrying in/)).toBeNull();
    expect(screen.queryByRole("status", { name: "Brain working" })).toBeNull();
    if (scenario === "auto-success")
      expect(screen.getByText(/The provider is available again/)).toBeVisible();
    else {
      expect(
        screen.getByRole("alert", { name: "The model is busy right now" }),
      ).toBeVisible();
      expect(screen.queryByText("error", { exact: true })).toBeNull();
    }
  },
);
it("R6-E10 Stop during auto-retry cancels the wait and never emits a later success", async () => {
  mountChat();
  await screen.findByRole("textbox", { name: "Message the brain" });
  setMockProviderScenario(sessionId, "auto-success");
  vi.useFakeTimers();
  await act(() =>
    mockDockApi.sendPrompt({
      sessionId,
      content: [{ type: "text", text: "Original" }],
    }),
  );
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  });
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(screen.queryByText(/^Retrying in/)).toBeNull();
  expect(screen.queryByText(/The provider is available again/)).toBeNull();
  expect(
    (await mockDockApi.history(sessionId)).some(
      (e) => e.kind === "turn_end" && e.stopReason === "cancelled",
    ),
  ).toBe(true);
});
it.each([
  "overloaded",
  "rate_limited",
  "auth",
  "context_too_long",
  "network",
] as const)(
  "R6-E11 mock %s supplies metadata and retains the original prompt",
  async (scenario) => {
    setMockProviderScenario(sessionId, scenario);
    const content = [
      { type: "text" as const, text: "Original request" },
      {
        type: "board_ref" as const,
        uri: "jam://task/JB-12",
        label: "JB-12",
        text: "Original context",
      },
    ];
    await mockDockApi.sendPrompt({ sessionId, content });
    await Promise.resolve();
    const history = await mockDockApi.history(sessionId),
      error = history.filter((e) => e.kind === "error").at(-1);
    expect(error).toMatchObject({
      code: scenario,
      retryable: ["overloaded", "rate_limited", "network"].includes(scenario),
      retryAfterMs: scenario === "rate_limited" ? 6000 : null,
    });
    expect(
      history.filter((e) => e.kind === "user_message").at(-1),
    ).toMatchObject({ content });
    expect(activeRetry(history, "ready")).toBeNull();
  },
);
it("R6-E13 manual retry retains attachments/context without a duplicate user event and cannot retry a stopped attempt", async () => {
  const attachment = await mockDockApi.addAttachment({
    sessionId,
    source: { kind: "path", path: "C:/fixture.txt" },
  });
  const content = [
    { type: "text" as const, text: "Original request" },
    {
      type: "board_ref" as const,
      uri: "jam://task/JB-12",
      label: "JB-12",
      text: "Original context",
    },
    { type: "attachment" as const, attachmentId: attachment.id },
  ];
  setMockProviderScenario(sessionId, "overloaded");
  await mockDockApi.sendPrompt({ sessionId, content });
  const original = (await mockDockApi.history(sessionId)).find(
    (event) => event.kind === "user_message",
  );
  await mockDockApi.retryTurn(sessionId);
  await mockDockApi.cancelTurn(sessionId);
  expect(
    (await mockDockApi.history(sessionId)).filter(
      (event) => event.kind === "user_message",
    ),
  ).toEqual([original]);
  expect(original).toMatchObject({
    content,
    contextPreamble: expect.stringContaining(projectId),
  });
  await expect(mockDockApi.retryTurn(sessionId)).rejects.toThrow(
    "There is no failed turn to retry.",
  );
});
it("R6-E14 transcript collapses an older failed turn and removes actions immediately on a new send", async () => {
  mountChat();
  await screen.findByRole("textbox", { name: "Message the brain" });
  setMockProviderScenario(sessionId, "overloaded");
  await act(() =>
    mockDockApi.sendPrompt({
      sessionId,
      content: [{ type: "text", text: "First" }],
    }),
  );
  setMockProviderScenario(sessionId, "network");
  await act(() =>
    mockDockApi.sendPrompt({
      sessionId,
      content: [{ type: "text", text: "Second" }],
    }),
  );
  expect(
    screen.getByText("The model is busy right now").closest("details"),
  ).not.toHaveAttribute("open");
  expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  setMockProviderScenario(sessionId, "normal");
  await act(() =>
    mockDockApi.sendPrompt({
      sessionId,
      content: [{ type: "text", text: "Third" }],
    }),
  );
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await act(() => mockDockApi.cancelTurn(sessionId));
});
