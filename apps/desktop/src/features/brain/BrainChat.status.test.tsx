import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  AgentDockEvent,
  AgentSessionView,
} from "../../lib/agent-dock-api";
import { mockDockApi, resetMockDock } from "../../lib/agent-dock-mock";
import { mockApi } from "../../lib/mock-bridge";
import { BrainChat } from "./BrainChat";
import { BrainProviderError } from "./BrainProviderError";
import { BrainSessionStatus, BrainStatusChip } from "./BrainSessionControls";
import { draftKey, useBrainState } from "./brain-store";

vi.mock("../../lib/agent-dock", async () => ({
  agentDockApi: (await import("../../lib/agent-dock-mock")).mockDockApi,
}));
let session: AgentSessionView;
let events: AgentDockEvent[];
beforeEach(async () => {
  vi.restoreAllMocks();
  resetMockDock();
  await mockApi.resetDemo();
  session = await mockDockApi.startSession({
    profileId: "claude-code",
    userConfig: "include",
  });
  events = await mockDockApi.history(session.id);
  events.push({
    sessionId: session.id,
    seq: 999,
    at: session.createdAt,
    kind: "usage",
    used: 42000,
    size: 200000,
    cost: { amount: 0.42, currency: "USD" },
  });
  useBrainState.setState({
    projectId: session.projectId,
    sessions: [session],
    events: { [session.id]: events },
    drafts: {},
    tab: "chat",
    selected: { chat: session.id, terminal: null },
  });
});
function mount(
  view = (
    <BrainChat session={session} restart={vi.fn()} connections={vi.fn()} />
  ),
) {
  const root = createRootRoute({ component: () => view });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
it("R8-C/BD02-BD06 chip shows context percentage with exact tokens and cumulative cost", async () => {
  mount(<BrainStatusChip events={events} open={vi.fn()} />);
  expect(
    await screen.findByRole("button", { name: "Session status: 21% context" }),
  ).toHaveAttribute("title", "42,000 / 200,000 tokens · 0.42 USD");
});
it("R8-C/BD02-BD06 status popover shows connection, model, access, global config, usage and started time", async () => {
  const start = vi.spyOn(mockDockApi, "startSession");
  mount(
    <BrainSessionStatus session={session} events={events} close={vi.fn()} />,
  );
  const status = await screen.findByRole("region", { name: "Session status" });
  for (const field of [
    "Connection",
    "Model",
    "Access mode",
    "Board MCP connected",
    "Global config",
    "Context usage",
    "Session started",
  ])
    expect(within(status).getByText(field)).toBeVisible();
  expect(
    within(status).getByText("42,000 / 200,000 tokens · 0.42 USD"),
  ).toBeVisible();
  expect(start).not.toHaveBeenCalled();
  expect(within(status).getByText("Plan limits: type /usage")).toBeVisible();
});
it("R8-C advertised usage sends only the exact command, retains staged context and renders the adapter reply", async () => {
  events.push({
    sessionId: session.id,
    seq: 1000,
    at: session.createdAt,
    kind: "available_commands",
    commands: [
      { name: "usage", description: "Plan usage" },
      { name: "status", description: "Status" },
    ],
  });
  const context = [
    {
      type: "board_ref" as const,
      uri: "jam://task/FB-1",
      label: "FB-1",
      text: "Retained context",
    },
  ];
  const attachments = [
    { id: "pending", name: "fixture.txt", size: 8, status: "copying" as const },
  ];
  useBrainState.setState({
    events: { [session.id]: events },
    drafts: { [draftKey()]: { text: "", context, attachments } },
  });
  const send = vi
    .spyOn(mockDockApi, "sendPrompt")
    .mockImplementation(async () => {
      useBrainState.getState().ingest({
        sessionId: session.id,
        seq: 1001,
        at: session.createdAt,
        kind: "agent_message_delta",
        messageId: "usage-reply",
        text: "### Plan usage\n5-hour limit: 25% used\n\nWeekly: 40% used · resets tomorrow",
      });
    });
  mount();
  const user = userEvent.setup();
  const input = await screen.findByRole("textbox", {
    name: "Message the brain",
  });
  await user.type(input, "/usage");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(send).toHaveBeenCalledExactlyOnceWith({
    sessionId: session.id,
    content: [{ type: "text", text: "/usage" }],
  });
  expect(await screen.findByText("5-hour limit: 25% used")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Session status" })).toBeNull();
  expect(useBrainState.getState().drafts[draftKey()]?.context).toEqual(context);
  expect(useBrainState.getState().drafts[draftKey()]?.attachments).toEqual(
    attachments,
  );
  await user.type(input, "/status{Enter}");
  expect(
    await screen.findByRole("region", { name: "Session status" }),
  ).toBeVisible();
  expect(send).toHaveBeenCalledTimes(1);
});
it("R8-C/BD02-BD06 unknown commands retain the draft and never reach the adapter", async () => {
  const send = vi.spyOn(mockDockApi, "sendPrompt");
  mount();
  const user = userEvent.setup();
  const input = await screen.findByRole("textbox", {
    name: "Message the brain",
  });
  await user.type(input, "/unsupported{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "/unsupported isn't available in chat — use Session status, or open a Terminal for Claude Code's built-in commands.",
  );
  expect(input).toHaveValue("/unsupported");
  expect(send).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "/status" })).toBeNull();
});
it("R8-C Codex uses its own unknown-command hint and session-scoped plan usage", async () => {
  session = { ...session, profileId: "codex", title: "Codex" };
  const send = vi.spyOn(mockDockApi, "sendPrompt");
  vi.spyOn(mockDockApi, "launchLogs").mockResolvedValue([
    {
      sessionId: session.id,
      seq: 0,
      at: session.createdAt,
      kind: "plan_usage",
      primary: { used_percent: 25, resets_at: 1793775556 },
      secondary: null,
    },
  ]);
  mount();
  const user = userEvent.setup();
  const input = await screen.findByRole("textbox", {
    name: "Message the brain",
  });
  await user.type(input, "/unsupported{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Terminal for Codex's built-in commands",
  );
  await user.clear(input);
  await user.type(input, "/usage{Enter}");
  expect(await screen.findByText(/Primary: 25% used/)).toBeVisible();
  expect(screen.getByText("Plan usage")).toBeVisible();
  expect(send).not.toHaveBeenCalled();
});
it("R8-C/BD02-BD06 local status and usage open the popover without a prompt or lost attachments", async () => {
  const send = vi.spyOn(mockDockApi, "sendPrompt");
  const context = [
    {
      type: "board_ref" as const,
      uri: "jam://task/FB-1",
      label: "FB-1",
      text: "Retained draft context",
    },
  ];
  const attachments = [
    {
      id: "pending-file",
      name: "fixture.txt",
      size: 8,
      status: "copying" as const,
    },
  ];
  useBrainState.setState({
    drafts: { [draftKey()]: { text: "", context, attachments } },
  });
  mount();
  const user = userEvent.setup();
  const input = await screen.findByRole("textbox", {
    name: "Message the brain",
  });
  await user.type(input, "/status{Enter}");
  expect(
    await screen.findByRole("region", { name: "Session status" }),
  ).toBeVisible();
  expect(input).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.type(input, "/usage{Enter}");
  await waitFor(() =>
    expect(screen.getByLabelText("Session usage")).toHaveFocus(),
  );
  expect(send).not.toHaveBeenCalled();
  expect(useBrainState.getState().drafts[draftKey()]?.context).toEqual(context);
  expect(useBrainState.getState().drafts[draftKey()]?.attachments).toEqual(
    attachments,
  );
});
it("R8-C startup timeout exposes logs and a session retry without turn retry", async () => {
  const restart = vi.fn().mockResolvedValue(undefined);
  const logs = vi.fn();
  const retry = vi.spyOn(mockDockApi, "retryTurn");
  mount(
    <BrainProviderError
      active
      event={{
        sessionId: session.id,
        seq: 1,
        at: session.createdAt,
        kind: "error",
        message:
          "Claude Code chat didn't start in time. Try again; if it keeps failing, open Logs.",
        detail: "ACP deadline",
      }}
      restart={restart}
      showLogs={logs}
    />,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Show logs" }));
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(logs).toHaveBeenCalledOnce();
  expect(restart).toHaveBeenCalledOnce();
  expect(retry).not.toHaveBeenCalled();
});
