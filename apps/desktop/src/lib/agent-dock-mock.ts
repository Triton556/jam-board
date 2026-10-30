import type {
  AgentDockApi,
  AgentDockEvent,
  AgentProfileView,
  AgentSessionView,
} from "./agent-dock-api";
import {
  recordMockHistoryEvent,
  resetMockPhase4,
} from "./agent-dock-phase4-mock";
import {
  resetMockProviderScenarios,
  runMockProviderTurn,
  setMockProviderScenario,
} from "./agent-dock-retry-mock";
import { api } from "./api";
import { JamError } from "./types";

type Payload = AgentDockEvent extends infer E
  ? E extends AgentDockEvent
    ? Omit<E, "sessionId" | "seq" | "at">
    : never
  : never;
const profile = (
  id: string,
  label: string,
  kind: "acp" | "terminal" | "api",
  command: string | null,
  args: string[] = [],
): AgentProfileView => ({
  id,
  label,
  kind,
  preset: id,
  agentName: `${label} · dock`,
  command,
  args,
  baseUrl: null,
  model: null,
  effortStyle: "none",
  env: [],
  hidden: false,
  secretKeys: [],
  available: true,
  unavailableReason: null,
  builtIn: true,
});
const profiles = [
  {
    ...profile("claude-code", "Claude Code", "acp", "npx", [
      "-y",
      "@agentclientprotocol/claude-agent-acp",
    ]),
    secretKeys: [{ key: "ANTHROPIC_API_KEY", label: "API key", isSet: false }],
  },
  profile("codex", "Codex", "acp", "npx", [
    "-y",
    "@agentclientprotocol/codex-acp",
  ]),
  {
    ...profile("opencode", "OpenCode", "acp", "opencode", ["acp"]),
    available: false,
    unavailableReason: "opencode not found on PATH",
  },
  ...["zai", "openrouter"].map((provider) => ({
    ...profile(
      `claude-${provider}`,
      `Claude via ${provider === "zai" ? "z.ai" : "OpenRouter"}`,
      "acp",
      "npx",
      ["-y", "@agentclientprotocol/claude-agent-acp"],
    ),
    baseUrl:
      provider === "zai"
        ? "https://api.z.ai/api/anthropic"
        : "https://openrouter.ai/api",
    secretKeys: [
      { key: "ANTHROPIC_AUTH_TOKEN", label: "API token", isSet: false },
    ],
  })),
  profile("claude-cli", "Claude CLI", "terminal", "npx", [
    "-y",
    "@anthropic-ai/claude-code",
  ]),
  profile("codex-cli", "Codex CLI", "terminal", "codex"),
  ...[
    ["api-openrouter", "OpenRouter", "https://openrouter.ai/api/v1"],
    ["api-zai", "z.ai", "https://api.z.ai/api/paas/v4"],
    ["api-custom", "Custom API", ""],
  ].map(([id, label, baseUrl]) => ({
    ...profile(id ?? "", label ?? "", "api", null),
    baseUrl: baseUrl || null,
    effortStyle:
      id === "api-openrouter"
        ? ("openrouter" as const)
        : id === "api-zai"
          ? ("zai" as const)
          : ("none" as const),
    secretKeys: [{ key: "API_KEY", label: "API key", isSet: false }],
  })),
];
const sessions = new Map<string, AgentSessionView>();
const configs = new Map<string, import("./agent-dock-api").ConfigOption[]>();
const attachments = new Map<
  string,
  { sessionId: string; view: import("./agent-dock-api").AttachmentView }
>();
const mockThumbnail =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
export const mockModels = [
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    contextLength: 200000,
    promptPricePerM: "3",
    completionPricePerM: "15",
    inputImage: true,
    reasoning: true,
    tools: true,
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    inputImage: true,
    reasoning: true,
    tools: true,
  },
  {
    id: "glm-4.6",
    name: "GLM-4.6",
    inputImage: false,
    reasoning: true,
    tools: true,
  },
  {
    id: "small-text",
    name: "Small text",
    inputImage: false,
    reasoning: false,
    tools: true,
  },
  {
    id: "vision-preview",
    name: "Vision preview",
    inputImage: true,
    reasoning: false,
    tools: false,
  },
];
const mockCodexModels = [
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
  { id: "gpt-6.1-terra", name: "GPT-6.1 Terra" },
];
function mockOptions(
  session: AgentSessionView,
  model: string,
  effort = "auto",
) {
  const p = profiles.find((p) => p.id === session.profileId);
  const options: import("./agent-dock-api").ConfigOption[] = [
    {
      id: "model",
      category: "model",
      name: "Model",
      value: model,
      values: (session.kind !== "api" && session.profileId.startsWith("codex")
        ? mockCodexModels
        : mockModels.filter(
            (m) => session.kind === "api" || m.id.startsWith("claude"),
          )
      ).map((m) => ({ value: m.id, name: m.name })),
    },
  ];
  if (
    session.kind !== "api" ||
    (p?.effortStyle !== "none" &&
      mockModels.find((m) => m.id === model)?.reasoning)
  )
    options.push({
      id: "thought_level",
      category: "thought_level",
      name: "Effort",
      value: effort,
      description: "How much reasoning to use for the next turn.",
      values:
        p?.effortStyle === "zai"
          ? [
              { value: "auto", name: "Auto" },
              { value: "enabled", name: "Thinking on" },
              { value: "disabled", name: "Thinking off" },
            ]
          : ["auto", "low", "medium", "high"].map((value) => ({
              value,
              name: value[0]?.toUpperCase() + value.slice(1),
            })),
    });
  if (session.kind === "acp")
    options.push({
      id: "mode",
      category: "mode",
      name: "Access",
      value: session.profileId === "codex" ? "auto" : "default",
      values:
        session.profileId === "codex"
          ? [
              { value: "read-only", name: "Read only" },
              { value: "auto", name: "Auto" },
              { value: "full-access", name: "Full access" },
            ]
          : [
              { value: "auto", name: "Auto" },
              {
                value: "default",
                name: "Default",
                description:
                  "Asks before editing files, running commands or changing the board.",
              },
              {
                value: "acceptEdits",
                name: "Accept edits",
                description:
                  "Edits files without asking; asks for everything else.",
              },
              {
                value: "plan",
                name: "Plan",
                description: "Reads and proposes a plan; changes nothing.",
              },
              {
                value: "bypassPermissions",
                name: "Bypass permissions",
                description: "Never asks. Use only in a throwaway workspace.",
              },
            ],
    });
  if (session.kind === "acp" && session.profileId.startsWith("claude"))
    options.push(
      {
        id: "fast",
        name: "Fast mode",
        description: "Faster responses on supported models",
        category: "model_config",
        value: "off",
        values: [
          { value: "on", name: "On" },
          { value: "off", name: "Off" },
        ],
      },
      {
        id: "mock-response-style",
        name: "Response style",
        description: "Mock fixture for session choices.",
        category: "model_config",
        value: "balanced",
        values: [
          { value: "balanced", name: "Balanced" },
          { value: "concise", name: "Concise" },
          { value: "detailed", name: "Detailed" },
        ],
      },
    );
  return options;
}
const histories = new Map<string, AgentDockEvent[]>();
const outputs = new Map<string, string>();
const listeners = new Set<(event: AgentDockEvent) => void>();
const terminalListeners = new Set<
  (event: { sessionId: string; data: string }) => void
>();
const turns = new Map<
  string,
  {
    cancelled: boolean;
    resume?: () => void;
    requestId?: string;
    optionId?: string | null;
  }
>();
const counts = new Map<string, number>();
const signedOutProfiles = new Set<string>();
let catalogError: string | null = null;
let userConfigDefault: import("./agent-dock-api").UserConfigDefault = "ask";
const warningListeners = new Set<
  (warning: import("./agent-dock-api").LaunchWarning) => void
>();
export function emitMockLaunchWarning(
  warning: import("./agent-dock-api").LaunchWarning,
) {
  for (const cb of warningListeners) cb(warning);
  emit(warning.sessionId, {
    kind: "status",
    status: requireSession(warning.sessionId).status,
    message: `Launch warning: ${JSON.stringify(warning)}`,
  });
}
let launchDelayMs = 0;
export function setMockLaunchDelay(delayMs: number) {
  launchDelayMs = delayMs;
}
export function emitMockDockEvent(sessionId: string, payload: Payload) {
  emit(sessionId, payload);
}

export function setMockCatalogError(error: string | null) {
  if (import.meta.env.VITE_MOCK_BRIDGE === "1") catalogError = error;
}
export function getMockSignedOut(profileId: string) {
  return (
    import.meta.env.VITE_MOCK_BRIDGE === "1" && signedOutProfiles.has(profileId)
  );
}
export function setMockSignedOut(profileId: string, signedOut: boolean) {
  if (import.meta.env.VITE_MOCK_BRIDGE !== "1") return;
  if (signedOut) signedOutProfiles.add(profileId);
  else signedOutProfiles.delete(profileId);
  for (const session of sessions.values())
    if (
      session.profileId === profileId &&
      session.kind !== "terminal" &&
      !["stopped", "failed"].includes(session.status)
    )
      emit(session.id, {
        kind: "auth",
        state: signedOut ? "required" : "ok",
        label: signedOut ? "Not logged in (mock)" : "Signed in",
      });
}
export async function simulateMockCrash(sessionId: string) {
  if (import.meta.env.VITE_MOCK_BRIDGE !== "1")
    throw new JamError("unavailable", "Mock controls are disabled.");
  requireSession(sessionId);
  await mockDockApi.cancelTurn(sessionId);
  emit(sessionId, {
    kind: "error",
    message: "Mock agent crashed",
    detail: "Simulated process failure for browser QA.",
  });
  emit(sessionId, { kind: "status", status: "failed" });
}
/** Reset only disposable dock fixtures; never touches the board. */
export function resetMockDock() {
  launchDelayMs = 0;
  userConfigDefault = "ask";
  resetMockProviderScenarios();
  resetMockPhase4();
  for (const turn of turns.values()) {
    turn.cancelled = true;
    turn.resume?.();
  }
  turns.clear();
  sessions.clear();
  configs.clear();
  attachments.clear();
  histories.clear();
  outputs.clear();
  counts.clear();
  signedOutProfiles.clear();
  catalogError = null;
}
function emit(sessionId: string, payload: Payload) {
  const history = histories.get(sessionId) ?? [];
  const event = {
    sessionId,
    seq: (history.at(-1)?.seq ?? 0) + 1,
    at: new Date().toISOString(),
    ...payload,
  } as AgentDockEvent;
  histories.set(sessionId, [...history, event].slice(-4000));
  const session = sessions.get(sessionId);
  const profile = profiles.find((p) => p.id === session?.profileId);
  if (session && profile) recordMockHistoryEvent(session, profile, event);
  if (payload.kind === "status")
    Object.assign(sessions.get(sessionId) ?? {}, { status: payload.status });
  for (const cb of listeners) cb(event);
}
function output(sessionId: string, data: string) {
  outputs.set(
    sessionId,
    ((outputs.get(sessionId) ?? "") + data).slice(-200000),
  );
  for (const cb of terminalListeners) cb({ sessionId, data });
}
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 180));
function requireSession(id: string) {
  const session = sessions.get(id);
  if (!session) throw new JamError("not_found", "Session no longer exists.");
  return session;
}
async function stream(id: string, count: number) {
  const turn = { cancelled: false } as {
    cancelled: boolean;
    resume?: () => void;
    requestId?: string;
    optionId?: string | null;
  };
  turns.set(id, turn);
  const step = async (payload: Payload) => {
    await delay();
    if (turn.cancelled) return false;
    emit(id, payload);
    return true;
  };
  try {
    if (await runMockProviderTurn(id, turn, emit)) return;
    if (
      !(await step({
        kind: "agent_thought_delta",
        messageId: `thought-${count}`,
        text: "I’m checking the project context and the next useful step.",
      }))
    )
      return;
    for (const text of [
      "I’ve reviewed the context.\n\n",
      "- Clarify the brief for JB-12.\n",
      "- Keep the next step small and reviewable.\n\n",
      "Check the brief with `npm test` before the next step. Here’s a proposed follow-up for the board.",
    ]) {
      if (
        !(await step({
          kind: "agent_message_delta",
          messageId: `reply-${count}`,
          text,
        }))
      )
        return;
    }
    const toolCallId = `tool-${count}`;
    if (
      !(await step({
        kind: "tool_call",
        toolCallId,
        title: "jam-board · Create task",
        toolKind: "edit",
        status: "in_progress",
        input: { server: "jam-board", title: "Review the brief" },
      }))
    )
      return;
    const apiSession = requireSession(id).kind === "api";
    if (
      !apiSession &&
      !(await step({
        kind: "tool_call_update",
        toolCallId,
        status: "completed",
        output: "Created task JB-21 — Review the brief (mock preview).",
      }))
    )
      return;
    if (apiSession || count % 2 === 0) {
      turn.requestId = `permission-${count}`;
      emit(id, { kind: "status", status: "awaiting_permission" });
      const resolved = new Promise<void>((resolve) => {
        turn.resume = resolve;
      });
      emit(id, {
        kind: "permission_request",
        requestId: turn.requestId,
        title: apiSession ? "Create task" : "Run `npm test`",
        ...(apiSession ? { toolCallId } : {}),
        options: [
          { optionId: "once", name: "Allow once", kind: "allow_once" },
          { optionId: "always", name: "Always allow", kind: "allow_always" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      await resolved;
      if (turn.cancelled) return;
      emit(id, { kind: "status", status: "running" });
    }
    if (
      apiSession &&
      !(await step({
        kind: "tool_call_update",
        toolCallId,
        status:
          turn.optionId === "once" || turn.optionId === "always"
            ? "completed"
            : "failed",
        output:
          turn.optionId === "once" || turn.optionId === "always"
            ? "Created task JB-21 — Review the brief (mock preview)."
            : "Task creation rejected.",
      }))
    )
      return;
    if (
      !(await step({
        kind: "plan",
        entries: [
          { content: "Review project context", status: "completed" },
          { content: "Draft the next task", status: "in_progress" },
          { content: "Ask for review", status: "pending" },
        ],
      }))
    )
      return;
    emit(id, { kind: "turn_end", stopReason: "end_turn" });
    emit(id, { kind: "status", status: "ready" });
  } finally {
    if (turns.get(id) === turn) turns.delete(id);
  }
}
export const mockDockApi: AgentDockApi = {
  launchLogs: async (id) =>
    structuredClone(
      (histories.get(id) ?? []).filter(
        (e) =>
          e.kind === "launch_step" ||
          e.kind === "launch_log" ||
          (e.kind === "status" && e.message?.startsWith("Launch warning: ")),
      ),
    ),
  launchOptions: async () => ({
    userConfigDefault,
    excludeSupported: true,
    excludeDescription:
      "Exclude global MCP servers and supported hooks for this launch. Global instruction files and managed policy can still apply. Native authentication is preserved.",
  }),
  saveUserConfigDefault: async (choice) => {
    userConfigDefault = choice;
    return choice;
  },
  onLaunchWarning: (cb) => {
    warningListeners.add(cb);
    return () => {
      warningListeners.delete(cb);
    };
  },
  profiles: async () => structuredClone(profiles),
  saveProfile: async (input) => {
    const requestedId = input.id?.trim();
    const existing = requestedId
      ? profiles.find((p) => p.id === requestedId)
      : undefined;
    let id = requestedId || crypto.randomUUID();
    if (!requestedId) {
      const base = id;
      let suffix = 1;
      while (profiles.some((p) => p.id === id)) id = `${base}-${suffix++}`;
    }
    const next = {
      ...profile(id, input.label, input.kind, input.command ?? ""),
      builtIn: false,
      preset: null,
      ...existing,
      ...input,
      id,
    };
    if (existing) Object.assign(existing, next);
    else profiles.push(next);
    return structuredClone(next);
  },
  deleteProfile: async (id) => {
    const index = profiles.findIndex((p) => p.id === id);
    if (profiles[index]?.builtIn)
      throw new JamError("invalid", "Hide a built-in connection instead.");
    if (index >= 0) profiles.splice(index, 1);
  },
  setSecret: async (id, key, _value) => {
    const owner = profiles.find((p) => p.id === id);
    if (owner && !owner.secretKeys.some((s) => s.key === key))
      owner.secretKeys.push({ key, label: "Bearer token", isSet: false });
    const secret = owner?.secretKeys.find((s) => s.key === key);
    if (secret) {
      secret.isSet = true;
      for (const session of sessions.values())
        if (session.profileId === id && session.kind !== "terminal")
          emit(session.id, {
            kind: "auth",
            state: "ok",
            label: "API key saved",
          });
    }
  },
  clearSecret: async (id, key) => {
    const secret = profiles
      .find((p) => p.id === id)
      ?.secretKeys.find((s) => s.key === key);
    if (secret) secret.isSet = false;
  },
  sessions: async () => {
    const app = await api.appState();
    return structuredClone(
      [...sessions.values()]
        .filter((s) => s.projectId === app.jam?.id)
        .reverse(),
    );
  },
  startSession: async ({ profileId, cwd, model, effort, userConfig }) => {
    const p = profiles.find((p) => p.id === profileId);
    if (!p?.available)
      throw new JamError(
        "unavailable",
        p?.unavailableReason ?? "Connection is unavailable.",
      );
    if (
      (p.id === "claude-zai" || p.kind === "api") &&
      p.secretKeys.some((s) => !s.isSet)
    )
      throw new JamError(
        "missing_secret",
        "Add the API token in Connections first.",
      );
    if (p.kind === "api" && !(model ?? p.model)?.trim())
      throw new JamError("missing_model", "Choose a model");
    const app = await api.appState();
    if (!app.jam) throw new JamError("no_project", "Open a project first.");
    const s: AgentSessionView = {
      id: crypto.randomUUID(),
      profileId,
      projectId: app.jam.id,
      kind: p.kind,
      title: p.label,
      status: launchDelayMs ? "starting" : "ready",
      cwd: cwd ?? "C:/work/cozy-jam",
      createdAt: new Date().toISOString(),
      capabilities: {
        images: false,
        audio: false,
        embeddedContext: true,
        configOptions: p.kind !== "terminal",
      },
    };
    sessions.set(s.id, s);
    emit(s.id, {
      kind: "status",
      status: s.status,
      message: launchDelayMs ? "Adapter starting" : "Session ready",
    });
    const startedAt = new Date().toISOString();
    emit(s.id, {
      kind: "launch_step",
      step: "user_config",
      state: "ok",
      message:
        userConfig === "exclude"
          ? "User global configuration excluded"
          : "User global configuration included",
      startedAt,
      endedAt: startedAt,
    });
    emit(s.id, {
      kind: "launch_step",
      step: "adapter",
      state: launchDelayMs ? "running" : "ok",
      message: launchDelayMs
        ? `Preparing ${p.label} chat adapter (first launch may download it)…`
        : "Chat adapter responded",
      startedAt,
      endedAt: launchDelayMs ? null : startedAt,
    });
    emit(s.id, {
      kind: "launch_step",
      step: "process",
      state: "ok",
      message: "Adapter starting",
      startedAt,
      endedAt: startedAt,
    });
    if (!launchDelayMs)
      emit(s.id, {
        kind: "launch_step",
        step: "initialize",
        state: "ok",
        message: "Initialize adapter",
        startedAt,
        endedAt: startedAt,
      });
    emit(s.id, {
      kind: "launch_step",
      step: "mcp",
      state: "skipped",
      message: "MCP connection not confirmed by this adapter",
      startedAt,
      endedAt: startedAt,
    });
    if (userConfig)
      emit(s.id, {
        kind: "status",
        status: s.status,
        message: `Global config: ${userConfig === "include" ? "on" : "off"}`,
      });
    const finishLaunch = () => {
      if (!sessions.has(s.id) || ["stopped", "failed"].includes(s.status))
        return;
      if (p.kind === "terminal")
        output(
          s.id,
          `Jam Board · ${p.label} (mock terminal)\r\nConnected to ${app.jam?.name}\r\n${s.cwd}\r\n> `,
        );
      else {
        emit(s.id, { kind: "usage", used: 0, size: 200000, cost: null });
        emit(s.id, {
          kind: "launch_step",
          step: "adapter",
          state: "ok",
          message: "Chat adapter responded",
          startedAt,
          endedAt: new Date().toISOString(),
        });
        if (launchDelayMs)
          emit(s.id, {
            kind: "launch_step",
            step: "initialize",
            state: "ok",
            message: "Chat adapter initialized",
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
          });
        emit(s.id, {
          kind: "auth",
          state:
            getMockSignedOut(p.id) ||
            (p.id === "claude-openrouter" &&
              p.secretKeys.some((key) => !key.isSet))
              ? "required"
              : "ok",
          label: getMockSignedOut(p.id)
            ? "Not logged in (mock)"
            : p.id === "claude-openrouter"
              ? "No API key"
              : "Signed in",
        });
        emit(s.id, {
          kind: "available_commands",
          commands: [
            { name: "help", description: "Show agent help" },
            { name: "compact", description: "Summarize this conversation" },
          ],
        });
        const options = mockOptions(
          s,
          model ||
            p.model ||
            (p.id.startsWith("codex") ? "gpt-6.1-sol" : "claude-sonnet-4-6"),
          effort,
        );
        configs.set(s.id, options);
        emit(s.id, {
          kind: "config_options",
          options: structuredClone(options),
        });
        for (const server of p.extraMcpServers ?? [])
          if (server.enabled && /fail|missing/.test(server.command))
            emit(s.id, {
              kind: "error",
              message: `Could not connect to ${server.name}. Chat can continue without this tool server.`,
            });
      }
      if (s.status === "starting")
        emit(s.id, {
          kind: "status",
          status: "ready",
          message: "Session ready",
        });
    };
    if (launchDelayMs) setTimeout(finishLaunch, launchDelayMs);
    else finishLaunch();
    return structuredClone(s);
  },
  sendPrompt: async ({ sessionId, content }) => {
    const s = requireSession(sessionId);
    if (s.kind === "terminal" || s.status !== "ready")
      throw new JamError("busy", "This session is not ready for a prompt.");
    const attached = content
      .filter((p) => p.type === "attachment")
      .map((p) => attachments.get(p.attachmentId));
    if (attached.some((a) => !a || a.sessionId !== sessionId))
      throw new JamError("invalid", "Attachment belongs to another session.");
    if (
      attached.length > 10 ||
      attached.reduce((sum, a) => sum + (a?.view.size ?? 0), 0) >
        50 * 1024 * 1024
    )
      throw new JamError("invalid", "Attachment message limit exceeded.");
    const app = await api.appState();
    if (app.jam?.id !== s.projectId)
      throw new JamError(
        "project_mismatch",
        "This session belongs to another project.",
      );
    const count = (counts.get(sessionId) ?? 0) + 1;
    counts.set(sessionId, count);
    emit(sessionId, {
      kind: "user_message",
      messageId: crypto.randomUUID(),
      content: structuredClone(content),
      ...(count === 1
        ? {
            contextPreamble: `Project: ${app.jam.name}\nKey prefix: ${app.jam.keyPrefix}\nProject ID: ${app.jam.id}\nRead jam://guide first. A chat message does not grant Start approval.`,
          }
        : {}),
    });
    emit(sessionId, { kind: "status", status: "running" });
    void stream(sessionId, count);
  },
  cancelTurn: async (id) => {
    const turn = turns.get(id);
    if (!turn) return;
    turn.cancelled = true;
    if (turn.requestId)
      emit(id, {
        kind: "permission_resolved",
        requestId: turn.requestId,
        optionId: null,
      });
    turn.resume?.();
    turns.delete(id);
    emit(id, { kind: "turn_end", stopReason: "cancelled" });
    emit(id, { kind: "status", status: "ready" });
  },
  retryTurn: async (id) => {
    const session = requireSession(id);
    const app = await api.appState();
    if (session.projectId !== app.jam?.id)
      throw new JamError(
        "project_mismatch",
        "This session belongs to another project.",
      );
    if (session.status !== "ready" || turns.has(id))
      throw new JamError("busy", "Wait for this turn to finish.");
    const history = histories.get(id) ?? [];
    const user = history
      .filter((event) => event.kind === "user_message")
      .at(-1);
    const error = history.filter((event) => event.kind === "error").at(-1);
    if (!user || !error || error.seq < user.seq)
      throw new JamError("no_failed_turn", "There is no failed turn to retry.");
    if (
      history
        .slice(history.indexOf(error) + 1)
        .some(
          (event) =>
            event.kind === "retrying" ||
            (event.kind === "status" && event.status === "running") ||
            (event.kind === "turn_end" && event.stopReason !== "error"),
        )
    )
      throw new JamError("no_failed_turn", "There is no failed turn to retry.");
    if (Date.now() < Date.parse(error.at) + (error.retryAfterMs ?? 0))
      throw new JamError("rate_limited", "Wait before retrying this request.");
    setMockProviderScenario(id, "normal");
    const count = (counts.get(id) ?? 0) + 1;
    counts.set(id, count);
    emit(id, { kind: "status", status: "running" });
    void stream(id, count);
  },
  resolvePermission: async ({ sessionId, requestId, optionId }) => {
    const turn = turns.get(sessionId);
    if (!turn || turn.requestId !== requestId || !turn.resume)
      throw new JamError(
        "stale",
        "This permission request is no longer pending.",
      );
    emit(sessionId, { kind: "permission_resolved", requestId, optionId });
    turn.optionId = optionId;
    const resume = turn.resume;
    turn.resume = undefined;
    resume();
  },
  setConfigOption: async ({ sessionId, optionId, value }) => {
    const session = requireSession(sessionId);
    let options = structuredClone(configs.get(sessionId) ?? []);
    const option = options.find((o) => o.id === optionId);
    if (
      !option ||
      (!(session.kind === "api" && optionId === "model" && value.trim()) &&
        !option.values.some((v) => v.value === value))
    )
      throw new JamError("invalid", "Unknown configuration value.");
    option.value = value;
    if (optionId === "model" && session.kind === "api")
      options = mockOptions(
        session,
        value,
        options.find((o) => o.id === "thought_level")?.value,
      );
    configs.set(sessionId, options);
    emit(sessionId, {
      kind: "config_options",
      options: structuredClone(options),
    });
  },
  modelCatalog: async ({ profileId }) => {
    if (!profiles.some((p) => p.id === profileId))
      throw new JamError("not_found", "Connection not found.");
    return {
      models: structuredClone(mockModels),
      source: "provider",
      fetchedAt: new Date().toISOString(),
      error: catalogError,
    };
  },
  addAttachment: async ({ sessionId, source }) => {
    const session = requireSession(sessionId);
    await delay();
    if ((await api.appState()).jam?.id !== session.projectId)
      throw new JamError(
        "project_mismatch",
        "This session belongs to another project.",
      );
    const name =
      source.kind === "bytes"
        ? source.name
        : (source.path.split(/[\\/]/).at(-1) ?? "file");
    const mimeType =
      source.kind === "bytes"
        ? source.mimeType
        : /\.(png|jpe?g|webp|gif)$/i.test(name)
          ? "image/png"
          : /\.(txt|md|csv)$/i.test(name)
            ? "text/plain"
            : "application/octet-stream";
    const size =
      source.kind === "bytes"
        ? Math.floor((source.data.replace(/=+$/, "").length * 3) / 4)
        : 1024;
    if (size > 20 * 1024 * 1024)
      throw new JamError("invalid", "File is larger than 20 MB");
    if (name.startsWith("refused-"))
      throw new JamError(
        "invalid",
        "Could not copy this file. Choose another file.",
      );
    const isImage = mimeType.startsWith("image/");
    const path =
      source.kind === "bytes"
        ? `data:${mimeType};base64,${source.data}`
        : isImage
          ? mockThumbnail
          : source.path;
    const view = {
      id: crypto.randomUUID(),
      name,
      mimeType,
      size,
      path,
      isImage,
      previewUrl: isImage ? path : null,
      thumbnail: isImage
        ? path.length <= 64000 && path.startsWith("data:")
          ? path
          : mockThumbnail
        : null,
    };
    attachments.set(view.id, { sessionId, view });
    return structuredClone(view);
  },
  stopSession: async (id) => {
    requireSession(id);
    await mockDockApi.cancelTurn(id);
    emit(id, { kind: "status", status: "stopped" });
  },
  history: async (id) => structuredClone(histories.get(id) ?? []),
  terminalWrite: async ({ sessionId, data }) => {
    if (requireSession(sessionId).status === "stopped")
      throw new JamError("stopped", "Restart the terminal first.");
    output(
      sessionId,
      data.replace(/\r/g, "\r\n> ").replace(/\u007f/g, "\b \b"),
    );
  },
  terminalResize: async ({ sessionId }) => {
    requireSession(sessionId);
  },
  terminalSnapshot: async (id) => outputs.get(id) ?? "",
  onEvent: (cb) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  onTerminalOutput: (cb) => {
    terminalListeners.add(cb);
    return () => {
      terminalListeners.delete(cb);
    };
  },
};
export function restoreMockTranscript(
  sessionId: string,
  events: AgentDockEvent[],
  title?: string,
) {
  if (title) Object.assign(sessions.get(sessionId) ?? {}, { title });
  const current = histories.get(sessionId) ?? [];
  histories.set(
    sessionId,
    [...events, ...current].map((event, index) => ({
      ...event,
      sessionId,
      seq: index + 1,
    })),
  );
  emit(sessionId, {
    kind: "status",
    status: "ready",
    message: `Resumed ${new Date().toLocaleString()}`,
  });
}
