# Jam Board MCP

Plan your project with your AI teammates. Both transports invoke the same `jam-core` services and SQLite transactions as the desktop application. There is no cloud service, account, or telemetry.

## Build and connect

From the repository root:

```powershell
cargo build -p jam-mcp-cli
$env:JAM_BOARD_DATA_DIR = Join-Path (Get-Location) '.dev-data'
.\target\debug\jam-board-mcp.exe --seed-demo
```

`--seed-demo` explicitly creates a new demo jam before serving stdio. Omit it for normal use. The process waits for MCP input; human-readable logging goes to stderr and `<data-dir>/logs/mcp-stdio.log`. stdout contains only JSON-RPC protocol messages. Closing stdin terminates the process.

Database lookup order:

1. `--db <path>` (a database file, not a directory).
2. `JAM_BOARD_DB`.
3. `JAM_BOARD_DATA_DIR/jam.db`.
4. `%APPDATA%/dev.triton556.jamboard/jam.db`.

Use an absolute development data path in agent configuration because clients may start the process from another working directory. Real Codex/Claude configuration files are never edited by this project.

### Codex: stdio (installed application)

```toml
[mcp_servers.jam-board]
command = "C:\\Users\\<you>\\AppData\\Local\\Jam Board\\jam-board-mcp.exe"
env = { JAM_AGENT_NAME = "Codex", JAM_BOARD_PROJECT = "<project-id>" }
```

### Codex: HTTP (desktop must be open)

```toml
[mcp_servers.jam-board-http]
url = "http://127.0.0.1:47321/mcp"
bearer_token_env_var = "JAM_BOARD_TOKEN"
http_headers = { "X-Jam-Agent" = "Codex", "X-Jam-Project" = "<project-id>" }
```

Set `JAM_BOARD_TOKEN` in the environment inherited by the client to the token copied explicitly from Settings → Agents. Do not commit the token. `bearer_token_env_var` and `http_headers` are supported by the [official Codex MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

### Claude Code: stdio

```powershell
claude mcp add jam-board --env JAM_AGENT_NAME=Claude --env JAM_BOARD_PROJECT=<project-id> -- '<path-to-installed-jam-board-mcp.exe>'
```

### Claude Code: HTTP

```powershell
claude mcp add --transport http jam-board http://127.0.0.1:47321/mcp --header "Authorization: Bearer <token>" --header "X-Jam-Agent: Claude" --header "X-Jam-Project: <project-id>"
```

The name-before-`--env` stdio form and HTTP header form follow the [official Claude Code MCP guide](https://code.claude.com/docs/en/mcp). Replace `<token>` locally; if the default port is occupied, use the actual port stored in `settings.mcp_http_port`. These are instructions for the user, not commands that this implementation runs against real agent configuration.

Replace the executable path with the absolute path shown in Settings → Agents. TOML does not expand %LOCALAPPDATA%; the example is a placeholder, not a literal path to paste unchanged. Installed stdio needs no data override. For development, add JAM_BOARD_DATA_DIR pointing at <checkout>/.dev-data. The default data folder is %APPDATA%\dev.triton556.jamboard.

### Connect, appoint, then authorize

1. Choose the intended project in **Projects**, then open **Settings → Agents**.
   Its displayed name and key identify the configuration you are about to copy.
2. Choose one transport, apply the configuration in your agent client yourself,
   and restart/reconnect that session. Snippets share a connection name: replace
   the old entry intentionally, or keep different boards in separate client
   configurations/sessions; do not paste duplicate TOML entries.
3. Copy the project's read-only check. It calls `get_session_context` first and
   verifies the exact project ID/key prefix before `get_project`/`get_board`.
   Copying a prompt or configuration is not proof that a connection succeeded.
4. In **Plan**, open an epic and choose its **Brain**. The connected agent appears
   after its first board call. Appoint it separately for each epic it coordinates.
   When there is no epic yet, draft one with the agent first. An agent may use
   `become_brain` for an unassigned epic only after the human appoints it; it must
   not overwrite another brain's appointment.
5. Prepare a planning prompt; refine questions, stories and tasks together. Brain
   appointment, Active plan status and Ready tasks do not grant execution. Start
   the chosen Story/Epic explicitly in Plan, or approve the brain's typed Inbox
   request. The board never launches an operating-system agent process for you.

Switching the app's board only changes the UI; existing MCP sessions remain pinned.
To connect another project, repeat steps 1–3 with that project's configuration.
After a version upgrade, refresh cached tools and reread task/report evidence before
new actions. Never repair a rejected stale payload by silently filling new tokens.

The [optional playbook compatibility note](agent-playbook-compatibility.md) separates
workflow instructions from this version's calling contract. Installing that skill
is not required for MCP, does not configure the connection, and cannot certify that
older examples match the live tool schemas.

## Transports and authentication

`jam-board-mcp` uses rmcp stdio. The desktop owns the Streamable HTTP server; it runs only while the desktop is open and `mcp_http_enabled=true` (the default). It binds exclusively to IPv4 loopback, `/mcp`, initially port 47321. Occupied ports fall back through 47322–47330; a successful port is persisted and preferred on restart.

Every HTTP request, including initialize, GET/SSE and DELETE, requires `Authorization: Bearer <token>`. Missing/incorrect credentials return HTTP 401. If Origin is present, it must be `http://127.0.0.1:<port>` or `http://localhost:<port>` with a valid numeric port; all other values return 403. Absence of Origin is permitted for native clients. The token file contains 32 cryptographically generated bytes encoded as base64url without padding (43 characters), created once and reused.

MCP lifecycle and framing are handled by [rmcp 3.5.1](https://docs.rs/rmcp/3.5.1/rmcp/). The integration suite exercises `initialize` with protocol 2025-06-18, alongside rmcp's supported version negotiation. No bespoke JSON-RPC server is used.

## Project binding

The desktop can keep several projects and stores the explicitly selected project across restarts. Each MCP connection is pinned **once, during initialization**, independently of that selection:

- stdio: `--project <id-or-key-prefix>`, then `JAM_BOARD_PROJECT`, then the desktop's selected project at initialization;
- HTTP: the initialization request's `X-Jam-Project: <id-or-key-prefix>` header, or the selected project at initialization.

Use Settings → Agents to copy a configuration containing the current project's immutable ID. `get_session_context` is the source of truth for a connected agent. To work on another project, open another connection or reconnect with its ID. Changing the desktop selector, subsequent HTTP headers, or another agent's selection cannot retarget an existing connection. An unknown/archived project or missing selection fails initialization rather than silently choosing another project.

All bound task, hierarchy, question, reference, asset and activity operations reject foreign-project addresses, including long-poll waits and resources. A session may continue on its exact project after archive/restore, but operations while archived fail. Archiving is refused while any task is In progress, including individually archived cards; submit their reports or release the claims first. Archive/restore preserves task statuses and individual archive flags. Historical exports made before project selection remain importable.

Agent identity profiles (name, handle and color) remain shared for compatibility; membership, online heartbeat and handwritten status are project-specific. An agent in another project does not appear online on the selected board. HTTP identity is also fixed at initialization, not changeable by a later header. The local database and bearer token still have their existing trust model: project pinning prevents accidental redirection, not authentication against the database owner.

## Identity and presence

The initialized `clientInfo.name` determines the client kind: names containing `codex` map to `codex`, containing `claude` to `claude-code`, otherwise `other` (case-insensitive). Stdio `JAM_AGENT_NAME` or HTTP `X-Jam-Agent` overrides the display name. Defaults are `Codex`, `Claude`, or `clientInfo.name`.

An unknown agent handle is registered with `member.joined`, taking the first unused member color. Each call refreshes `lastSeenAt`. Agents are online for 120 seconds after their latest call. Handles are stable across sessions; a human handle cannot be impersonated by registering an agent with the same name. See [architecture](architecture.md#local-security-and-retained-data) for the local security model.

## Breaking changes in v0.2

- Exactly three levels: Epic > Story > Task. create_task requires storyKey; a task always has a story. Existing tasks migrate under an active Imported tasks epic/story without changing keys or Notes.
- The five task statuses are backlog, ready, in_progress, review, done. Legacy todo becomes backlog, because the old tasks have no complete brief. Creation and release default to backlog.
- Workers claim Ready tasks only. mark_ready and moves into Ready validate the brief; only a human or the appointed epic brain can override, with a recorded reason. Workers submit_report; a separate human/brain review accepts work or requests another round. Workers cannot review their own task, even when appointed brain.
- description/descriptionMd remains free-form Notes. The playbook brief is a separate object in get_task and separate top-level input fields in create_task/update_task_brief. Arrays replace whole lists.
- Task summaries add storyId, storyKey, epicId, epicKey, epicColor (m1..m6), ready (brief readiness, independent of status), changesRequested, needsInfo, reviewRound. Activity adds epicId and a shared English sentence. Member results add statusText, statusScope, statusAt and statusStale.
- V2.2 refines needsInfo: a task flag and the list_tasks needsInfo filter cover only open questions scoped to that task. Story and epic questions stay at their own level. get_task adds ancestorQuestions (open story/epic questions); jam://task/{key} renders them under "Open questions above this task". Project questions remain Inbox items. This prevents an epic interview from flagging every card.
- JSON exports use version 2 to retain hierarchy, briefs, reports, reviews, questions and references. Version-1 imports remain supported.

## Tool contract (44 tools)

All argument objects use camelCase, reject unknown properties and have schemars JSON Schemas. Entity addresses use project keys: JB-E1, JB-S1, JB-12. Scope is { type: "project" | "epic" | "story" | "task", id: string }; id can be the entity key or ULID, and an empty project id means this session’s pinned project, not the board currently displayed in the UI. Reference items/questions use their returned IDs.

Success contains structuredContent plus a one-line content summary. Failures are tool results with isError: true, readable content and structuredContent { code, message, field? }, never a protocol error or a process exit. Codes: not_found, validation, not_ready, execution_required, wrong_status, claim_conflict, stale_claim, forbidden, archived, conflict. Infrastructure failures are reported as validation failures with their diagnostic text; HTTP authentication still uses HTTP 401/403.

| Tool | Arguments | structuredContent |
|---|---|---|
| get_session_context | {} | { projectId, keyPrefix, projectName, binding: "session", canSwitchProject: false, latestActivityCursor } |
| get_execution | scope: { type: "epic" or "story", id } | ExecutionState, including effectiveState, ownState, revision and scope identity |
| list_execution | {} | ExecutionState[] for the pinned project |
| request_execution | scope: { type: "epic" or "story", id }, reason | ExecutionRequest (pending); appointed epic brain only |
| list_execution_requests | status? (pending/approved/declined/superseded) | ExecutionRequest[] for the pinned project |
| get_project | {} | { jam, template, templateLabel, milestoneAt, tagSuggestions, epics, stories, tasks, openQuestions } |
| get_board | {} | { jam, columns, inProgress, myTasks, onlineAgents, tagSuggestions, openQuestionCount } |
| list_epics | {} | Epic[] in position order, excluding archived |
| get_epic | key | { epic, stories: [{ story, tasks: [{ task, readiness }] }], journal, openQuestions } |
| create_epic | title; color?, goalMd?, doneWhenMd?, notIncludedMd?, decidedMd?, openQuestionsMd?, participation?, reviewer?, workerModel? | Epic (draft) |
| update_epic | key; any create field except title may be omitted, title? | Epic |
| set_epic_status | key, status; overrideReason? | Epic |
| become_brain | epicKey | Epic; claims an unappointed brain slot |
| set_brain | epicKey, memberHandle | Epic; human/current brain only |
| create_story | epicKey, title; outcomeMd?, basisMd?, preserveMd?, scaleMd?, rejectionRisksMd?, openDecisionsMd?, acceptance? | Story (draft) |
| update_story | key; title?, any intent field?, acceptance? | Story |
| set_story_status | key, status; overrideReason? | Story |
| create_task | storyKey, title; description?, status?=backlog, priority?=medium, tags?, estimate?, dueAt?, idempotencyKey?, all brief fields? | TaskDetail |
| update_task | key, expectedClaimGeneration, expectedUpdatedAt; title?, description?, priority?, tags?, estimate?, dueAt? | TaskDetail; non-brief fields |
| update_task_brief | key, expectedClaimGeneration, expectedUpdatedAt; goalMd?, contextMd?, whereMd?, changes?, tests?, boundariesMd?, resultMd?, userQuotesMd? | TaskDetail |
| check_ready | key | { ready, missing: [{ code, message }] } |
| mark_ready | key, expectedClaimGeneration, expectedUpdatedAt; overrideReason? | TaskSummary |
| list_tasks | status?: string[], assignee?, tag?, query?, includeArchived?=false, limit?=50, cursor?, epic?, story?, ready?, changesRequested?, needsInfo? | { tasks, nextCursor? } |
| get_task | key | TaskDetail with hierarchy/context, brief, references, assets, all reports/reviews, comments/history |
| claim_task | key, expectedClaimGeneration, expectedUpdatedAt | TaskDetail; assigns caller and moves Ready > In progress |
| release_task | key, expectedClaimGeneration; status?=backlog | TaskSummary; current holder/human only |
| move_task | key, status, expectedClaimGeneration, expectedUpdatedAt; beforeKey?, afterKey?, overrideReason? | TaskSummary |
| submit_report | key, expectedClaimGeneration, summaryMd, changedFiles, tests; deviationsMd?, notVerifiedMd? | Report |
| add_comment | key, body | Comment |
| review_task | key, expectedReportId, expectedReviewContextRevision, verdict, commentsMd; failedTests? | Review |
| archive_task | key, expectedClaimGeneration, expectedUpdatedAt; reason? | TaskSummary; reason is an atomic comment |
| ask_user | scope, title; bodyMd?, options?, recommendedIndex?, allowFreeText?=true, roundLabel? | Question |
| wait_for_answer | questionIds, timeoutSeconds (0..60) | { answered: Question[], pending: Question[] } |
| list_questions | status? (open/answered/withdrawn), scope? | Question[] |
| withdraw_question | id | Question; asker or human only |
| set_status | text (0..120), scope? | Member; empty text clears the status/scope |
| list_changes_since | cursor (nonnegative seq), epicKey? | ActivityEvent[] after cursor, chronological |
| wait_for_changes | cursor; epicKey?, includeProject?=false, actions?, actorKind?, excludeSelf?=true, timeoutSeconds?=30 (1..60) | { events: ActivityEvent[] (max 100, ascending), nextCursor, timedOut } |
| add_reference | kind (asset/link/note); filePath? / url? / text?, title?, caption?, tags?, frameEpicKey? or frameId?, linkTo?, x?, y? | RefItem |
| list_references | epicKey?, storyKey?, taskKey? | RefItem[]; multiple target filters form a union |
| link_reference | itemId, targetKey | RefItem |
| update_reference | itemId; caption?, tags?, title? | RefItem |
| list_members | {} | MemberStats[] including counts, online, workingOn and stale status indicator |
| list_assets | kind?, query? | Asset[] with role=asset/reference |

## Human-authorized execution

**Ready is a planning state, not permission to start.** Drafting, questions, references, decomposition, human edits and brief reconciliation can happen while execution is paused. A human explicitly starts an exact **story or epic**, not each individual worker. A Start allows work within that scope; it does not launch a process, activate a draft story, mark tasks Ready, or modify task assignments.

The native UI has `get_execution`, `list_execution`, `set_execution`, `list_execution_requests` and `resolve_execution_request` commands. Only the native human bridge exposes Start, Pause and approval. MCP has the four read/request tools above, **no Start, Pause or approval tool**. The human identity is resolved by the native backend, never accepted as an input flag.

### A command in brain chat

The appointed epic brain can call `request_execution` with an exact epic/story and a reason. This creates a separate typed Inbox request; it does not authorize work. The human reviews the project and scope, then chooses **Approve and start** in the app. A generic `ask_user` answer, free text such as “start”, a tool's `userApproved` field, or the brain's role cannot manufacture a grant. Unknown arguments are rejected. A trusted chat-to-human-approval bridge is not implemented in this alpha: chat requests still need that one Inbox confirmation.

A pending request is idempotent for the same scope and revision. Start/Pause supersedes affected pending requests. A request records immutable project/scope IDs and the execution revision; a stale approval fails with `conflict`. Titles and keys in responses reflect the current canonical entities. Switching the human's selected project cannot redirect a captured request or connection.

### Inheritance and pause matrix

| Epic own state | Story own state | Story effective state |
|---|---|---|
| paused (default) | inherit (default) | paused |
| running | inherit | running, from epic |
| either | paused | paused |
| either | running | running, explicitly started |

- Starting an epic runs its inheriting stories; an explicitly paused story stays paused.
- Pausing an epic clears child explicit running grants back to inherit and blocks the entire subtree at that moment. Explicit child pauses remain intact.
- A later explicit Start on one story can run it while the epic remains paused. Epic state includes `runningStoryCount` so callers can distinguish this from a fully stopped subtree.
- Starting a draft scope is allowed, but new task work still needs an **active story** and applicable task readiness/role checks. Closed or archived parents/scopes cannot start.
- Closing or archiving an epic/story/project revokes its grants. Reopen/restore does not resurrect them. A story closed under a running epic becomes explicitly paused, so reopening it does not silently inherit the old grant.

`ExecutionState` returns `projectId`, canonical `scope`, `scopeKey`, `scopeTitle`, `ownState`, `effectiveState`, `source` (scope/epic/none), opaque `revision`, `canStart`, nullable `blockedReason`, `inProgressCount`, `readyCount`, `runningStoryCount`, nullable `changedBy` and `changedAt`. In-progress counts include archived cards; Ready counts exclude archived cards. The revision includes the ancestor for stories and child grant revisions for epics. Treat it as an opaque token; native `set_execution` requires `expectedRevision`.

`ExecutionRequest` returns `id`, `projectId`, canonical `scope`, `scopeKey`, `scopeTitle`, `requestedBy`, `reason`, `status`, `revision`, `createdAt`, nullable `resolvedBy` and `resolvedAt`. Native resolution requires `id`, `decision` (approve/decline), and `expectedRevision`. An approval verifies the request and current scope revision and starts the exact scope in one transaction. Decline does not start work.

### Work already underway

Pause blocks new claims, status transitions into In progress, direct creation in that status, new active assignees and subsequent work rounds. Neither a human nor a brain nor a Ready override bypasses this check (`execution_required`). A same-status reorder of existing work is not a new start. Task/story reparenting is not supported by the current update contracts.

Existing holders may still submit reports and human/brain reviewers may accept or request changes while paused, including when the task or a planning parent was archived after the claim. Changes requested returns to Ready; reclaiming that next round needs a current grant. Restoring an individually archived task only restores visibility: status, holder, review round and paused execution remain unchanged. It therefore permits releasing an existing claim without starting the scope. A new assignment or claim remains gated. Existing holders and humans can also release a claim to Backlog or Ready while the task or parent is archived; ordinary readiness checks still apply for Ready. Release preserves archive flags, grants, review rounds and evidence, and cannot mark Done. It does not stop an operating-system worker process. Closed parents still prevent new work.

Project archive is refused while any In progress task remains, even hidden archived tasks. It does not silently reset work. Migration from older databases, JSON import, and demo creation grant no execution permission. Legacy/demo In progress cards retain their evidence/report path. JSON export/import preserves planning and work history, **not grants or pending approvals**.

### wait_for_changes

Long-poll the active project's persisted activity feed on either stdio or HTTP. Required `cursor` is a nonnegative integer activity `seq`; only rows with `seq > cursor` are eligible. Matching events already present return immediately. Otherwise the call waits until a match or the deadline. Arguments combine with AND:

- `epicKey?: string`: include events whose `epicId` equals that epic's ID. With this filter, `includeProject: true` additionally includes project-wide (`epicId: null`) **human** events. Project-wide agent events and events from other epics stay excluded. Default `includeProject` is false. Without `epicKey`, all scopes of the active project are eligible and `includeProject` has no effect.
- `actions?: string[]`: match any listed action. Omitted or null means all actions; an empty array matches nothing. Unknown names return `validation` (field `actions`). Accepted names: `agent.status`, `asset.created`, `asset.linked`, `asset.unlinked`, `asset.updated`, `comment.added`, `epic.created`, `epic.status`, `epic.updated`, `execution.started`, `execution.paused`, `execution.requested`, `execution.request_resolved`, `jam.archived`, `jam.imported`, `jam.updated`, `member.joined`, `member.updated`, `project.updated`, `question.answered`, `question.asked`, `question.withdrawn`, `reference.added`, `reference.linked`, `reference.updated`, `report.submitted`, `review.recorded`, `story.created`, `story.status`, `story.updated`, `task.archived`, `task.brief_updated`, `task.claimed`, `task.created`, `task.moved`, `task.ready_override`, `task.released`, `task.updated`.
- `actorKind?: "human" | "agent"`: omitted or null means either kind; other values return `validation`.
- `excludeSelf?: boolean`: defaults to true; skips events whose actor ID equals the authenticated caller's member ID. Pass false to include them.
- `timeoutSeconds?: integer`: 1–60 inclusive, default 30. Zero, 61, fractions and negative values return `validation`. Missing/negative/non-integer `cursor` also returns `validation`.

Response `events` contains up to 100 matches in ascending seq order, using exactly the `list_changes_since` ActivityEvent shape: `seq`, `action`, `actor` (id/kind/name/handle/color), optional `taskKey`, `payload`, `createdAt`, nullable `epicId` and the shared English `sentence`. A nonempty response has `timedOut: false`.

**Always persist `nextCursor`, even on timeout.** It advances past **all inspected events**, including events rejected by action, actor, self or scope filters. These are deliberately consumed, so changing filters later requires a recovery read from an earlier cursor. When 100 matches are reached, scanning stops at the hundredth; later rows remain available to the next call. An empty timeout returns `{ events: [], nextCursor: <latest seq checked>, timedOut: true }`. The cursor never moves backwards, including when the supplied cursor is ahead of the feed.

Each wait refreshes the caller's `last_seen_at` without adding activity. Normal first-time MCP agent registration remains a separate `member.joined` event. The maximum wait is below the 120-second online threshold, so repeating waits maintains presence. It reuses `wait_for_answer`'s dedicated `PRAGMA data_version` connection with sleeps of at most 250 ms. It holds neither a SQLite transaction nor the writer mutex during sleep. Non-matching commits advance the cursor but do not complete the call.

Example tool arguments:

```json
{"cursor":120,"epicKey":"JB-E1","includeProject":true,"actions":["report.submitted","question.answered","task.brief_updated","task.claimed"],"excludeSelf":true,"timeoutSeconds":60}
```

Example `structuredContent` (seq 121–123 were inspected but did not match):

```json
{
  "events": [{
    "seq": 124,
    "action": "report.submitted",
    "actor": {"id":"worker-id","kind":"agent","name":"Worker","handle":"worker","color":"#E0679A"},
    "taskKey": "JB-12",
    "payload": {"key":"JB-12","round":0},
    "createdAt": "2026-10-21T00:00:00Z",
    "epicId": "epic-id",
    "sentence": "Worker submitted a report for JB-12"
  }],
  "nextCursor": 124,
  "timedOut": false
}
```

### Waiting as a brain

First verify `get_session_context.projectId` against the intended exact project ID. Matching names/prefixes are insufficient. Communicate with the human in their established language; English tool prompts and event sentences do not require English replies.

**Existing recovery:** keep the unprocessed saved cursor; never replace it with a new bootstrap cursor or reset to zero each turn. Persist its project, epic and filter identity. Call `wait_for_changes` with that cursor, `epicKey` when scoped, `includeProject: true`, **`excludeSelf: false`**, and `timeoutSeconds: 1`. Omit `actions` and `actorKind` unless deliberately narrowing observation. This retains inclusive recovery rather than silently adopting the wait tool's self-excluding default. With an epic, `includeProject: true` adds only project-wide human events, not every epic or project-wide agent event; without an epic it has no narrowing effect.

Handle each returned page before checkpointing `nextCursor`, even on timeout. Fetch affected task/question/epic details needed for the decision, not the entire board. Repeat until `timedOut: true`; fewer than 100 events does not prove catch-up is complete. Continue live waits with the same policy and `timeoutSeconds: 60` only when continued observation is part of the assigned role/request, persisting handled checkpoints even on timeout. Finish and report at the assigned stopping condition; recovery does not create a new monitoring assignment or postpone a completed worker’s handoff. Changing to `excludeSelf: true` is an explicit choice only when successful own writes are retained; do not reuse that filtered checkpoint for inclusive recovery. All filters consume excluded events: widening them needs an explicit earlier-checkpoint policy. No busy loop or idle `list_changes_since` polling is necessary.

The cap is **100 matching events, not bytes**. Pagination controls individual responses; reading all pages still reads the full history and does not promise lower total history tokens. Continuously arriving events can prevent catch-up from terminating. Before context limits, checkpoint handled pages and preserve a concise, honest summary of what remains; never declare incomplete recovery complete.

### Fresh bootstrap and cursor compatibility (0.3.0-alpha.15)

`get_session_context.latestActivityCursor` is the maximum committed global `activity.seq` belonging to the exact pinned project, or `0` for a project with no activity. Identity and this cursor are read in one transaction. The field is read-only and does not grant execution, create an OS session, or switch projects. Global sequence gaps are normal.

For a **fresh bootstrap with no unprocessed saved checkpoint**, capture this cursor **before** reading the requested current state. Inspect the requested epic/story/tasks, questions, comments and linked sources, paging fully where required. Then process newer events with the bounded recovery policy above and checkpoint only once the baseline and returned events have been handled. A change seen in the baseline may also appear in replay: use stable entity/event IDs and reread affected state instead of double-applying actions. Capture after current-state reads is unsafe because changes in between could be missed.

This baseline plus replay is not a coherent multi-call atomic snapshot, not historical audit, and not proof that the baseline included every required detail. Preserve full task/report/review evidence and captured validators for decisions; do not silently clip evidence. Prefer targeted `list_tasks` and selected `get_task` reads. Do not require both `get_task` and `jam://task/{key}` unless the resource supplies additional required content. `list_changes_since` remains unchanged and available for deliberate audit; never bypass a requested historical review with a bootstrap shortcut.

**Do not infer database rewind from cursor comparison.** `wait_for_changes.nextCursor` advances through inspected foreign-project and nonmatching global sequences. Therefore a valid saved cursor can exceed the project-filtered `latestActivityCursor`. Neither cursor includes a database-generation identity; restore, replacement or suspected rewind is ambiguous and requires explicit reconciliation/reinitialization policy, not invented automatic recovery.

Clients supporting older servers must feature-detect the field: missing is not a returned zero. If absent, recover conservatively from an existing known checkpoint; a genuinely new history may require cursor-zero catch-up. Never guess a high-water value from time or overwrite an unprocessed checkpoint. Updated servers always supply the field and their generated output schema includes it. Tolerant older JSON readers can ignore the added field, but deny-unknown-fields consumers, exact-output fixtures and cached output schemas need coordinated updates/version awareness; additive does not mean universally byte-compatible.

The targeted-retrieval rationale follows [Anthropic's tool-design guidance](https://www.anthropic.com/research/writing-tools-for-agents). [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search) concerns client-side tool discovery, not history payloads; this change makes no claim of automatic tool-search support or measured token/latency savings.

### Project and planning fields

get_project also returns top-level template, templateLabel (Game jam / Gamedev / Web app / Custom), and milestoneAt, matching the nested jam fields. Human template switches preserve used task tags and write one project.updated activity event. The jam retains its existing columns and adds template (game_jam/gamedev/webapp/custom) and nullable milestoneAt. Only game_jam returns endsAt/timeLeft as a countdown. Suggested tags:

- game_jam: gameplay, art, audio, ui, tech, polish, bug;
- gamedev: gameplay, level-design, art, audio, ui, tech, narrative, qa, bug;
- webapp: frontend, backend, design, api, infra, qa, bug, docs;
- custom: none.

Epic includes key/title/color/status, interview Markdown fields, participation (each_iteration/first_sketch/autonomous; default first_sketch), reviewer (none/final/stages; default none), nullable workerModel/brainMemberId, position and audit columns. Colors are m1..m6 assigned round-robin. update_epic preserves omitted fields; workerModel:null clears the model. A brain is an existing agent appointed by a human/current brain, or become_brain while unappointed. Appointment does not change the agent's model; the user chooses workerModel.

Participation means: each meaningful iteration; first coherent sketch to correct direction, then autonomous refinement; or fully autonomous. Reviewer means none, one final pass, or agreed stages. These planning choices do not start work. The human starts a story or epic; within that authorized scope the brain can coordinate workers and review stages without a separate board approval per worker. The board never launches OS agent sessions itself. Any external runner must still honor the agreed scope, tool permissions and safety boundaries.

Story includes key/epicId/title/status, the six intent-card Markdown fields and acceptance: [{ id, criterion, mandatory, check }]. Acceptance IDs must be unique and text/check nonempty. Planning statuses are draft/active/done/archived. Activation requires goalMd + doneWhenMd for epics; outcomeMd + a mandatory acceptance criterion for stories. These fields cannot be cleared while active. Done requires all active children done, or a human/brain overrideReason recorded in activity. Humans can restore archived planning entities through status commands.

### Brief, readiness and work

TaskBrief is { goalMd, contextMd, whereMd, changes, tests, boundariesMd, resultMd, userQuotesMd }. A change is { title, now?, cause?, required, where?, follow?, keep? }; title and required are nonempty. A test is { setup, expected }, both nonempty. Missing lists are allowed while drafting. Readiness returns these exact missing codes/messages:

| Code | Message |
|---|---|
| goal | Goal is empty |
| where | Where is empty |
| change | At least one change with a Required text |
| test | At least one test with setup and expected result |
| result | Result (report format) is empty |
| story_active | The story is still draft |

Moving into Ready runs that check. An authorized nonempty override writes task.ready_override instead of task.moved, exactly one event. Claim rechecks readiness; a recorded override remains valid until a subsequent brief edit. A worker claiming Backlog gets not_ready; another non-Ready status gets wrong_status with the current status. With current context, another holder returns claim_conflict; a stale lifecycle validator returns stale_claim first. A brain may claim a complete brief from another status; human status changes retain their planning controls but cannot bypass the execution gate for entry into In progress. Agents can reach Done only through independent `review_task`; direct agent creation, move, versioned status update or release to Done is forbidden, including for the appointed brain. Explicit human manual Done remains available and does not fabricate a review row.

Workers enter In progress through claim_task and Review through submit_report. move_task/release_task cannot substitute for those gates or move another holder's task. Workers may create Backlog/Ready tasks; direct creation in working/review statuses requires a human or the appointed epic brain. Agent creation in Done is always forbidden; explicit human manual completion remains available. update_task does not accept status or assignee fields. A permitted return to work after a submitted report allocates one successor round, preserving prior evidence; repeated moves in that status do not advance the round.

submit_report requires the current assignee and In progress. It inserts one report for the current reviewRound, moves to Review and clears changesRequested. Report tests are [{ name, command, expected, actual, result: PASS|FAIL|NOT_RUN }], with unique nonempty names. A review requires the current-round report; otherwise validation says "No report for round N". accept moves to Done. changes_requested moves to Ready, sets the flag, increments reviewRound, preserves the assignee and records failedTests using report test names. The assignee/report author cannot review its own work. Historical reports/reviews remain visible.

Titles: 1–140 Unicode characters. Comments: 1–4000. Priorities: low/medium/high/critical; estimates 1/2/3/5/8 or null. Tags are trimmed, lowercased, deduplicated/sorted, at most 24 characters. Dates use RFC 3339 UTC. update_task omission preserves estimate/dueAt; null clears them. Description input remains description; output descriptionMd. Existing activity contains the latest 20 task rows and history the last 50, chronological. updatedAt is an opaque optimistic version for native and MCP task overwrites.

list_tasks.assignee accepts a handle, me or unassigned; query matches literal title/Notes substrings. epic/story accept keys or IDs. ready means the readiness check passes, independently of the status; combine with status=["ready"] for workers. Limit is 1..200; cursors are offsets and can shift during concurrent ordering. afterKey immediately precedes a moved task and beforeKey follows it; neighbors must be adjacent within the destination column. No neighbors appends. Tiny gaps trigger atomic renumbering. Retrying create_task with the same actor/idempotencyKey returns the original, without another event.

### Questions, status and journal

Questions contain scopeType/scopeId, askedBy, optional roundLabel, title/bodyMd, 0..6 options [{ label, description }], nullable zero-based recommendedIndex, allowFreeText, status and answer metadata. Humans alone answer through the desktop command answer_question; answering needs an option or permitted nonempty free text. Agents read answers. Asker/human may withdraw. Each level displays only its own open questions: task needsInfo is task-scoped, story stamps are story-scoped, and the epic header counts epic-scoped questions. get_epic.openQuestions still contains the whole subtree for planning; get_task.ancestorQuestions preserves open ancestor context without setting the task flag.

wait_for_answer uses the activity/data-version change feed, sleeps at most 250ms between checks, holds no SQLite writer and returns on the first answer or timeout. Withdrawn questions appear in neither answered nor pending. Before an epic exists, interview questions/status are project events with epicId=null; they are not silently reparented. The epic journal begins with epic.created. list_changes_since can read the project prelude as well as an epic-specific tail.

set_status updates lastSeenAt and writes one agent.status event. Status text older than 30 minutes is stale; online remains the independent 120-second heartbeat rule. Every event under an epic has epicId. Human intent/brief edits include payload.fields. UI and MCP use the same core sentence vocabulary, e.g. "Claude returned JB-7: tests 2 failed".

### Local reference canvas data

Reference kind asset requires a readable absolute filePath; a role=reference asset and the canvas item are created in one transaction, without copying the file. kind link stores an http(s) URL without making a request. kind note requires text; text and optional caption are retained together in captionMd. frameEpicKey reuses/creates that epic's frame at a free position. Otherwise an agent's new items enter a vertical Agent inbox frame at the right edge. Optional frameId selects an existing active frame; do not combine it with frameEpicKey. Optional x/y are canvas coordinates for unframed items, or coordinates relative to the chosen frame. Omitted geometry uses a three-column layout in epic frames and a vertical layout in Agent inbox.

linkTo/targetKey address an epic, story or task. A frame implicitly links its items to its epic: the UI labels this "via frame", epic-filtered list_references includes it, and get_task includes inherited story/epic/frame references. Archiving a frame releases children visually but retains its origin for reversible restoration. Archived items, edges and explicit links remain stored and are hidden from normal lists.

RefFrame stores id/jamId/epicId/title/x/y/w/h/color/collapsed. RefItem adds audit, kind/assetId/url/linkPreview/title/captionMd/tags, x/y/w/h/z/frameId and nullable JSON-string metadata (file size and cached audio peaks/duration). RefEdge connects items with an optional label; RefLink maps items to targets. The References screen uses React Flow and native commands for geometry, frame binding, edge labels, archival/restoration and per-human viewport settings. No hard-delete API exists.

Remote previews are a separate explicit human action, never part of an MCP reference tool or canvas render. Fetching has a five-second deadline, a 2 MiB response cap and HTTP(S)-only redirects; only the page title and absolute og:image URL are retained. That remote image is not downloaded automatically. Clipboard images are encoded as PNG and written only into the data directory's references folder; other user files are never copied. Media URLs are granted per registered asset ID by Rust, without general frontend filesystem permission.

## Resources and prompts

resources/list exposes jam://board as Markdown. Resource templates are jam://epic/{key} (whole tree and journal tail), jam://story/{key} (intent, acceptance and task list), and jam://task/{key}. The task resource renders exact playbook headings Goal, Context, Where, Changes, Tests, Boundaries, Result, plus User quotes, Notes and Comments; its snapshot is checked in Rust.

Three prompts are available:

- plan_epic: interview rounds with ask_user/wait_for_answer, playback summary/confirmation, epic/story/task planning, complete briefs, mark_ready and scoped status; wait_for_changes for reports, answers and human edits, with bounded inclusive wait_for_changes for saved-cursor recovery and a pre-read latestActivityCursor only for fresh bootstrap. Optional requirements-interview.md, task-brief-and-acceptance.md and brief-writing.md are workflow guidance, not protocol prerequisites. Live tool schemas and captured validators take precedence; no automatic playbook installation is implied. All three prompts verify the intended exact project ID before board/task reads, not just a matching name or prefix.
- work_on_next_task (optional tag): verify the pinned project and running story permission, pick Ready work, prefer own changes-requested tasks, read the full brief/context, claim, work and submit_report with evidence. Names brief-writing.md.
- review_task: compare report evidence against brief tests, story acceptance and epic scope; accept or request changes, then publish status. Names task-brief-and-acceptance.md.

The full playbook skill is not bundled in this stage. Prompts reference it by name without copying it.

## Live events and verification

Both transports call jam-core. Short BEGIN IMMEDIATE writes append one activity event for each domain mutation; heartbeat metadata and idempotent create retries add none. The desktop polls a dedicated PRAGMA data_version connection every 250ms and emits board-changed with monotonic events. The existing UI refreshes caches, agent highlights, pulses and toasts. Question and activity waiting use that same persisted feed across processes.

Run cargo test --workspace for the committed v0.1 migration fixture, readiness/permissions/review/questions/references, stdio coverage of every new tool with errors, exact tool-set assertions, concurrent mixed hierarchy creation and HTTP 401/403. Functional tests use the Rust-exported mock fixture. Production table and canvas performance projects run separately from functional checks.

### Claim generations and stale decisions (breaking MCP change in 0.3.0-alpha.5)

TaskSummary/TaskDetail now expose **claimGeneration**, an opaque task-bound lifecycle validator. Schema 7 advances it whenever status, assignee or review round actually changes. Returning a claim and later reclaiming it with the **same agent identity** creates a different generation. No-op assignment and task visibility changes do not. This is freshness, not an execution grant, authentication credential, time lease or process cancellation.

All covered MCP arguments are required; omitted context fails closed. There is no unchecked compatibility tool, brain bypass or server-side injection of the latest validator. Existing data, read tools and version-1/2 snapshots remain compatible. Import discards any exported claimGeneration and allocates fresh task identities; migration preserves live holders/statuses/rounds without granting execution. A migrated/imported live holder may read its current context and report while paused.

| Mutation | Caller must capture and submit |
|---|---|
| claim_task, move_task, mark_ready, archive_task, update_task, update_task_brief | expectedClaimGeneration + expectedUpdatedAt from get_task before deciding the mutation |
| submit_report, release_task | expectedClaimGeneration from the live claim being reported/returned |
| review_task (brain or native human) | expectedReportId + expectedReviewContextRevision from the exact report and planning context inspected |

`claim_task` returns the new generation in TaskDetail. Keep it with that work attempt. For example, after reading the task and checking its running story, call:

```json
{"key":"JB-12","expectedClaimGeneration":"<observed claimGeneration>","expectedUpdatedAt":"<observed updatedAt>"}
```

A report includes `expectedClaimGeneration` from the **successful claim response**, not the pre-claim validator. Review reads `reports` for the current `reviewRound` and captures that report's immutable `id` plus `reviewContextRevision`; the latter is null unless the task is in Review with a current-round report. This opaque revision binds report ID and the task/story/epic identities and versions. A changed brief, story acceptance, epic planning context or report requires a new inspection, not silently substituting fresh validators into an old decision. Explicit human manual Done remains separate from reviewed acceptance.

Every precondition is compared inside the same immediate SQLite write transaction as the mutation and activity. `stale_claim` means the lifecycle changed; `conflict` means an overwrite/review context changed. Both leave the mutation and task history untouched. **Do not fetch a fresh token and automatically retry an old payload.** Preserve draft evidence, read the latest task/claim/context, reconcile what still applies, and deliberately submit a new decision. Reports use generation rather than updatedAt, so unrelated Notes/comments do not discard evidence from an unchanged live claim. Scope Pause/closure/archive and task archive/restore do not rotate the live generation: in-flight reporting and cancellation remain possible; new work still requires human-started scope authority.

Native human recovery retains its expectedUpdatedAt confirmation CAS. Native reports and reviews require the captured claim/review context too. Other native human planning actions retain their existing policies. Append-only comments/questions/reference additions and informational handwritten presence are not claim-generation fenced in this bounded change; they do not grant or complete work. Epic/story planning edits are not a general CAS API in this alpha, but their resulting versions invalidate pending task review decisions. Board fencing cannot stop an external worker process or fence its filesystem writes, and it does not prevent the same authorized identity from intentionally reading fresh context.

The optimistic-context design follows conditional-write principles in [RFC 9110 If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match) and [Kubernetes resource versions](https://kubernetes.io/docs/reference/using-api/api-concepts/#resource-versions), implemented as explicit MCP arguments rather than HTTP If-Match headers. [SQLite immediate transactions](https://www.sqlite.org/lang_transaction.html#deferred_immediate_and_exclusive_transactions) serialize validation with the accepted write.

### Native movement freshness (0.3.0-alpha.7)

The native `move_task` and `mark_ready` inputs now require **expectedUpdatedAt**, just like a human task edit or Release confirmation. Capture the task version when a pointer/keyboard drag starts or the readiness decision opens, not when the request is finally sent. The human identity and project are still resolved by the native bridge; these inputs cannot choose an actor, grant execution or force an overwrite.

A changed task returns `conflict` before any transition, review-round allocation, neighbor reordering, readiness override or activity is written. This also rejects a delayed decision after the same worker releases and reclaims the task. Keep override text, reread the authoritative task and reconcile intentionally; never replace the captured version on background refresh or automatically retry an old decision with a new version. A fresh explicit human manual Done remains distinct from reviewed acceptance, while a fresh move into In progress still needs a running scope.

This is a required native-input change only: MCP movement/readiness still require both validators documented above. No database migration, new role, execution grant, or claim-generation change is introduced; schema 7 and existing data/import compatibility are unchanged.
