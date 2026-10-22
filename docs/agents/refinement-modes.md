# Refine: new conversation or continuation

Candidate for alpha31; source/DOM coverage is not agent-model or native acceptance.
Human path **H-P07**, agent actions **AG02.setup/continue/request**, acceptance **AC02**.

## Person's goal and interaction

`Refine with brain` / `Plan with brain` opens one dialog with the project label,
exact IDs, an explicit conversation-context choice, an optional **What should
change?** request and a selectable preview. **First / new chat** is the initial
choice. **Continue in this chat** removes repeated onboarding detail; it does not
infer session memory from an agent name, heartbeat or previous Copy.

The user's choice and request are retained per exact project + entity ID in this
app session, across Close, route/entity changes and a return to the project. This
is a local draft, **not** a saved comment, chat transmission or persistent file;
restart discards it. A mode change preserves the request. Empty request is omitted
from the prompt. Supplied text is JSON-quoted intact rather than treated as an
application command. Clear the request normally to remove it from the preview.

The target is captured at dialog open. Rename, selection change or refreshed props
cannot silently retarget mode changes or clipboard output. The warning names the
old target; close/reopen to intentionally capture another one. Entity IDs come
from actual Epic/Story/Task DTOs, never guessed from titles.

Copy is single-flight. Mode/request edits are disabled while its immediate
clipboard write is pending; Close remains available. A dispatched clipboard write
cannot be cancelled, but an old completion cannot announce in a reopened dialog.
Failure keeps selectable preview and local request; no automatic retry. Copy does
not connect, appoint, launch, claim, update the board or establish model compliance.

## Agent instructions and limits

Both modes verify the exact project and scope before scoped changes, require live
schemas and validators from inspected context, preserve human input and separate
planning from execution even when the scope is already running. Continuation must
ask for setup if its remembered planning/recovery contract is missing or uncertain.
Setup preserves unfinished checkpoints; a fresh high-water cursor is captured
before baseline reads, never substituted for unprocessed progress. The server's
current recovery contract remains authoritative.

For new/refined tasks the guidance asks for a concise outcome in the user's
language only when human Description is empty; existing wishes stay intact.
Technical detail belongs in the agent plan. This is guidance, not automatic
translation, a new Ready gate or a guaranteed generated summary.

Inbox is recommended for project decisions the person wants tracked; free
conversation and client permission questions may stay in chat. An agent must say
what it actually saved. Start permits a scope, not process launch or waking an
agent conversation. A task claim records pickup. Read-only replacement-brain
handover remains a documented recipe, not a third mode or automatic role transfer.

The preview reports words and UTF-8 bytes. These are observable text sizes, **not**
token counts, cost savings or a model-performance benchmark.

## Acceptance

`features/brain-handoff.test.tsx` covers exact targets, mode/request retention,
project return/isolation, smaller continuation plus safety clauses, clipboard
failure/single-flight/late completion and no board writes.
`e2e/refinement-modes.spec.ts` adds actual radio-keyboard/copy/return-focus/full-task
invariance checks; browser execution pending at lane handoff.

Final native acceptance must inspect open dialog spacing, both themes, narrow
viewport, long request/IDs, visible pending/error and keyboard return. A real
agent-created understandable human summary is an end-to-end scenario, not proven
by string assertions. No paid model run or user's live session was used.

## Rationale

MCP defines user-controlled prompt templates but does not require any particular
client UI. Two explicit choices expose context assumptions rather than pretending
to detect a conversation. [MCP prompts specification](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts).
The shared radio-group control retains one selected choice and arrow/Space
activation, rather than mixing manual-tab behavior with mutually exclusive options.
[WAI-ARIA radio group pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/).
