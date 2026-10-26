export type RuntimeKind = "acp" | "terminal" | "api";
export type ProviderErrorCode = import("../bindings").AgentErrorCode;
export type McpServer = import("../bindings").McpEntry_Serialize;
export type HistoryEntry = import("../bindings").HistoryEntry;
export type AgentProfileView = {
  id: string;
  label: string;
  kind: RuntimeKind;
  preset: string | null;
  agentName: string; // JAM_AGENT_NAME used for this profile
  command: string | null;
  args: string[];
  baseUrl: string | null;
  model: string | null;
  effortStyle?: "openrouter" | "zai" | "openai" | "none";
  effort?: string | null;
  env: { name: string; value: string }[]; // non-secret extra environment
  hidden: boolean;
  secretKeys: { key: string; label: string; isSet: boolean }[];
  available: boolean;
  unavailableReason: string | null; // detection result
  builtIn: boolean; // presets cannot be deleted, only hidden/edited
  extraMcpServers?: McpServer[];
};
export type AgentProfileInput = Partial<
  Omit<
    AgentProfileView,
    "available" | "unavailableReason" | "builtIn" | "secretKeys"
  >
> & { label: string; kind: RuntimeKind };
export type SessionStatus =
  | "starting"
  | "ready"
  | "running"
  | "awaiting_permission"
  | "stopped"
  | "failed";
export type AgentSessionView = {
  id: string;
  profileId: string;
  projectId: string;
  kind: RuntimeKind;
  title: string;
  status: SessionStatus;
  cwd: string;
  createdAt: string;
  capabilities: {
    images: boolean;
    audio: boolean;
    embeddedContext: boolean;
    configOptions: boolean;
  };
};
export type PromptPart =
  | { type: "text"; text: string }
  | { type: "board_ref"; uri: string; label: string; text: string } // jam://task/JB-12 …
  | { type: "image"; mimeType: string; data: string }
  | { type: "attachment"; attachmentId: string };
export type ConfigOption = {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  value: string;
  values: { value: string; name: string; description?: string | null }[];
};
export type ModelInfo = import("../bindings").ModelInfo_Serialize;
export type ModelCatalog = import("../bindings").ModelCatalog_Serialize;
export type AttachmentSource = import("../bindings").AttachmentSource;
export type AttachmentView = import("../bindings").AttachmentView;
export type AgentDockEvent = { sessionId: string; seq: number; at: string } & (
  | { kind: "status"; status: SessionStatus; message?: string | null }
  | { kind: "auth"; state: "ok" | "required" | "unknown"; label: string }
  | {
      kind: "user_message";
      messageId: string;
      content: PromptPart[];
      contextPreamble?: string | null;
    }
  | { kind: "agent_message_delta"; messageId: string; text: string }
  | { kind: "agent_thought_delta"; messageId: string; text: string }
  | {
      kind: "tool_call";
      toolCallId: string;
      title: string;
      toolKind: string;
      status: string;
      input?: unknown;
      content?: string | null;
      locations?: string[] | null;
    }
  | {
      kind: "tool_call_update";
      toolCallId: string;
      title?: string | null;
      status?: string | null;
      content?: string | null;
      output?: unknown;
    }
  | {
      kind: "plan";
      entries: {
        content: string;
        status: "pending" | "in_progress" | "completed";
        priority?: string | null;
      }[];
    }
  | {
      kind: "permission_request";
      requestId: string;
      toolCallId?: string | null;
      title: string;
      options: {
        optionId: string;
        name: string;
        kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
      }[];
    }
  | { kind: "permission_resolved"; requestId: string; optionId: string | null }
  | {
      kind: "available_commands";
      commands: { name: string; description: string }[];
    }
  | {
      kind: "config_options";
      options: ConfigOption[];
    }
  | { kind: "turn_end"; stopReason: string }
  | {
      kind: "retrying";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      code: ProviderErrorCode;
    }
  | {
      kind: "error";
      message: string;
      detail?: string | null;
      code?: ProviderErrorCode | null;
      retryable?: boolean;
      retryAfterMs?: number | null;
    }
);

export interface AgentDockApi {
  profiles(): Promise<AgentProfileView[]>;
  saveProfile(input: AgentProfileInput): Promise<AgentProfileView>;
  deleteProfile(profileId: string): Promise<void>;
  setSecret(profileId: string, key: string, value: string): Promise<void>;
  clearSecret(profileId: string, key: string): Promise<void>;
  sessions(): Promise<AgentSessionView[]>;
  startSession(input: {
    profileId: string;
    cwd?: string;
    model?: string;
    effort?: string;
  }): Promise<AgentSessionView>;
  sendPrompt(input: {
    sessionId: string;
    content: PromptPart[];
  }): Promise<void>;
  cancelTurn(sessionId: string): Promise<void>;
  retryTurn(sessionId: string): Promise<void>;
  resolvePermission(input: {
    sessionId: string;
    requestId: string;
    optionId: string | null;
  }): Promise<void>;
  setConfigOption(input: {
    sessionId: string;
    optionId: string;
    value: string;
  }): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  history(sessionId: string): Promise<AgentDockEvent[]>;
  terminalWrite(input: { sessionId: string; data: string }): Promise<void>;
  terminalResize(input: {
    sessionId: string;
    cols: number;
    rows: number;
  }): Promise<void>;
  terminalSnapshot(sessionId: string): Promise<string>;
  modelCatalog(input: {
    profileId: string;
    refresh: boolean;
  }): Promise<ModelCatalog>;
  addAttachment(input: {
    sessionId: string;
    source: AttachmentSource;
  }): Promise<AttachmentView>;
  onEvent(cb: (event: AgentDockEvent) => void): () => void;
  onTerminalOutput(
    cb: (event: { sessionId: string; data: string }) => void,
  ): () => void;
}
