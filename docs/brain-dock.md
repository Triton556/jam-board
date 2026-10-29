# Brain dock — in-app agent chat and terminal

Status: design contract for the `feature/brain-dock` increment (ACP chat,
terminal and built-in API chat are implemented; phase 3 — session controls,
attachments and voice input — is specified below and in progress).
Implementation evidence belongs in the version's verification record, not here.

## Why

People plan in Jam Board and talk to their brain agent in a separate window
(Claude Code, Codex, a terminal). Every hand-off is a copied prompt. The brain
dock puts the conversation inside the board: write to the brain from any screen,
attach what you are looking at, see its board changes land live, answer its
permission requests in place.

## Concepts

| Term | Meaning |
|---|---|
| Connection profile | A saved way to reach an agent: a preset (Claude Code, Codex, OpenCode, Claude Code via z.ai / OpenRouter) or a custom command / API endpoint. Non-secret settings only. |
| Runtime kind | `acp` (structured chat over the Agent Client Protocol), `terminal` (the agent's own CLI in a pseudo-terminal) or `api` (built-in chat against an OpenAI-compatible endpoint). |
| Dock session | One running conversation or terminal started from a profile, bound to exactly one board project for its lifetime. |
| Board wiring | ACP/API sessions and known Claude/Codex terminal CLIs receive project-pinned board MCP wiring with a stable profile agent name. Custom terminal commands inherit board environment but require compatible MCP support. |

### Why ACP

[Agent Client Protocol](https://agentclientprotocol.com) is the editor ↔ agent
standard (JSON-RPC over stdio). Claude Code (`@agentclientprotocol/claude-agent-acp`),
Codex (`@agentclientprotocol/codex-acp`), OpenCode (`opencode acp`), Gemini CLI,
Qwen Code, goose and others speak it. One client implementation covers them all,
and `session/new` accepts `mcpServers`, so Jam Board hands its own MCP server to
the agent. ACP already models streaming text, thoughts, tool calls, plans,
permission requests, slash commands, modes/config options, images and audio
prompt content, which keeps later voice/browser/computer features additive.

The terminal kind exists because some people prefer the native CLI UI. It wires
MCP through CLI flags instead of ACP and renders with xterm.js.

The API kind is for providers without an agent CLI. Built-in OpenAI-compatible
chat is implemented and calls the same `jam-board` MCP tools while emitting dock
events. Claude Code endpoint overrides (`ANTHROPIC_BASE_URL` +
`ANTHROPIC_AUTH_TOKEN`) and OpenCode remain alternative provider paths. The phase
labels below describe implementation stages, not an unavailable API runtime.

## Architecture

```text
React dock UI ──invoke/listen──▶ Tauri commands (agent_commands.rs)
                                   │
                                   ▼
                         crates/jam-agents
                ┌──────────────┼───────────────┐
           AcpConnector   TerminalConnector   ApiConnector (implemented)
           (ACP client)   (portable-pty)      (reqwest + rmcp client)
                │               │                   │
      agent subprocess   CLI in a PTY        OpenAI-compatible HTTP
                └───────────────┴─────── jam-board-mcp sidecar (stdio, per session)
```

- `crates/jam-agents` owns profiles, detection, secrets, session lifecycle and
  the event model. It has no Tauri dependency; the desktop crate adapts it.
- Each connector implements one trait (start, prompt, cancel, resolve permission,
  stop, optional terminal I/O) and declares capabilities
  (`chat`, `terminal`, `images`, `audio`, `permissions`, `config_options`).
  New runtimes and input sources (voice → audio content or speech-to-text,
  browser or computer-use MCP servers per profile) plug in without changing the
  dock protocol.
- ACP/known-terminal MCP list includes the always-on session-specific board
  server plus enabled profile servers. API chat also supports enabled extra MCP
  servers; its private board connection retains the `jam-board` name.

## Board wiring

- MCP server entry: stdio, command = the installed sidecar `jam-board-mcp(.exe)`,
  env `JAM_BOARD_PROJECT=<project id>`, `JAM_BOARD_DATA_DIR=<data dir>`,
  `JAM_AGENT_NAME=<profile agent name>` (default `"<Label> · dock"`, editable,
  stable per profile).
- ACP and known terminal launches inject a session-specific server named
  `jam-board-<sanitized project prefix>-<ULID>`; API uses its private
  `jam-board` connection. The context names the injected server. Stale global
  or project entries trigger `agent-launch-warning` with `sessionId`,
  `configPath`, `serverName`, `injectedServerName` and `suggestedFix`;
  the warning is also retained as a status message. The file is not modified.
- MCP project binding occurs once on either initialized or discovery-first
  lifecycles, including first calls without discovery; an HTTP session cannot
  retarget its captured project. Identity precedence is `X-Jam-Agent`,
  `JAM_AGENT_NAME`, initialized client default, request `_meta` client default,
  then `Agent`; identity remains fixed for the session.
- Working directory: the board's saved project folder hint when set; otherwise a
  per-project scratch folder `<data dir>/agent-workspace/<project id>`. The dock
  shows which one is used.
- First prompt of a session is prefixed with a short, visible session-context
  block (project name, key prefix, ID, "read `jam://guide` first"). It is shown
  in the transcript as a collapsible chip, never hidden.
- Authority is unchanged: a chat message is not Start approval, Ready is not
  permission, and execution still requires human direct Start or typed Inbox approval.

## Secrets

API keys and tokens live in the OS credential store (Windows Credential Manager
via `keyring`), service `dev.triton556.jamboard`, account `<profileId>:<KEY>`.
They are injected only into the child process environment, or, for built-in API
chat, only into the `Authorization: Bearer` header. They are never stored
in SQLite or settings, never logged, never returned to the UI (only "set / not
set"), never placed on a command line.

## Tauri contract

All commands return the existing `Result<T, ApiError>` shape. Names are the exact
`invoke` names; arguments are camelCase.

| Command | Args | Returns |
|---|---|---|
| `agent_profiles` | – | `AgentProfileView[]` |
| `save_agent_profile` | `input: AgentProfileInput` | `AgentProfileView` |
| `delete_agent_profile` | `profileId` | `()` |
| `set_agent_secret` | `profileId, key, value` | `()` |
| `clear_agent_secret` | `profileId, key` | `()` |
| `agent_sessions` | – | `AgentSessionView[]` (current project) |
| `start_agent_session` | `input: { profileId, cwd?: string, model?: string, effort?: string, userConfig?: "include" \| "exclude" }` | `AgentSessionView` |
| `agent_model_catalog` | `input: { profileId, refresh?: boolean }` | `ModelCatalog` (phase 3) |
| `add_agent_attachment` | `input: { sessionId, source: AttachmentSource }` | `AttachmentView` (phase 3) |
| `remove_agent_attachment` | `input: { sessionId, attachmentId }` | `()` (phase 3, unsent only) |
| `voice_status` / `voice_settings_save` / `voice_install` / `voice_cancel_install` / `voice_remove` / `voice_transcribe` / `voice_unload` | see "Voice input" | (phase 3) |
| `send_agent_prompt` | `input: { sessionId, content: PromptPart[] }` | `()` |
| `cancel_agent_turn` | `sessionId` | `()` |
| `resolve_agent_permission` | `input: { sessionId, requestId, optionId: string \| null }` | `()` |
| `set_agent_config_option` | `input: { sessionId, optionId, value }` | `()` |
| `stop_agent_session` | `sessionId` | `()` |
| `agent_launch_options` | `profileId` | saved default, exclusion support and description |
| `save_agent_user_config_default` | `choice: "ask" \| "include" \| "exclude"` | saved choice |
| `agent_launch_logs` | `sessionId` | bounded launch events |
| `agent_session_history` | `sessionId` | `AgentDockEvent[]` |
| `terminal_write` | `input: { sessionId, data }` | `()` |
| `terminal_resize` | `input: { sessionId, cols, rows }` | `()` |
| `terminal_snapshot` | `sessionId` | `string` (recent scrollback) |

Events: `agent-dock-event` (payload `AgentDockEvent`),
`agent-terminal-output` (payload `{ sessionId, data }`), and
`agent-launch-warning` (payload described under Board wiring).

### Types (TypeScript view)

```ts
type RuntimeKind = "acp" | "terminal" | "api";
type AgentProfileView = {
  id: string; label: string; kind: RuntimeKind; preset: string | null;
  agentName: string;            // JAM_AGENT_NAME used for this profile
  command: string | null; args: string[]; baseUrl: string | null; model: string | null;
  env: { name: string; value: string }[]; // non-secret extra environment
  hidden: boolean;
  secretKeys: { key: string; label: string; isSet: boolean }[];
  available: boolean; unavailableReason: string | null; // detection result
  builtIn: boolean;             // presets cannot be deleted, only hidden/edited
};
type AgentProfileInput = Partial<Omit<AgentProfileView,
  "available" | "unavailableReason" | "builtIn" | "secretKeys">> & { label: string; kind: RuntimeKind };
type SessionStatus = "starting" | "ready" | "running" | "awaiting_permission" | "stopped" | "failed";
type AgentSessionView = {
  id: string; profileId: string; projectId: string; kind: RuntimeKind;
  title: string; status: SessionStatus; cwd: string; createdAt: string;
  capabilities: { images: boolean; audio: boolean; embeddedContext: boolean; configOptions: boolean };
  model: string | null; effort: string | null; // phase 3: current values, null = agent/provider default
  agentSessionId?: string | null; // native ID when known
};
type PromptPart =
  | { type: "text"; text: string }
  | { type: "board_ref"; uri: string; label: string; text: string } // jam://task/JB-12, jam://frame/<id> …
  | { type: "image"; mimeType: string; data: string }               // base64 (legacy inline image)
  | { type: "attachment"; attachmentId: string };                   // phase 3, see "Attachments"
type AgentDockEvent = { sessionId: string; seq: number; at: string } & (
  | { kind: "launch_step"; step: string; state: "running" | "ok" | "failed" | "skipped";
      message: string; startedAt: string; endedAt: string | null }
  | { kind: "launch_log"; message: string }
  | { kind: "status"; status: SessionStatus; message?: string }
  | { kind: "user_message"; messageId: string; content: PromptPart[]; contextPreamble?: string }
  | { kind: "agent_message_delta"; messageId: string; text: string }
  | { kind: "agent_thought_delta"; messageId: string; text: string }
  | { kind: "tool_call"; toolCallId: string; title: string; toolKind: string; status: string;
      input?: unknown; content?: string; locations?: string[] }
  | { kind: "tool_call_update"; toolCallId: string; title?: string; status?: string;
      content?: string; output?: unknown }
  | { kind: "plan"; entries: { content: string; status: "pending" | "in_progress" | "completed"; priority?: string }[] }
  | { kind: "permission_request"; requestId: string; toolCallId?: string; title: string;
      options: { optionId: string; name: string; kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" }[] }
  | { kind: "permission_resolved"; requestId: string; optionId: string | null }
  | { kind: "available_commands"; commands: { name: string; description: string }[] }
  | { kind: "config_options"; options: { id: string; name: string; value: string;
      category: "model" | "thought_level" | "mode" | string | null; // phase 3
      description?: string;
      values: { value: string; name: string; description?: string }[] }[] }
  | { kind: "auth"; state: "ok" | "required" | "unknown"; label: string }
  | { kind: "turn_end"; stopReason: string }
  | { kind: "error"; message: string; detail?: string; code?: string | null; retryable?: boolean; retryAfterMs?: number | null; resetsAt?: string | null }
);
```

`auth` mirrors the agent's sign-in state when it reports one (for example
`claude-agent-acp` sends `_auth/status_update` with `{ kind: "none", label:
"Not logged in" }`, mapped to `required`). The dock shows a sign-in card with
"Sign in with the CLI" (opens the matching terminal profile) and "Use an API key"
(opens the profile editor).

`board_ref` is sent as an ACP embedded `resource` when the agent advertises
`embeddedContext`, otherwise as a text block. `seq` is per session and strictly
increasing; `agent_session_history` returns the in-memory buffer so a remounted
dock re-renders the same transcript. Chat transcripts are persisted separately from the board database when history
is enabled; terminal agents keep their own session storage.

## Presets (phase 1)

| Preset | Kind | Command | Notes |
|---|---|---|---|
| `claude-code` | acp | `npx -y @agentclientprotocol/claude-agent-acp` | Uses the person's Claude login, or the optional secret `ANTHROPIC_API_KEY`. |
| `codex` | acp | `npx -y @agentclientprotocol/codex-acp` | Uses the person's Codex login. |
| `opencode` | acp | `opencode acp` | Any provider configured in OpenCode (OpenRouter, z.ai, …). |
| `claude-zai` | acp | as `claude-code` | Env `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`; secret `ANTHROPIC_AUTH_TOKEN`. |
| `claude-openrouter` | acp | as `claude-code` | Env `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_API_KEY=""`; secret `ANTHROPIC_AUTH_TOKEN`. |
| `claude-cli` | terminal | `claude --mcp-config <inline json>` | Falls back to `npx -y @anthropic-ai/claude-code` when `claude` is not on PATH. Also the sign-in path (`/login`). |
| `codex-cli` | terminal | `codex -c mcp_servers.<session-name>.command=...` | Needs `codex` on PATH; the board server name is session-specific. |

### Presets (phase 2 — built-in API chat)

| Preset | Kind | Endpoint (editable) | Secret |
|---|---|---|---|
| `api-openrouter` | api | `https://openrouter.ai/api/v1` | `API_KEY` |
| `api-zai` | api | `https://api.z.ai/api/paas/v4` (GLM Coding Plan keys use `https://api.z.ai/api/coding/paas/v4`) | `API_KEY` |
| `api-custom` | api | any OpenAI-compatible `/chat/completions` base URL | `API_KEY` |

The built-in chat streams `/chat/completions` with tool calling. Its tools are the
session's `jam-board` MCP tools (listed from the same per-session sidecar through
an MCP client). Read-only tools run directly; tools that change the board ask
through the same `permission_request` card (allow once / always allow for this
tool in this session / reject). It emits the same dock events as ACP sessions.
`model` is required for API profiles.

For Claude-based presets `baseUrl` maps to `ANTHROPIC_BASE_URL` and `model` to
`ANTHROPIC_MODEL`; other kinds ignore them in phase 1.

Detection checks the executable on PATH (`npx`, `opencode`, `claude`, `codex`);
it never downloads or runs an agent. Endpoint URLs for third-party providers are
editable because providers change them.

## UX

- **Entry:** a "Brain" button in the top bar (left of notifications), shortcut
  `Ctrl+J`. A small dot shows state: working (ink pulse), needs you (coral),
  error (danger).
- **Placement:** a right-side dock that pushes the workspace (not an overlay) at
  ≥ 1100 px window width; resizable 340–720 px; width and open state persist.
  Below 1100 px it overlays as a drawer. The task drawer opens to the left of the
  dock. Esc closes the dock only in overlay mode; in push mode it is a workspace
  panel toggled with Ctrl+J or the Brain button.
- **Tabs:** `Chat` (acp/api sessions) and `Terminal` (terminal sessions). Each
  tab has a session picker and "New".
- **Empty state:** paper illustration, one sentence, the detected profiles with
  status and a primary "Start chat".
- **Transcript:** user notes on the right, agent markdown on the left; thoughts
  collapsed; tool calls as compact rows with kind icon, status and expandable
  details; board keys in agent text and tool output become chips that open the
  task/story/epic; permission requests as inline cards with the agent's options;
  plans as checklists; errors with a recovery action.
- **Composer:** auto-growing textarea; Enter sends, Shift+Enter new line; Stop
  while a turn runs. A context bar above it offers the current view (open task,
  epic, selected canvas notes) as a removable chip; `@` mentions board items; `/`
  lists the agent's commands. Model, effort, access, attachments and voice
  controls follow "Phase 3" below.
- **Composer actions (Round 9):** Send/Stop are icon-only 32 px squares with accessible names Send and Stop; pending Send shows a spinner, aria-busy=true and name Sending…. Enabled tooltips are Send (Enter) / Stop response; disabled Send keeps focusable reasons for empty, voice, readiness, configuration and attachment guards. The row centers 32 px attachment/voice/actions and 32 px-high model/access chips, with 4 px minimum gaps and 12 px composer padding. Restart session remains text at 32 px height and fits at 375 px; model/access labels truncate without wrapping.
  The recording/transcription strip sits above the textarea, keeping the action row anchored; voice-active Send is disabled with a reason. The mic uses the same 32 px square. Sending, cancellation, restart, scoped drafts and execution
  grants retain their existing semantics (AG15 unchanged). R9-A reports scoped
  DOM/Chromium/mock evidence; exact-package native/live checks remain unrun.
- **Board entry points:** "Refine with brain", "Continue in brain chat" and canvas
  "Ask brain" stage an editable prompt and scope/context chips in the dock
  composer through `useBrainDock().compose`. They never send automatically or
  start a session/turn. Refine and continuation keep copy as the secondary path.
- **Terminal:** xterm.js themed with paper tokens and JetBrains Mono; fit on
  resize; Restart/Stop in the header. Start returns a pending session; the first
  fitted size starts the child. A startup overlay remains until the first
  printable output or the 15-second fallback; control sequences alone do not
  imply readiness. OSC titles update the session picker.
- **Launcher and logs:** Starting displays running, OK, failed and skipped
  steps distinctly. Session actions open a readable timestamped launch timeline,
  including adapter stderr and retained warnings, with a secondary raw JSON copy.
  `agent_launch_logs` retains up to 500 bounded, redacted events per session;
  an unconfirmed ACP/terminal MCP connection is skipped, not reported connected.
- **User configuration:** Settings offers Ask every time (default), Always and
  Never. Ask prompts on each ACP/terminal start or resume; Always includes and
  Never excludes without a question, with a chip for a one-launch override.
  Cancel dispatches no launch. API sessions do not load agent user configuration.
  Unsupported custom agents reject exclusion before launch. The backend receives
  an explicit `userConfig` choice for ACP/terminal launches.

### Chat launch, session status and commands (Round 8)

- Package launchers such as npx have a 180-second preparation budget until the
  first complete JSON-RPC message, then a 60-second initialization budget. Other
  executables retain 60 seconds. Preparation and initialize are separate launch
  steps; recognized npm activity updates the preparation text. A timeout names
  the Settings connection: "<Connection> chat didn't start in time"; package
  launchers explain that the first launch downloads the adapter. Retry is explicit,
  Show logs opens retained logs, and technical details stay collapsed initially.
- The context chip shows reported context percentage, or "Context —" when absent.
  Its tooltip gives exact used/capacity tokens and optional cumulative session
  cost; these values are not remaining plan allowance. The chip, Session actions
  → Session status and local /status open the same status surface. It shows
  connection, model, access mode, evidence-based board MCP state/server name,
  global configuration, context/cost and session start time. Unconfirmed fields
  remain unconfirmed. Escape closes it and restores the triggering focus.
- The slash picker contains only adapter-advertised commands. /status always
  opens local status. Exact /usage is sent to the adapter only when advertised,
  as one text block without board preamble, selected context or attachments;
  those staged items and the first normal-message preamble remain available.
  Otherwise /usage opens local usage status. Adapter Markdown renders as an
  ordinary reply. Unknown commands retain the draft and show provider-specific
  guidance without a provider turn.
- Claude status says "Plan limits: type /usage". There is no stable Claude plan
  limit API integrated here; Jam Board displays the adapter's command reply
  without parsing its experimental SDK fields. Codex Plan usage reads only the
  newest rollout for the exact native session under CODEX_HOME/sessions (default
  .codex/sessions), projecting primary/secondary utilization and reset timestamps.
  Missing/incomplete data is unavailable, never borrowed from another session.
  This is a recorded snapshot refreshed on status/log queries (every 15 seconds
  while status is open), not a live quota poll; windows are not assumed to be
  five-hour/weekly.

### User configuration exclusion boundaries

Exclusion is partial and preserves native authentication; it is not a clean home
or full isolation. The launcher displays the backend's exclusion description.

| Runtime | Mechanism | Configuration that may still apply |
|---|---|---|
| Claude CLI | `--setting-sources project,local`, `--strict-mcp-config`, and `--settings` disabling hooks | Global CLAUDE.md, skills/plugins/memory, managed policy and project/local settings. User setting sources remain when auth helpers or env are present, or inspection is unsafe. |
| Claude ACP | `session/new` / `session/load` metadata supplies `settingSources`, `strictMcpConfig` and `disableAllHooks` | Same authentication exception and remaining customizations; the adapter separately resolves global settings for model, permission and auth metadata. |
| Codex CLI | Per-launch `-c` disables MCP entries found in global config, `features.hooks`, `features.codex_hooks` and `notify` | Global AGENTS.md, skills/plugins, model/provider/permission settings, project config, explicit profile/environment overrides and managed policy remain. |
| Codex ACP | Merged `CODEX_CONFIG` JSON session overrides | Same remaining configuration; app-server startup hooks can run before session overrides. |
| API / unknown custom | API has no agent configuration to exclude; unknown custom exclusion is rejected | API profile credentials and board MCP connections remain available. |

## Phase 3 — session controls

Model, effort and access are per-session choices. People switch them often (a
strong model for planning, a cheaper one for routine work), so they live in the
composer, not in the connection editor. The connection editor keeps only the
connection's default model/effort.

### Where the options come from

| Session | Model | Effort | Access |
|---|---|---|---|
| ACP agent (Claude Code, Codex, OpenCode…) | the agent's own config option with category `model` | category `thought_level` | category `mode` |
| Claude Code via a provider (`claude-zai`, `claude-openrouter`, any Claude preset with `baseUrl`) | start-time model → `ANTHROPIC_MODEL`; in-session changes use what the agent exposes | as ACP | as ACP |
| Built-in API chat | provider catalog (see below), applied to the next request | provider effort style (see below) | none — write tools always ask through permission cards |
| Terminal | none — the CLI has its own `/model` | none | none |

- For ACP sessions the dock renders exactly what the agent exposes and never
  invents values. Unknown categories go under a "More" menu. Changes go through
  `set_agent_config_option` and apply from the next turn.
- For API sessions the backend emits synthetic `config_options` events
  (`model`, and `thought_level` when the chosen model supports reasoning), so
  the UI has one code path.
- If an agent combines model and effort in one option (some Codex builds list
  `model (high)` values), the dock shows one chip.
- Observed in `claude-agent-acp` 0.95.0: `model` (category `model`), `effort`
  (`thought_level`), `mode` (`mode`: `default`, `acceptEdits`, `plan`, `auto`,
  conditionally `bypassPermissions`), optional `fast` (`model_config`) and
  `agent` (no category). `model_config` options render as switches inside the
  Model · Effort popover ("Fast mode"); options without a category go under
  "More".
- Image attachments carry `previewUrl` (scoped media URL) for display; the
  inline `thumbnail` exists only for small images.

### Effort for API chat

Profile field `effortStyle: "openrouter" | "zai" | "openai" | "none"` (presets
set it; `api-custom` defaults to `none` so unknown providers never get an
unsupported parameter).

| Style | Values shown | Request field |
|---|---|---|
| `openrouter` | Auto, Low, Medium, High | `reasoning: { effort }`; Auto omits it |
| `openai` | Auto, Low, Medium, High | `reasoning_effort`; Auto omits it |
| `zai` | Auto, Thinking on, Thinking off | `thinking: { type: "enabled" \| "disabled" }`; Auto omits it |
| `none` | control hidden | – |

The effort control is hidden when the catalog says the model has no reasoning
support.

### Model catalog

`agent_model_catalog({ profileId, refresh })` →
`{ models: ModelInfo[]; source: "provider" | "static" | "profile"; fetchedAt: string | null; error: string | null }`,
`ModelInfo = { id, name, contextLength?, inputImage: boolean, reasoning: boolean, tools: boolean, promptPricePerM?: string, completionPricePerM?: string }`.

- OpenRouter: `GET {baseUrl}/models` (works without a key). `tools`,
  `reasoning` and `inputImage` come from `supported_parameters` and
  `architecture.input_modalities`. Only tool-capable models are listed by
  default (the brain needs the board tools); "Show all models" lifts the filter.
- z.ai and custom: `GET {baseUrl}/models` with the key; on failure, a short
  static list (z.ai) or the profile model plus recents, with `error` set.
- Cached on disk for 24 h per profile; "Refresh" re-fetches. Free-text model
  IDs are always allowed ("Use “x”").

### UI

- **New chat** (`+` in the dock header and the empty state's primary action)
  opens a compact launcher: Connection, Model (searchable: Recent, Starred,
  then catalog), Effort, and Start. It remembers the last model/effort per
  connection. For ACP agents the lists come from the last session of that
  connection (cached in the UI store); after the session is ready the dock
  applies the chosen values with `set_agent_config_option` if the agent still
  offers them. First-ever start shows "Agent default".
- **Composer toolbar**, left to right: Attach, Voice, flexible gap, one
  **Model · Effort** chip (popover with the searchable model list and an effort
  segmented control), one **Access** chip (shield icon + short label), Send/Stop.
  Chips are 28 px high, truncate with a tooltip, and are hidden when the
  session does not expose that category.
- **Access** explains itself. Known values get plain labels and one-line
  descriptions; unknown values use the agent's own name and description:

  | Agent value | Label | Description |
  |---|---|---|
  | Claude `default` | Ask first | Asks before editing files, running commands or changing the board. |
  | Claude `acceptEdits` | Auto-edit files | Edits files without asking; asks for everything else. |
  | Claude `plan` | Plan only | Reads and proposes a plan; changes nothing. |
  | Claude `auto` | Auto | the agent's own description |
  | Claude `bypassPermissions` | Full auto | Never asks. Use only in a throwaway workspace. (danger tone) |
  | Codex read-only / auto / full-access | Read only / Ask first / Full auto | as the agent describes |

  Access never grants board Start; board authority rules are unchanged.
- A change of model, effort or access after the first message adds a quiet
  divider to the transcript ("Model → GLM-4.6 · High").
- The session picker and header show the connection and the current model.

## Phase 3 — attachments

People hand the brain images and files ("find more like this and build a
moodboard"), so the composer accepts them and every runtime gets them in the
best form it supports.

- Add: the Attach button (OS file dialog, multi-select), Ctrl+V of images or
  files, dropping files onto the dock (overlay "Drop to attach"). Dragging
  canvas items or frames onto the composer adds `board_ref` chips instead.
- `add_agent_attachment({ sessionId, source })`, `AttachmentSource =
  { kind: "path"; path } | { kind: "bytes"; name; mimeType; data /* base64 */ }`
  → `AttachmentView = { id, name, mimeType, size, path, isImage, thumbnail: string | null /* data URL ≤ 64 KB */, previewUrl: string | null /* scoped media URL for images */ }`.
  Files are copied to `<data dir>/agent-attachments/<sessionId>/` and removed
  when the session is deleted. Prompts reference them as
  `{ type: "attachment", attachmentId }`.
- Limits: 20 MB per file, 10 files and 50 MB per message. Refusals are shown on
  the chip before sending, never as a failed turn.
- Transport:
  - ACP: images → `image` block when the agent advertises `image`, else
    `resource_link`. Text-like files ≤ 256 KB → embedded `resource` when the
    agent advertises `embeddedContext`, else `resource_link`. Everything else →
    `resource_link` (`file:///` absolute path, name, MIME type, size). The agent
    reads it with its own tools; reading outside its working directory may
    trigger its own permission prompt — expected.
  - API chat: images → `image_url` data URL when the model's catalog entry has
    `inputImage`; otherwise the chip says "This model can't see images — pick
    a vision model". Text-like ≤ 256 KB → a text part with the file name and a
    fenced block. Other files → "Not supported in API chat — use an agent
    connection".
  - Terminal: dropping a file types its quoted absolute path.
- Composer row above the text: 56 px thumbnails for images, pills
  (name · size) for files, remove ×, progress while copying.
- Transcript: the user message shows the same thumbnails/pills; clicking an
  image opens a lightbox. Image attachments have a hover action **Add to
  canvas**, which creates a copied image reference in the current project.
- The attachment path is visible to the agent, so it can place the original on
  the board with `add_reference { kind: "asset", filePath, copy: true }` (see
  [canvas references](canvas-references.md)).

## Phase 3 — voice input

Dictation into the composer, fully local. The agent receives text, not audio,
in this phase; audio prompt content stays a later option.

- **Engine.** `crates/jam-voice` defines a `SpeechToText` trait
  (`status`, `install`, `transcribe`, `unload`). The first engine is local
  whisper.cpp, run as an on-demand sidecar (`whisper-server`) that the app
  downloads only when the person turns voice on. Nothing is bundled in the
  installer. A cloud engine (OpenAI-compatible `/audio/transcriptions`) can be
  added later without UI changes.
- **Models** (Hugging Face `ggerganov/whisper.cpp`):

  | Choice | File | Disk | Memory while loaded | Notes |
  |---|---|---|---|---|
  | Fast (recommended without NVIDIA GPU) | `ggml-small-q5_1.bin` | ~190 MB | ~0.5 GB | fine for English, weaker Russian |
  | Balanced (recommended with NVIDIA GPU) | `ggml-large-v3-turbo-q5_0.bin` | ~574 MB | ~1 GB | good Russian and English |
  | Best | `ggml-large-v3-turbo.bin` | ~1.6 GB | ~2 GB | most accurate, slower on CPU |

  Runtime: the whisper.cpp Windows release zip (`v1.9.2`; the CUDA build when an
  NVIDIA GPU is present and Device is Auto or GPU, otherwise the CPU build).
  Measured on an RTX 4060 laptop: CUDA ready ≈ 1.6–3 s, Balanced inference
  ≈ 0.4 s for 8.6 s of speech; CPU (Ryzen 5 7535HS) Balanced ≈ 22–28 s, Fast ≈ 7 s
  (encoder-bound). So the recommended model depends on the device: Balanced on
  GPU, Fast on CPU-only machines; `VoiceStatus.recommendedModel` carries it and
  Settings marks it "Recommended for this computer". Choosing Balanced on CPU
  shows "Slow on this computer (about 3× the recording length)". Server flags:
  CPU `-t min(8, physical cores) -fa --no-gpu`; GPU `-t 4 -fa`. The release tag
  and asset names are one pinned constant. Downloads show progress, can be
  cancelled, resume where possible, and are verified against the SHA-256 the
  host publishes (GitHub asset `digest`, Hugging Face `X-Linked-Etag`) when
  available.
- **Load and idle cost.** The server starts loading when a recording starts
  (`voice_prepare()`, idempotent, counts as use), so the model loads while the
  person speaks; hovering or opening the popover never loads it. It binds
  `127.0.0.1` on a free port and exits after
  `idleUnloadMinutes` without use (default 10), when voice is turned off, and
  on app exit. While loaded and idle it uses near-zero CPU (measured ≈ 0.002 %) and memory
  (table above; ≈ 632 MiB measured for Balanced);
  unloaded it costs nothing. CPU/GPU work happens only while transcribing.
- **Capture.** In the webview: `getUserMedia`, mono, resampled to 16 kHz 16-bit
  PCM WAV in an AudioWorklet; at most 120 s per take. Audio stays in memory or a
  temp file and is deleted after transcription; it is never sent elsewhere.
- **Vocabulary hint.** Each transcription passes an initial prompt with the
  project name and up to 30 recent board keys/titles so names are recognised.
- **Mic button** (composer). States: off (muted glyph), not installed, downloading
  (progress ring), warming up, ready, recording (coral, live level, timer),
  transcribing (spinner in the composer), error. Click toggles recording;
  `Ctrl+Space` toggles while the composer is focused; `Esc` cancels a take. The
  text is inserted at the caret, never sent automatically.
- **Hover popover** on the mic: "Voice input", a status line ("Local Whisper ·
  Balanced · ready" / "Not downloaded · 550 MB"), an on/off switch, the primary
  action (Download / Start dictation), the shortcut, and "Voice settings…".
- **Settings → Voice**: Enabled; Model (Fast / Balanced / Best with sizes,
  Install / Remove, disk used); Device (Auto / CPU / GPU); Language (Auto /
  Russian / English); Unload after (5 / 10 / 30 min / Never).
- **Tauri:** `voice_status() → VoiceStatus`; `voice_settings_save(input) →
  VoiceStatus`; `voice_install({ model, device })` with `voice-install-progress`
  events `{ phase: "runtime" | "model", received, total }`;
  `voice_cancel_install()`; `voice_remove({ model? })`;
  `voice_prepare()` (start loading; returns immediately);
  `voice_transcribe({ wavBase64, language?, initialPrompt? }) → { text, durationMs }`
  (waits for loading if needed); `voice_unload()`. `voice_status` never loads or
  keeps the model alive.
  `VoiceStatus = { enabled, engine: "local-whisper", model: "fast" | "balanced" | "best",
  installedModels: string[], runtimeInstalled: boolean, device: "auto" | "cpu" | "gpu",
  gpuAvailable: boolean, recommendedModel: "fast" | "balanced",
  language: "auto" | "ru" | "en", idleUnloadMinutes: number | null,
  state: "off" | "not_installed" | "installing" | "idle" | "loading" | "ready" | "error",
  error: string | null, diskBytes: number }`.

## Phase 3 — Brain button

The top-bar button uses the `BrainGlyph` icon (half brain, half node network)
and the shared `Tooltip`: first line "Brain chat · Ctrl+J", second line the
live state ("Claude Code · working", "Needs you", "Error — open to see").

## Mock bridge

`VITE_MOCK_BRIDGE=1` exposes model + effort + access options with
descriptions, a model catalog (with vision/reasoning flags), attachments with
thumbnails, and voice with fake download progress and a canned transcription,
so every phase-3 state can be reached in a browser.

## Phase 4 — history and resume

People come back to a conversation after a restart, so dock sessions are kept
and can be resumed.

- Every ACP and API session gets a local history entry:
  `<data dir>/agent-history/<projectId>/<entryId>.json` (metadata) and
  `<entryId>.events.jsonl` (the same `AgentDockEvent`s the dock rendered). Not in
  the board database, not in exports. Terminal launches also create local history
  records; native CLI transcripts remain in CLI storage. Events
  never contain secrets by construction; what people type is theirs.
- Settings → Agents: "Keep chat history" (on by default) and "Clear history for
  this project".
- `HistoryEntry = { id, projectId, profileId, profileLabel, kind: "chat" | "terminal",
  provider, empty, title, createdAt, updatedAt, model, effort, agentSessionId: string | null,
  resumable: "native" | "transcript" | "none", messageCount }`.
- Commands: `agent_history({ limit?, query? })` → `HistoryEntry[]` (current
  project, newest first); `agent_history_events({ entryId })` →
  `AgentDockEvent[]`; `resume_agent_session({ entryId, userConfig? })` → `AgentSessionView`;
  `rename_agent_history({ entryId, title })`; `delete_agent_history({ entryId })`.
- Resume:
  - ACP agent advertising `loadSession`: start the agent with the same cwd and
    MCP wiring and call `session/load` with `agentSessionId`; the agent replays
    its history; the dock shows the replay plus a divider "Resumed <date>" and
    keeps appending to the same entry (`resumable: "native"`).
  - Terminal: Claude links by its assigned native UUID (`--session-id` on a
    new launch); Codex links by cwd and nearest launch time within 120 seconds,
    rejecting ties. Claude's project folder rule replaces each non-ASCII-
    alphanumeric UTF-16 unit with a hyphen; slugs longer than 200 characters use
    the first 200 plus a hyphen and the absolute signed 32-bit UTF-16 hash in
    base36. If the expected path is missing (including a stale cached path), scan
    immediate project folders only for the exact assigned session UUID filename.
    Codex reads the rollout's first session_meta line and normalizes Windows case,
    verbatim prefixes, UNC, slashes and trailing separators while preserving Unix
    case sensitivity. Existing history load and startup reconciliation relink
    alpha.44 empty entries when transcripts become discoverable, without changing
    transcript bytes. Resume creates a new dock session via `claude --resume` or
    `codex resume` using the saved native ID and cwd; Claude resume does not
    assign a new native ID. Missing transcripts and duplicate active resumes
    fail clearly. Deleting a history entry leaves CLI transcripts untouched.
  - API chat: rebuild the message list from the stored transcript (user text,
    assistant text, tool calls and results; results over 8 KB truncated with a
    note) and continue (`resumable: "transcript"`).
  - ACP agent without `loadSession`: read-only transcript (`resumable: "none"`)
    with "Continue in a new session", which starts a session and **stages** (never
    sends) an editable summary prompt: the last user messages and the final agent
    answer.
- Title: first line of the first user message (≤ 60 characters), renameable.
- UI: **History** is a top-level tab with Chat / Terminal filters, search and
  rows showing provider, model, relative time and resume capability. Row menus
  offer Rename and Delete with Undo. Starting/running project terminals appear
  immediately with a Running badge, even before the history query completes;
  opening one focuses its existing tab without Resume or a duplicate launch.
  Only ended terminals without a user transcript are hidden, because an unused
  shell is not a conversation to resume. Stopped linked conversations offer
  Resume. Terminal detail is a summary, not an imported chat transcript. Opening
  a past entry never starts a process until explicit Resume. The session picker groups Active / Stopped,
  shows title, status, start time and workspace, and can clear stopped rows.

## Phase 4 — tools per connection (MCP servers)

- The connection editor gets a **Tools** section: the MCP servers attached to
  this connection, each with a switch. Jam Board is always on and not
  removable; ACP and CLI server names vary per session.
- Presets, all off by default:
  - **Web (Jam Board)** — the bundled `jam-web-mcp` sidecar (below).
  - **Browser** — Playwright MCP (`npx -y @playwright/mcp@latest`): the agent
    opens and drives its own separate browser.
  - **Desktop (advanced)** — a desktop-control MCP command the person supplies;
    no bundled default; danger notice "The agent can see and control your
    screen. Turn it on only while you need it."
  - **Custom** — stdio command/args/env, or an HTTP URL with an optional bearer
    secret kept in the credential store.
- Applied to ACP sessions (`session/new` `mcpServers`), Claude/Codex terminal
  CLIs (their MCP flags) and, new in this phase, built-in API chat through a
  multi-server MCP client.
- API chat tool names are `<server>__<tool>`. Permission: jam-board read-only
  tools run directly as today; other servers' tools run directly only when the
  tool carries the MCP annotation `readOnlyHint: true` **and** the server's
  "Trust read-only tools" is on (default on for the Web preset, off otherwise);
  everything else goes through the permission card.
- Profile `extraMcpServers[]` gains `enabled`, `preset`, `trustReadOnly`, and an
  `http` variant `{ url, bearerSecretKey? }`.

## Phase 4 — web tools (`jam-web-mcp`)

A bundled stdio MCP server (crate `crates/jam-web-mcp`, shipped as a sidecar
like `jam-board-mcp`) so any connection — including API chat via OpenRouter or
z.ai — can search the web and collect images, e.g. for the moodboard loop in
[canvas references](canvas-references.md).

- Tools:
  - `web_search { query, kind: "web" | "images", count?: 1..20 }` →
    `{ title, url, snippet?, imageUrl?, thumbnailUrl?, width?, height?, source }[]`
    (`readOnlyHint`).
  - `read_page { url, maxChars?: ≤ 50 000 }` → readable text, title, og:image
    (`readOnlyHint`).
  - `download_image { url, filename? }` → `{ path, mimeType, bytes, width?,
    height?, sourceUrl }` saved under `JAM_WEB_DOWNLOAD_DIR`
    (`<data dir>/web-downloads/<projectId>/`); it writes a file, so it is not
    read-only.
- Search providers (`JAM_WEB_PROVIDER`): `brave` (web + image search, secret
  `BRAVE_API_KEY`) and `tavily` (web + images, secret `TAVILY_API_KEY`). Keys
  live in the credential store and are injected only into this child's
  environment. Settings → Agents → **Web search**: provider, key (set / not set),
  "Test". Without a provider `web_search` returns a clear error;
  `read_page` and `download_image` still work.
- Safety: http/https only; every hop (≤ 3 redirects) must resolve to a public
  address (no loopback, private, link-local, CGNAT, multicast); 15 s timeout;
  `read_page` reads ≤ 2 MB, text only; `download_image` requires an `image/*`
  type, ≤ 15 MB, and a recognised PNG/JPEG/WebP/GIF/AVIF signature; user agent
  `JamBoard/<version>`.

## Phase 4 — cloud speech engine

- Settings → Voice → **Engine**: Local Whisper (default) / Cloud.
- Cloud = any OpenAI-compatible `/audio/transcriptions` endpoint. Presets: Groq
  (`https://api.groq.com/openai/v1`, default model `whisper-large-v3-turbo`),
  OpenAI (`https://api.openai.com/v1`, default model `gpt-4o-mini-transcribe`),
  Custom (base URL + model). Model is editable; key in the credential store
  (`voice:<provider>:API_KEY`).
- The popover status line and Settings say "Audio is sent to <provider> for
  transcription." `voice_prepare` is a no-op; nothing to unload.
- `VoiceStatus` gains `engine: "local-whisper" | "cloud"` (already a field) and
  `cloud: { provider: "groq" | "openai" | "custom", baseUrl, model, keySet } | null`;
  `voice_settings_save` accepts the engine and cloud fields; new
  `voice_set_cloud_key({ provider, key })` and `voice_clear_cloud_key({ provider })`.
- Errors in plain words: 401 → "Check the API key"; 413 → "Recording too long for
  this provider"; network → "Can't reach <provider>".

## Phase 4 — provider errors and retry

Providers fail transiently (rate limits, "model at capacity", dropped streams).
The dock says what happened in plain words and offers the next step.

- `error` events gain `code: "usage_limit" | "rate_limited" | "overloaded" | "auth" |
  "context_too_long" | "network" | "provider" | "agent" | null`,
  `retryable: boolean`, `retryAfterMs: number | null` and optional `resetsAt`. Classification uses
  HTTP status (429, 503, 529, 401/403, 413), provider error bodies (e.g. "at
  capacity", "overloaded", "rate limit", context length) and ACP error data.
- **API chat auto-retry**: a model request that fails before any output with a
  retryable code is retried automatically up to 2 times (backoff 2 s, then 6 s,
  or `Retry-After` when ≤ 30 s). Each wait emits
  `{ kind: "retrying", attempt, maxAttempts, delayMs, code }`. Tool calls that
  already ran in the turn are never re-executed; only the model request repeats.
  A stream that fails after output started is not retried automatically.
- **Usage limits** are non-retryable, including structured Codex and quota
  responses. No automatic retry or Retry action is offered; show the localized
  reset time when known and offer Switch connection. Ordinary throttling remains
  distinct and may be retryable.
- **ACP agents** handle their own transient retry behavior; the dock does not
  automatically retry a usage-limit failure and shows the final error.
- **Error card** in the transcript: plain title by code ("The model is busy right
  now", "Rate limit reached", "Check the API key or sign in", "The conversation is
  too long for this model", "Can't reach the provider"), the provider's own text
  under "Details", and actions:
  - **Retry** — `retry_agent_turn({ sessionId })` re-sends the last user message
    with its attachments and context (API chat discards the failed partial
    answer); disabled with a countdown while `retryAfterMs` runs.
  - **Switch model** — opens the Model · Effort chip (shown for `overloaded`,
    `rate_limited`, `context_too_long`).
  - **Sign in / Add key** for `auth` (existing auth card).
- While an auto-retry waits, the composer shows "Retrying in 6 s (2/3)…" with
  Stop, and the Brain button state stays "working".

## Testing

Workers and automated checks never start real agent sessions or send provider
prompts. Use guarded fake executables, scripted MCP clients and recorded terminal
streams. Live installed-agent checks are owner-only under separate authorization.
Record source, DOM/mock, browser, native package and human observations separately.
The round-7 terminal rendering changes have not reproduced the owner's original
Cyrillic/scroll symptoms; a fix is not established by those fixture checks.

## Later (kept in mind, not built)

Audio prompt content for agents that accept it, multi-agent views, a bundled
desktop-control MCP server.
