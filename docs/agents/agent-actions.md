# Agent actions, state and recovery

[Index](README.md) · Baseline alpha28 `2b263795b31767da29db0b62dc81f4da19dfc4d1`, inspected 2026-10-22. Alpha29 human-first layout does not change this tool/authority contract. [Canonical MCP contract](../mcp.md) and live tool schemas take precedence for argument details.

## Actor / state interaction map

| ID | Actor / entry → depth and actions | Result / authority boundary | Failure/recovery and human counterpart |
|---|---|---|---|
| AG01 | New client → initialize exact project → get_session_context → scoped baseline | Connection stays pinned; current desktop project is not retargeting | Wrong/archived project fails closed. Verify immutable ID before reads; H-G04/S01 |
| AG02 | Human Refine heading action -> scoped prompt -> stage in dock composer or secondary copy -> inspect scope/sources -> refine | Compose/copy is guidance, not Send, execution or proof of connection | Alpha31 candidate: explicit First / new chat or Continue in this chat, with scoped local request. Never auto-detect conversational memory; [mode contract](refinement-modes.md); H-P07 |
| AG03 | Human appoints Brain → unassigned become_brain or authorized set_brain → plan epic/story/tasks | Brain can coordinate assigned epic, not override an occupied appointment arbitrarily | Preserve human edits; array fields replace whole lists; active hierarchy and readiness separate from Start; H-P01–P04 |
| AG04 | Agent missing board decision → ask_user → human Inbox choice/free text → wait/list answer → reconcile | Question persisted with exact scope; human-only answer | Tool success/question ID proves creation; arbitrary chat is not automatically Inbox. Client permissions/connection dialogue may remain chat. Ordinary answer never grants execution; H-I01/P06 |
| AG05 | Agent prepares brief → check_ready → mark_ready | Backlog → Ready when valid/authorized override; no work launch | Missing codes lead to brief repair; capture claim generation + updatedAt from inspected task; H-D02/D07 |
| AG06 | Brain request_execution → human typed Inbox confirmation / direct Start → effective scope running | Human-only native authorization; MCP has no approve/Start/Pause tool | Exact revision and scope; stale request blocks; declined/superseded not grants; H-I02/P08 |
| AG07 | Worker reads running scope + Ready task → get_task → claim_task → implementation | Accepted claim sets holder and ordinarily In progress atomically; claim response supplies new generation | Conflicting claim, stale token or paused scope stops new work. A board claim never launches a filesystem/process action; explicit dock startup is separate (AG15); H-B02/D08 |
| AG08 | Holder submits report → Review → human/brain reviews captured report/context → accept or changes requested | Accept → Done; changes requested → Ready, same worker retained; next round needs current permission | Evidence names test setup/command/expected/actual/PASS/FAIL/NOT_RUN; stale context reread/reconcile, not token substitution; H-D09 |
| AG09 | Human Pause / holder or human release → tracking recovery | Pause blocks new rounds/claims, existing holder may report; release clears holder, returns Backlog/Ready | Neither kills process; no Done via release. Archive retains evidence/flags; project archive refuses In-progress work; H-D08/S03 |
| AG10 | Agent set_status / domain mutations → persisted activity → ordered reads/waits | Short scoped status and heartbeat are different signals | Preserve checkpoint, inspect bounded pages, checkpoint after handling; default filters may omit relevant history. Dock transcript events are separate in-memory state (AG15); H-M02/H01 |
| AG11 | Replacement client read-only recovery → verify project → read full relevant history → summarize → separate role handover | Stored reports/reviews survive ordinary same-database restart; role transfer is independent | Include Done/archived tasks if relevant, answered questions and all report rounds. No claim/reassign/start implied; H-G04/P02 |
| AG12 | Agent adds/reads/links/edits reference → human canvas observes | Stored URL/note/registered file path and exact project links; no implicit network preview; copy:true explicitly retains local assets | File must be readable; project mismatch fails; arrays replace; canvas organization is exposed under AG14; preview/restore remain human-only; H-R01–R08 |
| AG13 | Agent searches/reads tasks/assets/members; comments or allowed task edits | Reads do not authorize mutations; comments append, update fields use current contract | Foreign-project addresses rejected; pages/tails are not complete history; capture validators before overwrites; H-D03/A01/M01 |
| AG14 | Agent reads get_canvas -> explicitly requested frame/connection/layout edits -> reread | Project-pinned canvas services and activity; no execution grant, role change or process launch | Atomic arrange rejects the entire batch on invalid/foreign IDs or insufficient grid space; reconcile uncertain responses; H-R01/R02/R06 and AC14 |
| AG15 | Explicit dock profile start -> starting -> ready -> running / awaiting_permission -> ready or stopped/failed | ACP/API chat and PTY are dock sessions, not execution grants; model reply, plan, tool permission and chat text never approve board Start | First context visible; Stop turn cancels pending requests; close only hides UI; bounded in-memory replay, no app-restart resume; H-BD01/BD02/BD05/BD06 |
| AG16 | Dock session startup -> project-pinned jam-board MCP and cwd -> ordinary agent calls | In-app agent is an ordinary MCP client with stable profile JAM_AGENT_NAME; exact project/data dir/cwd captured before dispatch | Navigation cannot retarget; same normalized name shares a member, not independent worker identity; custom terminal needs compatible CLI wiring; H-BD01/BD03 |
| AG17 | Explicit dock Stop / app exit -> owned process cleanup; error -> explicit Restart/Connections | Dock lifecycle is distinct from board Pause/Release; stopping a runtime neither revokes grants nor releases claims | Startup cancellation/descendant cleanup are required; packaged-app cleanup remains unverified; failed in-memory history retained until app exit; H-BD03/BD08 |
| AG18 | Built-in API chat -> MCP tool metadata -> automatic read or explicit write permission | Only tools explicitly annotated read-only auto-run; writes ask Allow once / Always allow this tool for this session / Reject; only jam-board MCP is available | Rejection/cancel does not execute; session allow is not a board Start grant and does not bypass project/claim/review validators; H-BD02/BD07/BD08; BC10 |

## State meanings: never collapse these into “agent working”

```text
planning draft -> active story + prepared task brief -> Ready
human Start exact scope -----------------------------> execution permission
Ready + active story + permission + successful claim -> In progress / holder
In progress + accepted report ----------------------> Review
Review + accepted captured evidence ----------------> Done
Review + changes requested -------------------------> Ready / retained worker
release --------------------------------------------> Backlog or permitted Ready / unassigned
```

An epic running grant is inherited only by inheriting stories. Explicit story pause wins. Pausing epic clears explicit child running grants; a later explicitly started story can run under a paused epic. Closing/archiving revokes grants; reopening does not silently resurrect them. Consult [inheritance matrix](../mcp.md#inheritance-and-pause-matrix) rather than guessing from one badge.

## Complete baseline tool inventory (52)

This is an indexed copy of the current MCP inventory for map completeness; argument evolution must update this table and `docs/mcp.md` together. Tools are grouped into AG paths above, not exposed as invented UI actions. Human-only native `set_execution`, `resolve_execution_request`, `answer_question`, preview/restore and application settings actions are represented in the human map. AG14 exposes the listed canvas geometry/frame/edge tools; dock lifecycle invokes remain native commands, not additional MCP tools.

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
| add_reference | kind (asset/link/note); filePath? / url? / text?, copy? (asset only, max 50 MiB), title?, caption?, tags?, frameEpicKey? or frameId?, linkTo?, x?, y? | RefItem |
| list_references | epicKey?, storyKey?, taskKey? | RefItem[]; multiple target filters form a union |
| link_reference | exactly one of itemId or frameId; targetKey | RefItem or RefFrame |
| unlink_reference | exactly one of itemId or frameId; targetKey | { unlinked: true } for an item; RefFrame for a frame; leaves content intact |
| update_reference | itemId; caption?, tags?, title? | RefItem |
| get_canvas | epicKey?, frameId?, includeArchived?=false, limit?=100 (1..200), cursor? (nonnegative offset) | { frames, references, edges, total, truncated, nextCursor }; world x/y, text capped at 200 characters, linkedKeys capped at 50 with linkedKeysTruncated |
| create_frame | title; epicKey?, x?, y?, w?=900, h?=600 | RefFrame; omitted x is placed right of content with 80 units clearance, omitted y=0 |
| update_frame | id; title?, epicKey? (null unlinks), x?, y?, w?, h? | RefFrame; omitted fields unchanged |
| connect_references | from, to (item IDs); label? | RefEdge; directed duplicates/self-edges refused, label max 240 characters |
| update_connection | id, label | RefEdge; empty label clears it, max 240 characters |
| remove_connection | id | { archived: true }; retains the connection record |
| arrange_references | items: [{ itemId, x?, y? }] (1..100); frameId? (null detaches), layout? (grid) | RefItem[] with world x/y and w, h, frameId matching get_canvas; one atomic batch |
| list_members | {} | MemberStats[] including counts, online, workingOn and stale status indicator |
| list_assets | kind?, query? | Asset[] with role=asset/reference |


## Freshness and recovery

- `claim_task`, `move_task`, `mark_ready`, `archive_task`, `update_task`, `update_task_brief`: submit observed `expectedClaimGeneration` and `expectedUpdatedAt` from the context actually inspected.
- `submit_report` and `release_task`: use generation of the accepted live claim, including the new generation returned by claim, not its pre-claim input.
- `review_task`: bind exact report ID and reviewContextRevision to the evidence inspected. Brief/story/epic changes can invalidate it.
- On stale/conflict: keep draft, read new context, reconcile, make a new decision. Do not fill fresh tokens and replay old intent. Missing/unknown fields fail closed; legacy playbook examples cannot override live schemas.
- Fresh bootstrap without an unprocessed checkpoint captures `latestActivityCursor` before baseline reads. Existing checkpoint recovery preserves that checkpoint. Process pages/events before advancing saved checkpoint; default wait filters and tails are not an audit of all history. See [waiting contract](../mcp.md#wait_for_changes).
- Lost response after dispatch is not proof of rollback. Read authoritative state before deciding any retry. `create_task` has its explicit actor/idempotency-key contract; do not assume every mutation shares it.

## Read-only replacement-brain handover

1. Connect to the same service/database and exact intended project; verify immutable ID via `get_session_context` before reading board content.
2. Read requested epic/story criteria. Page `list_tasks` across relevant statuses, including completed and archived work when needed; inspect each relevant `get_task` for all report/review rounds, comments and linked evidence.
3. Read answered as well as open questions. `list_questions` scope filters are exact, not recursive: query relevant levels rather than assuming epic filter includes all children.
4. Distinguish full records from tails: `get_epic` journal is latest 30; task activity/history latest 20/50. `jam://task/{key}` renders planning context and report identity, **not full report/review bodies**. Earlier decisions may require explicit historical `list_changes_since`, including project prelude.
5. Process concurrent changes using baseline/checkpoint policy; disclose unread pages, inaccessible files or context limits. Summarize decisions, accepted/rejected work, current holders, remaining questions and next steps.
6. Reading does not require taking Brain role. For later transfer human/current Brain explicitly appoints existing agent per epic; `become_brain` cannot replace an occupied role. Appointment does not reassign claims or grant Start.

Committed reports/reviews/questions are database records (`crates/jam-core/src/migration_v3.sql`, `workflow.rs`, `db.rs`, `service.rs`), not model chat memory. Persistence assumes the same preserved database; it is not a backup/sync/undelete guarantee. Chat-only reasoning, unsubmitted results and contents of merely named source files are not automatically retained.

## Source anchors and future boundaries

Tool registration/handling: `crates/jam-mcp/src/server.rs`, `v2.rs`; lifecycle and claim checks: `crates/jam-core/src/service.rs`; planning/role checks: `planning.rs`; questions/report/status: `workflow.rs`; clipboard handoff: `apps/desktop/src/lib/brain-handoff.ts` and `features/plan/BrainHandoff.tsx`.

Alpha31 adds explicit setup/continuation under AG02 with project binding, bootstrap recovery, captured validators and planning-only boundaries. AG11 read-only handover remains documentation-only. None was an alpha29 runtime feature. Optional visible session activity would require supported client transport, consent, identity, redaction, retention and disconnected states; no hidden model reasoning or forged approval bridge.

## Refine mode paths (alpha31 candidate; not shipped in alpha29)

| Reserved node | Human depth → agent continuation | Required observable boundary |
|---|---|---|
| AG02.setup | Prepare prompt dialog → First time/new conversation → request field → copy setup | Honest default; verify project then bootstrap current schema/contract; no automatic install/connect/start |
| AG02.continue | Same dialog → Continue this conversation → request field → copy short prompt | Explicit human choice, never inferred from heartbeat/name/copy history; missing remembered contract requires full setup |
| AG02.request | Either mode → edit request → change mode / copy failure / close | Preserve scoped request, selectable preview, clear unsaved/cancel policy; copy is not board save |
| AG11.handover | Documentation recipe → read-only context recovery → separate appointment (no handover UI mode) | Full relevant report/review bodies and answered/withdrawn decisions; no hidden role takeover or worker release |

Additional acceptance: renamed/deleted scope cannot silently retarget; immutable scope ID comes from actual DTOs (unlike the alpha28 key-only baseline); same MCP identity/new conversation is not remembered context; running scope does not convert Refine into execution permission; long historical `list_changes_since` response is not falsely treated as a paginated API. These extend AC02/AC03/AC10/AC11, not replace their safety gates. Exact proposed clipboard copy should be reviewed in its implementing change, not treated as already available UI.

## Alpha30 canvas delta

AG12 reference/image changes are human presentation/creation paths only. No tool,
schema, execution permission, result-card contract or persisted kind changes.
An inline note is local until Save; uncertain response is not rollback and must
not be blindly replayed. Image Retry is read-only. Existing agent-published results
remain available in the same canvas.

## Alpha31 Refine candidate delta

AG02.setup/continue/request are implemented as explicit choices; see [Refine modes](refinement-modes.md). AG11.handover remains recipe-only, not a third UI mode. New prompts ask for an understandable user-language outcome in an EMPTY human Description and preserve existing human text; no model guarantee or new readiness condition. Exact entity IDs now come from DTOs. Native/browser acceptance remains separate.

## Alpha31 history and presence

AG04/AG10 history display reconstructs seven actionable agent event kinds from
project-scoped activity pages; a read marker is not approval. No new tool/storage
or identity API. The event bus invalidates reads only because its payload lacks
project identity. See [notifications](notification-history.md).

AG10 heartbeat remains distinct from task work. One Root reader refreshes visible
member data every30seconds and on visible return; publication checks project/ABA,
lifetime, cache lifecycle and newer observation count before writing the shared
cache. Review status stays quiet; generic status is not an invented reviewer role.
See [presence](../live-card-presence.md).

## Alpha32 agent-state non-change

H-B01 empty-column wording and H-R02 frame styling do not alter AG05–AG07 Ready,
Start or claim semantics. Agent-created reference cards/results, parent/frame
coordinates, permissions and persisted data are unchanged. The overview no longer
paints a duplicate frame/title; its cards/edges remain rasterized as before.

## Alpha33 non-authorizing recovery

Archive/unarchive, teammate edit and edge label remain human UI operations with
unchanged server contracts. Unarchive makes a task visible, not executable. Pending
locks prevent duplicate UI dispatch, not server idempotency; a returned error may
follow persistence. Inspect current data before an intentional retry. Command
loading/reload never starts an agent or grants a scope.

## Alpha34 answer observation and continuation

AG04 / AG10: an active wait_for_answer or wait_for_changes call can observe a saved
answer using existing scope/cursor rules. It does not restart a finished chat.
The human copy aid names exact IDs and requests fresh project/question/appointment
and phase checks. An answer supplies information, not Start permission or worker
launch. No new MCP tool, subscription, session binding or adapter is introduced.

## Alpha35 human feedback and overlay delta

The 44-tool MCP inventory, task readiness/claim/review, validators and execution
permissions are unchanged. Local read receipts, autosave presentation, frame Fit,
reference menus, select placement and live tooltip text do not generate agent
work, grants or activity. Presence still distinguishes heartbeat freshness from
reported task activity; no inference of live session streaming is introduced.

## Alpha36 visual-layout delta

AG12 and all MCP contracts are unchanged. Reference control layout and measured
camera clearance are human display behavior; they do not edit agent results,
grant execution, create references or infer session activity.

## Alpha37 keyboard-only delta

AG12 reference content/state and all agent tool contracts are unchanged. Human
menu activation is repaired; no reference mutation, agent claim, Start or launch
is implied by opening or dismissing that menu.

## Alpha38 note content compatibility

AG12 tool names and argument schemas are unchanged. Shared `add_reference`
validation is **broadened**, not behavior-identical: a nonblank explicit heading
alone now suffices, as does a nonblank body. Blank-both creation still fails.
Existing callers without a heading retain the legacy default `Note`; native
paper can explicitly persist no heading. Existing cleared notes remain valid
records and survive export/import.

Human/native direct-note autosave adds an optional inspected-heading/body
expectation checked in the same write transaction. Existing MCP updates remain
unguarded and can still replace content; do not claim all clients now have CAS,
revision history, idempotency or automatic conflict merging. No note operation
creates an execution grant, takes a claim or starts a session.

## Alpha40 human copy and visual feedback

No MCP tool, schema, backend write, claim/review/Start permission or presence
predicate changes. Human guidance explains taking a Ready task versus starting
an external session; no-message agent status no longer promises availability.
Kanban lift is pointer feedback, not a worker-execution signal. Existing
structured plans, complete prompts and captured validators remain unchanged.

## Alpha41 standalone guide and neutral bootstrap

The two read-only MCP resources `jam://guide` and `jam://guide/operations` serve
board-owned skill files. No tool is added; existing 44-tool contracts remain.
Connection-only setup verifies exact project, reads guide and reports availability,
folder hint and next step; no appointment/plan/work follows without a requested task.
Use the app's current schemas and captured validators, not legacy playbook calls.

## Ideas canvas tools (current additive baseline)

The current inventory has **52 tools**: the historical 44 plus unlink_reference and the seven canvas
tools above. AG12 retains content/link operations; AG14 adds organization. Read
`get_canvas` before moving content, prefer a frame per epic and preserve manual
human layouts unless asked. Canvas geometry has no CAS/idempotency token; an
uncertain response requires a fresh read and a deliberate decision, not blind retry.
See [the canvas contract](../mcp.md#ideas-canvas) for paging, coordinates and grid limits.

## Brain dock runtime boundary

The [brain-dock contract](../brain-dock.md) owns the connector and UI contract.
AG15 adds the session state alongside the board state machine above:

```text
explicit New/start -> starting -> ready -> running <-> awaiting_permission
                                             -> ready / stopped / failed
close dock -> UI hidden; runtime continues
Stop turn -> cancel current turn/pending permission; not board Pause
Stop session / app exit -> owned runtime cleanup; not claim release
```

ACP chat, terminal and built-in API chat are implemented source paths. The
in-app agent uses an ordinary project-pinned MCP connection with its profile's
`JAM_AGENT_NAME`, subject to the same member identity, captured validators,
claim/review rules and human Start gate as external clients. Identical normalized
names still share a board member; starting two chats is not independent identity.
A chat message, session ready/running state, plan, model reply, config selection,
PTY output or tool permission decision is never Start approval. Human direct
Start or a fresh typed Inbox approval remains the only execution grant path.

Built-in API chat discovers tools from its per-session jam-board sidecar. Only
`readOnlyHint:true` tools auto-run; writes and absent/unknown read-only annotations
ask through a permission card. Choices are Allow once, Always allow this tool for
this session, or Reject. A session allow is scoped to that tool and runtime
session, not future sessions or arbitrary filesystem/process work. ACP runtimes
provide their own offered options. Reject/cancel does not dispatch a rejected
API tool; Stop cancels outstanding requests. These permissions never bypass
core Start, project isolation, claim generation or review checks.

`useBrainDock().compose` and board Refine/Continue/Ask brain actions stage an
editable prompt with scope/context chips; they do not send it or start a turn.
Explicit session launch and explicit Send are separate actions. Navigation
changes the displayed project, never an existing runtime's captured project/cwd.
API chat currently has only jam-board MCP; custom terminal commands inherit board
environment, while standardized CLI MCP flags apply to known Claude/Codex paths.

Session events and terminal scrollback are bounded in memory. Remount can replay
them during this app process; application restart cannot resume the conversation.
Stored board reports/questions/activity remain separate durable records. Required
process cleanup, live providers, credentials and rendered interaction evidence are
tracked in [BC01-BC11](acceptance-matrix.md#brain-dock-increment-acceptance-current-source-browsernative-qa-pending)
and [remaining gaps](known-gaps.md#brain-dock-integration-boundary).


## W4 frame links and moodboard feedback (AC14)

AG12 now links/unlinks exactly one itemId or frameId to an epic/story/task key.
Explicit frame links are persisted and include future children; RefFrame.links
lists targetKey, kind and title. get_task inherits story/epic links and frames,
without duplicate references. list_references retains its target union filter.
Frame provenance is via:"frame", frameId and frameTitle; direct links take
precedence. Unlink preserves the reference and other inheritance paths.

AG14 reads human feedback through get_canvas: verdict (keep/reject/null), note
attachedTo computed from world geometry (centre inside or >=30% note-area
overlap), and archivedAt/archivedBy with includeArchived:true. Only humans set
verdicts or restore archives; no MCP verdict tool exists. A human archive and an
agent archive are distinguishable. Use copy:true for downloaded local assets
(up to 50 MiB); the managed references copy survives source cleanup. See the
[guide moodboard loop](../../integrations/agent-skill/jam-board/SKILL.md#building-and-refining-a-moodboard).

Source/API evidence: crates/jam-core/tests/reference_feedback.rs and
crates/jam-mcp/src/canvas_tests.rs; stdio protocol coverage in
crates/jam-mcp-cli/tests/stdio.rs. Browser/native and human acceptance remain
separate and require the UI worker/QA evidence.
