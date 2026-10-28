import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  AgentDockEvent,
  HistoryEntry,
  McpServer,
} from "../../lib/agent-dock-api";
import { mockDockApi, resetMockDock } from "../../lib/agent-dock-mock";
import {
  mockPhase4Api,
  resetMockPhase4,
  seedMockHistory,
  setMockWebFailure,
} from "../../lib/agent-dock-phase4-mock";
import { mockVoiceApi, setMockVoice } from "../../lib/agent-dock-voice-mock";
import { mockApi } from "../../lib/mock-bridge";
import { BrainAgentSettings } from "./BrainAgentSettings";
import { ConnectionEditor } from "./BrainConnectionsPanel";
import {
  activateHistory,
  BrainHistory,
  HistoryTranscript,
  historyGroup,
  historyTranscriptRows,
} from "./BrainHistory";
import { BrainTools } from "./BrainTools";
import { BrainVoiceSettings } from "./BrainVoiceSettings";
import { useBrainState } from "./brain-store";
import { refreshVoice, useVoiceState, voiceStatusLine } from "./voice-store";

vi.mock("../../lib/agent-dock", () => ({ agentDockApi: mockDockApi }));
vi.mock("../../lib/agent-dock-phase4", async (original) => ({
  ...(await original<typeof import("../../lib/agent-dock-phase4")>()),
  phase4Api: (await import("../../lib/agent-dock-phase4-mock")).mockPhase4Api,
}));
vi.mock("../../lib/agent-dock-voice", () => ({ voiceApi: mockVoiceApi }));
let projectId = "";
const entry = (
  resumable: HistoryEntry["resumable"] = "native",
): HistoryEntry => ({
  id: `entry-${resumable}`,
  projectId,
  profileId: "claude-code",
  profileLabel: "Claude Code",
  kind: "chat",
  provider: { label: "Claude Code", agentKind: "claude" },
  empty: false,
  title: `${resumable} conversation`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  model: "fixture-model",
  effort: null,
  agentSessionId: null,
  resumable,
  messageCount: 2,
});
const events = (): AgentDockEvent[] => [
  {
    sessionId: "old",
    seq: 1,
    at: "2026-10-26",
    kind: "user_message",
    messageId: "u",
    content: [{ type: "text", text: "Review the board" }],
  },
  {
    sessionId: "old",
    seq: 2,
    at: "2026-10-26",
    kind: "agent_message_delta",
    messageId: "a",
    text: "Agree on ",
  },
  {
    sessionId: "old",
    seq: 3,
    at: "2026-10-26",
    kind: "agent_message_delta",
    messageId: "a",
    text: "the next step.",
  },
];
function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}
function historyMenu(index = 0) {
  fireEvent.click(
    screen.getAllByRole("button", { name: /^History actions for / })[
      index
    ] as HTMLElement,
  );
}
async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: option }));
}
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.stubEnv("VITE_MOCK_BRIDGE", "1");
  resetMockDock();
  await mockDockApi.saveUserConfigDefault("include");
  resetMockPhase4();
  await mockApi.resetDemo();
  projectId = (await mockApi.appState()).jam?.id ?? "";
  useBrainState.setState({
    projectId,
    sessions: [],
    events: {},
    selected: { chat: null, terminal: null },
    tab: "chat",
    drafts: {},
  });
  useVoiceState.setState({
    status: null,
    error: "",
    busy: false,
    progress: null,
  });
  setMockVoice();
});
it("R6-H01 groups at local midnight and Monday, including older conversations", () => {
  const now = new Date(2026, 9, 28, 12);
  expect(historyGroup(new Date(2026, 9, 28, 1).toISOString(), now)).toBe(
    "Today",
  );
  expect(historyGroup(new Date(2026, 9, 26, 1).toISOString(), now)).toBe(
    "This week",
  );
  expect(historyGroup(new Date(2026, 9, 25, 23).toISOString(), now)).toBe(
    "Older",
  );
});
it("R6-H02 searches, renames inline and opens a transcript without launching", async () => {
  const selected = entry();
  seedMockHistory([selected], { [selected.id]: events() });
  const open = vi.fn(),
    start = vi.spyOn(mockDockApi, "startSession");
  mount(<BrainHistory open={open} resumed={vi.fn()} />);
  expect(await screen.findByText("native conversation")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
    target: { value: "no match" },
  });
  expect(await screen.findByText("No chat history found")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
    target: { value: "" },
  });
  await screen.findByText("native conversation");
  historyMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  fireEvent.change(screen.getByRole("textbox", { name: "History title" }), {
    target: { value: "Renamed conversation" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save title" }));
  await screen.findByText("Renamed conversation");
  fireEvent.click(screen.getByRole("button", { name: /^Open / }));
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Renamed conversation" }),
  );
  expect(start).not.toHaveBeenCalled();
});
it("R6-H03 Delete offers undo before dispatch and survives picker unmount", async () => {
  const selected = entry();
  seedMockHistory([selected]);
  const remove = vi.spyOn(mockPhase4Api, "delete");
  const view = mount(<BrainHistory open={vi.fn()} resumed={vi.fn()} />);
  await screen.findByText(selected.title);
  historyMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(remove).not.toHaveBeenCalled();
  const deleted = screen.getByRole("status", {
    name: `Deleted ${selected.title}`,
  });
  expect(within(deleted).getByRole("button", { name: "Undo" })).toBeVisible();
  expect(screen.getByRole("region", { name: "History" })).toContainElement(
    deleted,
  );
  expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
  view.unmount();
  mount(<BrainHistory open={vi.fn()} resumed={vi.fn()} />);
  await screen.findByRole("button", { name: "Undo" });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByText(selected.title)).toBeVisible();
  view.unmount();
});
it.each(["native", "transcript"] as const)(
  "R6-H04 %s Resume restores transcript and never sends",
  async (kind) => {
    const selected = entry(kind);
    seedMockHistory([selected], { [selected.id]: events() });
    const send = vi.spyOn(mockDockApi, "sendPrompt");
    await activateHistory(selected);
    const state = useBrainState.getState(),
      id = state.selected.chat ?? "";
    expect(state.sessions[0]?.projectId).toBe(projectId);
    expect(state.events[id]?.some((e) => e.kind === "user_message")).toBe(true);
    expect(
      state.events[id]?.some(
        (e) => e.kind === "status" && e.message?.startsWith("Resumed "),
      ),
    ).toBe(true);
    expect(send).not.toHaveBeenCalled();
  },
);
it("R6-H05 read-only Open aggregates deltas; Continue stages an editable summary without sending", async () => {
  const selected = entry("none");
  seedMockHistory([selected], { [selected.id]: events() });
  const start = vi.spyOn(mockDockApi, "startSession"),
    send = vi.spyOn(mockDockApi, "sendPrompt");
  mount(
    <HistoryTranscript entry={selected} close={vi.fn()} resumed={vi.fn()} />,
  );
  expect(await screen.findByText("Agree on the next step.")).toBeVisible();
  expect(start).not.toHaveBeenCalled();
  expect(historyTranscriptRows(events())).toHaveLength(2);
  fireEvent.click(
    screen.getByRole("button", { name: "Continue in a new session" }),
  );
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(Object.values(useBrainState.getState().drafts)[0]?.text).toContain(
      "Agree on the next step.",
    ),
  );
  expect(send).not.toHaveBeenCalled();
});
it("R6-H06 project A→B→A while starting cannot replace the current selection", async () => {
  const selected = entry();
  seedMockHistory([selected]);
  let release!: (
    value: Awaited<ReturnType<typeof mockDockApi.startSession>>,
  ) => void;
  const session = await mockDockApi.startSession({ profileId: "claude-code" });
  vi.spyOn(mockPhase4Api, "resume").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const action = activateHistory(selected);
  useBrainState.setState({ projectId: "other" });
  useBrainState.setState({ projectId });
  release(session);
  await action;
  expect(useBrainState.getState().selected.chat).toBeNull();
});
it("R6-H08 pending deletion survives picker unmount, commits once, and cancels on a project switch", async () => {
  const first = entry(),
    second = { ...entry(), id: "second-entry", title: "Another conversation" };
  seedMockHistory([first, second]);
  const remove = vi.spyOn(mockPhase4Api, "delete");
  const view = mount(<BrainHistory open={vi.fn()} resumed={vi.fn()} />);
  await screen.findByText(first.title);
  vi.useFakeTimers();
  historyMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(8000));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(await mockPhase4Api.history()).toHaveLength(1);
  vi.useRealTimers();
  mount(<BrainHistory open={vi.fn()} resumed={vi.fn()} />);
  await screen.findByRole("button", { name: /^History actions for / });
  vi.useFakeTimers();
  historyMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  act(() => {
    useBrainState.setState({ projectId: "other" });
    useBrainState.setState({ projectId });
  });
  await act(() => vi.advanceTimersByTimeAsync(8000));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(await mockPhase4Api.history()).toHaveLength(1);
});
it("R6-H09 mock retention records new chat events; disabling or clearing does not recreate files", async () => {
  seedMockHistory([]);
  const session = await mockDockApi.startSession({ profileId: "claude-code" });
  expect(await mockPhase4Api.history()).toHaveLength(1);
  await mockPhase4Api.clearHistory();
  await mockDockApi.setConfigOption({
    sessionId: session.id,
    optionId: "model",
    value: "claude-sonnet-4-6",
  });
  expect(await mockPhase4Api.history()).toHaveLength(0);
  await mockPhase4Api.saveHistorySettings(false);
  await mockDockApi.startSession({ profileId: "claude-code" });
  expect(await mockPhase4Api.history()).toHaveLength(0);
});
it("R6-H07 settings retain history choice; Clear requires confirmation", async () => {
  seedMockHistory([entry()]);
  mount(<BrainAgentSettings />);
  const toggle = await screen.findByRole("switch", {
    name: "Keep chat history",
  });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  fireEvent.click(
    screen.getByRole("button", { name: "Clear history for this project" }),
  );
  expect(await mockPhase4Api.history()).toHaveLength(1);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Cancel",
    }),
  );
  expect(await mockPhase4Api.history()).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Clear history for this project" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Clear history",
    }),
  );
  await screen.findByText("History cleared for this project.");
  expect(await mockPhase4Api.history()).toHaveLength(0);
});
it("R6-H11 a failed clear keeps its recovery message inside the confirmation dialog", async () => {
  seedMockHistory([entry()]);
  vi.spyOn(mockPhase4Api, "clearHistory").mockRejectedValueOnce(
    Error("History is busy. Try again."),
  );
  mount(<BrainAgentSettings />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Clear history for this project",
    }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Clear history" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "History is busy. Try again.",
  );
  expect(await mockPhase4Api.history()).toHaveLength(1);
});
it("R6-W01 provider/key Add, Replace, Clear and test success/failure never expose a saved key", async () => {
  mount(<BrainAgentSettings />);
  await screen.findByRole("combobox", { name: "Search provider" });
  await choose("Search provider", "Brave");
  fireEvent.click(await screen.findByRole("button", { name: "Add" }));
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "fictional-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  await screen.findByText("API key: Set");
  expect(screen.queryByDisplayValue("fictional-key")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Test" }));
  await screen.findByText("Search is working.");
  setMockWebFailure(true);
  fireEvent.click(screen.getByRole("button", { name: "Test" }));
  await screen.findByText("Can't reach the search provider. Try again.");
  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  expect(screen.getByLabelText("API key")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  await screen.findByText("API key: Not set");
});
function ToolsHarness({
  secret = vi.fn(),
}: {
  secret?: (key: string, value: string) => void;
}) {
  const [servers, change] = useState<McpServer[]>([]);
  return (
    <>
      <BrainTools
        servers={servers}
        change={change}
        secret={secret}
        disabled={false}
        setupWeb={vi.fn()}
      />
      <output aria-label="Saved tools">{JSON.stringify(servers)}</output>
    </>
  );
}
it("R6-T01 tools lock jam-board, default presets off, Web trust on and desktop notice", async () => {
  render(<ToolsHarness />);
  expect(
    screen.getByRole("switch", { name: "Jam Board · Always on" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("switch", { name: "Web (Jam Board)" }),
  ).toHaveAttribute("aria-checked", "false");
  expect(
    screen.getByRole("switch", {
      name: "Trust read-only tools · jam-web",
      hidden: true,
    }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    await screen.findByRole("button", { name: "Set up web search" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("switch", { name: "Desktop (advanced)" }));
  expect(
    screen.getByText(
      "The agent can see and control your screen. Turn it on only while you need it.",
    ),
  ).toBeVisible();
});
it("R6-T02 custom HTTP bearer uses secret callback and never the profile; custom stdio validates arguments", async () => {
  const secret = vi.fn();
  render(<ToolsHarness secret={secret} />);
  fireEvent.click(screen.getByRole("button", { name: "Add custom" }));
  fireEvent.change(screen.getByLabelText("Server name"), {
    target: { value: "research" },
  });
  await choose("Tool transport", "HTTP");
  fireEvent.change(screen.getByLabelText("Tool URL"), {
    target: { value: "https://example.com/mcp" },
  });
  fireEvent.change(screen.getByLabelText("Bearer token (optional)"), {
    target: { value: "fictional-bearer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  expect(secret).toHaveBeenCalledWith(
    "MCP_research_BEARER",
    "fictional-bearer",
  );
  expect(screen.getByLabelText("Saved tools")).not.toHaveTextContent(
    "fictional-bearer",
  );
  fireEvent.click(screen.getByRole("button", { name: "Add custom" }));
  await choose("Tool transport", "Stdio");
  fireEvent.change(screen.getByLabelText("Server name"), {
    target: { value: "local" },
  });
  fireEvent.change(screen.getByLabelText("Tool command"), {
    target: { value: "node" },
  });
  fireEvent.change(screen.getByLabelText("Tool arguments (JSON array)"), {
    target: { value: "{}" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  expect(screen.getByRole("alert")).toHaveTextContent("JSON array of strings");
});
it("R6-T03 missing npx disables Browser and a failing custom MCP emits an error while chat stays ready", async () => {
  const profiles = await mockDockApi.profiles();
  vi.spyOn(mockDockApi, "profiles").mockResolvedValue(
    profiles.map((p) => ({
      ...p,
      available: false,
      unavailableReason: "npx not found on PATH",
    })),
  );
  render(<ToolsHarness />);
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "Browser" })).toBeDisabled(),
  );
  await mockDockApi.saveProfile({
    id: "failing-mcp",
    label: "Fixture",
    kind: "acp",
    extraMcpServers: [
      {
        name: "broken",
        command: "missing-command",
        args: [],
        env: [],
        preset: "custom",
        enabled: true,
        trustReadOnly: false,
      },
    ],
  });
  const session = await mockDockApi.startSession({ profileId: "failing-mcp" });
  expect(session.status).toBe("ready");
  expect(
    (await mockDockApi.history(session.id)).some(
      (e) => e.kind === "error" && e.message.includes("broken"),
    ),
  ).toBe(true);
});
it("R6-T04 failed bearer save retains the created profile identity and offers a blank secret field for retry", async () => {
  const save = vi.spyOn(mockDockApi, "saveProfile");
  vi.spyOn(mockDockApi, "setSecret").mockRejectedValueOnce(
    Error("Credential store unavailable"),
  );
  const close = vi.fn();
  render(
    <ConnectionEditor profile={null} close={close} refresh={async () => {}} />,
  );
  fireEvent.change(screen.getByLabelText("Label", {}), {
    target: { value: "Custom fixture" },
  });
  fireEvent.change(screen.getByLabelText("Command", {}), {
    target: { value: "fixture-agent" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add custom" }));
  fireEvent.change(screen.getByLabelText("Server name"), {
    target: { value: "remote-tools" },
  });
  await choose("Tool transport", "HTTP");
  fireEvent.change(screen.getByLabelText("Tool URL"), {
    target: { value: "https://example.com/mcp" },
  });
  fireEvent.change(screen.getByLabelText("Bearer token (optional)"), {
    target: { value: "fictional-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connection saved, but the API key could not be saved. Enter it again to retry.",
    ),
  );
  expect(screen.getByLabelText("remote-tools bearer token")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("remote-tools bearer token"), {
    target: { value: "replacement-fixture" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1]?.[0].id).toBeTruthy();
  expect(
    (await mockDockApi.profiles()).filter((p) => p.label === "Custom fixture"),
  ).toHaveLength(1);
});
it("R6-V01 Cloud shows defaults, custom-only URL, key flow and local model retention", async () => {
  setMockVoice({ enabled: true, model: "balanced" });
  mount(<BrainVoiceSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Cloud" }));
  expect(await screen.findByLabelText("Cloud model")).toHaveValue(
    "whisper-large-v3-turbo",
  );
  expect(screen.queryByLabelText("Base URL")).toBeNull();
  expect(
    screen.getAllByText("Audio is sent to Groq for transcription."),
  ).toHaveLength(1);
  await choose("Cloud voice provider", "OpenAI");
  await waitFor(() =>
    expect(screen.getByLabelText("Cloud model")).toHaveValue(
      "gpt-4o-mini-transcribe",
    ),
  );
  await choose("Cloud voice provider", "Custom");
  fireEvent.change(screen.getByLabelText("Base URL"), {
    target: { value: "https://example.com/v1" },
  });
  fireEvent.change(screen.getByLabelText("Cloud model"), {
    target: { value: "custom-whisper" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save cloud settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add" }));
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "fictional-cloud-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  await screen.findByText("API key: Set");
  expect(voiceStatusLine(await mockVoiceApi.status())).toBe(
    "Audio is sent to your provider for transcription.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Local Whisper" }));
  await waitFor(async () =>
    expect((await mockVoiceApi.status()).engine).toBe("local-whisper"),
  );
  expect((await mockVoiceApi.status()).model).toBe("balanced");
});
it("R6-V02 cloud prepare installs nothing and 401 has a plain key error", async () => {
  setMockVoice(
    {
      enabled: true,
      engine: "cloud",
      cloud: {
        provider: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "whisper-large-v3-turbo",
        keySet: true,
      },
      state: "idle",
    },
    "cloud-401",
  );
  await mockVoiceApi.prepare();
  expect((await mockVoiceApi.status()).runtimeInstalled).toBe(false);
  await expect(mockVoiceApi.transcribe("fixture", "en", "")).rejects.toThrow(
    "Check the API key",
  );
  await act(() => refreshVoice());
  expect(voiceStatusLine(await mockVoiceApi.status())).toContain("Groq");
});
it("R6-H11 rows open read-only, show resumable pills, and reveal Rename/Delete through a keyboard dismissible menu", async () => {
  const entries = [entry(), entry("transcript"), entry("none")];
  seedMockHistory(entries);
  const open = vi.fn(),
    resume = vi.spyOn(mockPhase4Api, "resume");
  mount(<BrainHistory open={open} resumed={vi.fn()} />);
  await screen.findByText("Native resume");
  expect(screen.getByText("From transcript")).toBeVisible();
  expect(screen.getByText("Read only")).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  fireEvent.click(
    screen.getAllByRole("button", { name: /^Open / })[2] as HTMLElement,
  );
  expect(open).toHaveBeenCalledWith(entries[2]);
  expect(resume).not.toHaveBeenCalled();
  const trigger = screen.getAllByRole("button", {
    name: /^History actions for /,
  })[0] as HTMLElement;
  fireEvent.click(trigger);
  expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  expect(screen.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  fireEvent.keyDown(screen.getByRole("menuitem", { name: "Rename" }), {
    key: "Escape",
  });
  expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  expect(trigger).toHaveFocus();
});
it("R6-W02 disabled Test explains missing provider and key to pointer and keyboard users", async () => {
  const user = userEvent.setup();
  mount(<BrainAgentSettings />);
  const test = await screen.findByRole("button", { name: "Test" });
  expect(test).toBeDisabled();
  await user.hover(test.parentElement as HTMLElement);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Choose a provider first",
  );
  await user.unhover(test.parentElement as HTMLElement);
  await choose("Search provider", "Tavily");
  await waitFor(() =>
    expect(screen.getByText("API key: Not set")).toBeVisible(),
  );
  expect(test).toBeDisabled();
  act(() => test.parentElement?.focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "Add an API key first",
  );
});
it("R6-H13 a deleted row stays available for Undo then disappears when its window expires", async () => {
  const selected = entry();
  seedMockHistory([selected]);
  const remove = vi.spyOn(mockPhase4Api, "delete");
  mount(<BrainHistory open={vi.fn()} resumed={vi.fn()} />);
  await screen.findByText(selected.title);
  vi.useFakeTimers();
  try {
    historyMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(
      screen.getByRole("status", { name: `Deleted ${selected.title}` }),
    ).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(7999));
    expect(screen.getByRole("button", { name: "Undo" })).toBeVisible();
    expect(remove).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    expect(screen.getByText("No chat history found")).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});
it("R6-H14 Undo expires before a slow delete dispatch completes; failure restores the entry", async () => {
  const selected = entry();
  seedMockHistory([selected]);
  let rejectDelete!: (reason: Error) => void;
  vi.spyOn(mockPhase4Api, "delete").mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectDelete = reject;
      }),
  );
  mount(<BrainHistory open={vi.fn()} resumed={vi.fn()} />);
  await screen.findByText(selected.title);
  vi.useFakeTimers();
  try {
    historyMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    await act(async () => {
      rejectDelete(Error("History unavailable"));
    });
    expect(screen.getByRole("button", { name: /^Open / })).toHaveTextContent(
      selected.title,
    );
  } finally {
    vi.useRealTimers();
  }
});
it("R7-W2/W3 History filters the same list by kind, keeps provider/model and handles no terminal entries", async () => {
  const chat = entry();
  const terminal = {
    ...entry("none"),
    id: "terminal-entry",
    kind: "terminal",
    profileId: "codex-cli",
    profileLabel: "My connection",
    provider: { label: "Codex", agentKind: "codex" },
    model: "gpt-6.1-sol",
    title: "Terminal review",
  };
  vi.spyOn(mockPhase4Api, "history").mockResolvedValue([
    chat,
    terminal,
  ] as HistoryEntry[]);
  mount(<BrainHistory open={vi.fn()} resumed={vi.fn()} />);
  expect(await screen.findByText(chat.title)).toBeVisible();
  expect(screen.queryByText(terminal.title)).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
  expect(
    screen.getByRole("button", { name: "Open Terminal review" }),
  ).toHaveTextContent("Codex \u00b7 gpt-6.1-sol");
  expect(screen.queryByText(chat.title)).toBeNull();
  const tabs = screen.getByRole("tablist", { name: "History kind" });
  fireEvent.keyDown(within(tabs).getByRole("tab", { name: "Terminal" }), {
    key: "Home",
  });
  expect(within(tabs).getByRole("tab", { name: "Chat" })).toHaveFocus();
  expect(screen.getByText(chat.title)).toBeVisible();
});
