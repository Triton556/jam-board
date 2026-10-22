# Saved answers and manual brain continuation

Candidate on alpha32 base; release owner assigns the integrated version and map
updates. This is a **manual copy aid**, not an embedded agent/chat integration.

## Current behavior and scope

A successful human answer persists `question.answered` in the same transaction as
the answer. An agent in an active `wait_for_answer` call can receive the answer;
`wait_for_changes` can receive the activity with its existing project/epic/action
filters. Neither an answer nor a heartbeat proves that a model processed it.
A finished conversation is not automatically awakened.

The candidate adds **Continue in brain chat** to the confirmed answer receipt and
to persisted **Inbox → Answered** question cards. It reveals a selectable,
read-only prompt and a copy action. The prompt contains exact project, question,
scope and epic IDs, not the answer body or chat contents. The board remains the
source of truth. The agent is instructed to freshly verify the project, question,
current appointed brain and authorized phase before reconciling the answer.
No automatic appointment, Start, claim, worker launch or external message occurs.
A project question does not silently broadcast to every epic brain.

Pending/failed answer writes never produce a new saved receipt. A successful
readback in Answered is independently usable evidence. Existing uncertain-write
recovery is not replaced by automatic retries. Clipboard failure keeps text
selectable; repeated pending copy is singleflight. Project changes (including
A→B→A) and unmount invalidate pending clipboard feedback; dispatched clipboard
writes cannot be undone. A late answer response after a project epoch change
cannot publish the new receipt. Historical saved answers remain available when
the original project is deliberately reopened.

## Existing bounded observation, not a polling workaround

`wait_for_answer` accepts 1–100 question IDs and a 0–60 second timeout.
`wait_for_changes` accepts a 1–60 second timeout and returns at most 100 matching
ordered events. Handle returned pages before persisting `nextCursor`, including
on timeout. Excluded events consume cursor positions; changing filters needs an
explicit recovery policy. Preserve project/epic/filter identity and unprocessed
checkpoints. Fresh bootstrap captures `latestActivityCursor` before baseline
reads. Follow [the canonical contract](../mcp.md#waiting-as-a-brain), including
inclusive recovery and explicit reconciliation after possible database restore.
Continue live waiting only while requested observation remains active; stop at
its assigned stopping condition. These tools do not create a new monitoring
assignment or keep a completed conversation alive.

## Future integration is a separate concept, not implemented here

Official [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server#lifecycle-overview)
distinguishes `thread/resume` (load an existing thread) from `turn/start` (begin
generation), with `turn/steer` for a current turn. This provides a potential route
for an explicitly enabled, adapter-controlled thread; it does not establish
access to an arbitrary existing UI conversation or installed client version.

[MCP resource subscriptions](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
are optional application-driven change notifications, not guaranteed model-turn
triggers. [MCP sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)
is also negotiated and client-controlled, not proof of continuing the appointed
brain's existing chat. Current Jam Board has no thread binding, App Server
adapter, resource subscription notifier or sampling implementation.

Any future adapter needs separate approval/design: exact project/epic/member/
client-thread binding; current appointment recheck; durable deduplication and
outbox; uncertain-dispatch readback rather than blind retry; reconnect/replay;
archive/reassignment/revocation stopping; clear queued versus acknowledged
status; existing tool/permission boundaries. An ordinary answer remains
information, never execution approval. No daemon, credentials, network settings,
services or client configuration are added by this candidate.

## Acceptance handoff

Affected existing IDs: H-I01, H-P06 (answer receipt/card); AG04 (wait/read/reconcile),
AG10 (recovery); AC04, AC10 and AS03. Release owner updates canonical maps/version.

Focused tests: `src/features/inbox/answer-continuation.test.tsx` covers immutable
IDs, prompt size/omitted answer, persisted answered access, open/withdrawn exclusion,
failed/pending/confirmed answer, stale response after project ABA, copy failure,
singleflight, foreign project, unmount and zero copy-triggered board calls.
Existing `workflow-feedback.test.tsx` and `v22.test.tsx` are adjacent regressions.
DOM/mock and typecheck are not native, real-client or visual acceptance. No real
brain, live database, user PC, external message or automatic wake was tested.

### Revealed prompt spacing followup

Dedicated `answer-continuation.css` uses a 16px preview rhythm, 8px label/input
spacing, restrained border grouping and a 14px/1.6 selectable vertically resizable
textarea. Width and wrapping are bounded to the host card, using existing theme
colors. No shared form CSS changes. Prompt language follows original human notes
or the latest human request and asks when unclear; no automatic translation.
Actual narrow-window, light/dark and native visual acceptance remains pending.
