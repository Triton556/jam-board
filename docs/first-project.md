# From a rough idea to reviewed work

A short walkthrough for a **fictional** project, “Desk Notes”. These are planning
examples, not instructions to provision a real server or launch an agent process.

## 1. Make a separate board

Use **Switch project** in the top bar, then **New project**. Choose **Custom**
for a general project, give it a name and create it. Use **Your projects** to return
to another board; a project switch does not move tasks or stop workers.

The hierarchy is **Project → Epic → Story → Task**:

- **Epic:** a larger goal, such as “Desktop application” or “Server preparation”.
- **Story:** a feature-sized outcome, such as “A note can be saved and reopened”.
- **Task:** a small brief with a result and a way to check it.

In **Plan**, create the two epics. Select one and open **Stories** or its story-count
button. Stories are the feature layer; there is no extra Feature entity to create.
If an epic seems missing, check the visible Active/Draft/Done/All filter.

## 2. Connect a brain without starting implementation

Open **Settings → Agents** and follow the three steps:

1. Copy the configuration for the named project into your chosen agent client
   yourself. Stdio runs the sidecar; HTTP requires Jam Board to be open.
2. Reconnect the client and use **Copy connection check**. The check must identify
   the intended project before reading its board. A copied snippet alone is not
   proof that the agent connected.
3. Appoint a planning brain for the epic. You can select the connected agent under
   **Plan → Epic → Brain**, or explicitly appoint it in chat for an unassigned epic.
   This role is not an execution grant and does not launch a model.

The optional playbook is separate from this connection. Its older examples may
not contain current required fields; use live MCP schemas and the current in-app
prompts. See [the compatibility note](agent-playbook-compatibility.md).

**Important:** a connected session stays pinned to its project. Switching boards
in Jam Board does not redirect it. To use another project, create or replace that
client's connection entry with the other project's configuration and reconnect.
Keep entries clearly named when connecting more than one project.

## 3. Capture an incomplete idea

If the intended Story already exists, open it in **Plan** and use **+ Task**.
Alternatively, filter **Board** by its Epic, use **Add task to Backlog**, and choose
**Story for new draft** before adding. Both routes create directly in that Story.

Without an Epic filter, Board quick capture goes to **Unplanned work**. It reuses
an existing Story with that name or creates a draft Epic and Story when needed.
This candidate has **no UI or MCP action to change an existing task’s Story**;
choose the intended Story at creation when placement matters. Refining a brief
in place does not relocate the task or its evidence.

A title and rough Description are enough to start planning in **Backlog**; do not invent
a complete specification just to capture an idea. Attach local
assets or link material from **References** to the task, story or epic.
Local-file references retain their paths; they are not uploaded or copied to the
agent. The connected client still needs its own permitted access to those files
and your knowledge base. If it cannot read a source, it should say so and ask for
accessible material rather than invent what the attachment contains.

**If a save returns an error:** this is not always proof that nothing was written;
a notification can fail after persistence. Inspect fresh data in the intended
project for the submitted item before intentionally retrying. The pending
button lock prevents simultaneous sends, not duplicate creation after an uncertain
result. The app does not automatically replay the mutation.

Choose **Refine with brain**, inspect the prepared project/scope and copy the
planning prompt into the connected brain's chat. For example, add:

> Review these two epics and their existing stories. Read the linked source
> material. Ask about missing decisions, then propose small task briefs. Keep
> this planning-only; do not start implementation.

For a whole-project capture review, the prepared prompt asks the brain to page
`list_tasks` through `nextCursor`, including non-archived, unassigned Backlog cards.
`get_board` is a summary, not the complete task inventory. The brain then inspects
relevant task descriptions, comments, assets, questions and linked sources. Epic/Story/Task refinement
stays within the requested scope; it does not scan every other project task or
archived work by default. This is an instruction, not proof that a model obeyed it.

The prompt is a message, not an automatic agent launch. The brain should preserve
source intent and ask where project knowledge or repository instructions are
located rather than assume it has access.

## 4. Answer, edit and reconcile

Answer the brain's questions in **Inbox**. An ordinary answer is information,
not permission to start work. The connected brain can read it and revise the plan;
Jam Board does not start a new chat session when you answer.

Start with **Description** in the Story or Task. Write the outcome and wishes in
your own language; Jam Board preserves your text and does not automatically
translate or generate a summary. A Task also has **Comments** for follow-up
corrections or questions. Posting one does not start the brain. Story-level
comments are not part of this candidate; do not use **Open decisions** as a hidden
comment thread.

Open **Agent plan** when you want to inspect the proposed acceptance criteria or
**Goal / Context / Where / Changes / Tests / Boundaries / Result**. It starts
collapsed to keep the human description visible; collapsing it does not erase
fields or bypass readiness. Existing tasks without a description can show
**From the agent plan**, a clearly labelled existing goal for context, not a saved
or automatically generated description.

Use a prose field's explicit **Edit** action; text and reference links remain
reading surfaces. Save your description or structured edits, then choose
**Refine with brain** and ask the connected brain to reconcile them. It should
explain what changed and what remains unclear instead of overwriting your edits.
Task descriptions use **Save**; Story prose also retains its existing blur and
Ctrl/Command+S save behavior. In-session draft retention is not a durable backup
across an app restart.

If your save conflicts with another edit, inspect the comparison. **Read latest**
updates the comparison while retaining your draft; it does not replay the save.
Only save after comparing the new version. Changed lists replace that entire list,
not individual rows. You can close the comparison and keep working on the draft.

## 5. Ready is not Start

Mark a sufficiently specified task **Ready**. This means its brief is usable, not
that workers may execute it. The Story's **Planning status** also describes planning;
it is distinct from **Worker permission**, shown as **New work allowed / New work paused**.

When you want implementation to begin, **Start the story or epic** in Plan and
confirm the exact scope. Or ask in brain chat; the brain creates a typed Start
request for that scope, which you approve in **Inbox**. The app currently requires
this explicit approval—ordinary chat text or an answer containing “start” is not
a trusted authorization bridge.

Once authorized, the brain can organize connected workers inside the scope without
asking you to launch each worker separately. Jam Board records permission and
work; it does not create OS agent sessions or install an execution environment.

## 6. Follow evidence and review the result

The Board shows task progress. **Enter** or **Space** opens a focused card;
use its **Status** control and Save for keyboard status edits. Board dragging is
pointer-only. The status control does not reorder tasks within a column.

A worker's task-specific status can animate its card; an online agent without a matching task status is labelled unconfirmed
rather than presented as proof of task activity.

Open a submitted task's **Reports & review**. Read changed files, commands,
expected/actual test results, deviations and **Not verified**. Accept sufficient
results or request changes with precise comments. An independent human or the
appointed brain reviews; workers cannot approve their own reports.

If the report or acceptance context changed while you were deciding, the app
requires **Read latest evidence**. Your comments and still-applicable test choices
remain available, but the new report and criteria still need inspection. **Go to comments** and
**Back to captured report** move within the dialog without discarding the draft.

Accepting records the decision and moves the task to **Done**. Requesting changes
returns it to **Ready** for another round and preserves earlier evidence. Human
manual Done is different from a recorded report review.

## Pause and recover safely

- **Pause** stops new claims/restarts in that scope; existing work can still report.
  It does not terminate a worker process. Pausing an epic also blocks its children;
  separately paused stories stay paused when that epic is started again.
- **Release claim…** returns board tracking to Backlog and clears the holder while
  preserving evidence. It does not stop the worker or grant new permission. Old
  work from a released claim cannot be silently reused as a new claim's report.
- Archive a project only after dealing with its In progress tasks, including hidden
  archived cards. **Archived projects → Restore & open** restores visibility, not
  execution authorization.
- On stale-context errors, preserve the draft, reread and reconcile intentionally.
  Do not replace validators and resend an old decision automatically.

For precise tool contracts and inheritance rules, see [MCP documentation](mcp.md).

## File-drop receipts

Dropping multiple files into Assets or References sends separate requests. Leaving
that page or switching projects stops the unsent remainder, not the request already
in flight. Check the receipt's project name/prefix and expanded file details:
**confirmed**, **unconfirmed request**, and **not attempted** are different outcomes.
An unconfirmed request may already have saved its file. Inspect that project before
re-dropping only the files still needed; the app does not retry or roll back the batch.
Problematic receipts are retained only within the latest three notices of this app
session, not a durable queue. Closing the app does not guarantee a later receipt.

## Several independently tracked workers

Settings → Agents shows the pinned project and the separate **Agent identity**
explanation. Give independently configured connections distinct stable names via
`JAM_AGENT_NAME` (stdio) or `X-Jam-Agent` (HTTP), then reconnect. A new chat or an
inherited subagent does not automatically become a separate board member; shared
names aggregate work and cannot independently review their own reports. This does
not change Story/Epic worker permission or launch a session. The command palette's
**Set up agent connection (MCP)…** opens this same setup flow.

## A read fails or a file batch settles after you return

Use **Refresh assets** or **Refresh references** on the captured project's page
before inspecting a late or unconfirmed file result. Refresh only reads; it does
not re-send files, resume an abandoned batch or roll anything back. Keep your
filters, inspect what actually exists, and re-drop only the remaining files you
still need. Captured-project receipts distinguish confirmed, unconfirmed and
not-attempted requests.

A failed background read can show the last loaded view with a warning. References
note drafts, Board quick capture and the Plan new-epic dialog remain mounted through
those list failures. The read retry does not save or clear your text. An initial
failure with no cached view still shows a separate error/retry screen.

Selected-Epic and Story Markdown editors likewise remain mounted when their cached
background detail read fails. A background retry does not blur or save the field.
Markdown's normal user-blur save is unchanged: moving focus away yourself, including
to a read-retry button, can still save your edit. These are separate actions.

## Pasting an image into References

An image may need local decoding and encoding before it is sent. Leaving References
or switching projects stops that preparation from becoming a new write, even if you
later return. If the request was already sent, it is not cancelled. Read the receipt's
captured project: **confirmed**, **unconfirmed request**, and **not attempted** mean
different things. An unconfirmed request may already have saved the image. Open the
captured project and use **Refresh references** before deciding whether to paste it
again. No paste is automatically replayed; receipts use the same session-only bound
as file-drop notices.

## If a Board move does not return confirmation

Dragging still uses the same readiness and scope-permission checks. While a move
is saving, cards keep their last read/event positions rather than jumping to an
unconfirmed destination. The board reads the result after the request settles.
A generic error says **Move result unconfirmed**: native persistence may have
succeeded before notification failed. The notice retains its explanation until
it is dismissed or displaced by the existing three-notice session limit.
If refreshing fails, **Try again** retries only the read. Inspect the task before
another intentional move; there is no automatic replay or rollback. Leaving the
Board or switching projects invalidates that view's completion callbacks, not an
already-dispatched native request. Reopen the intended project and inspect fresh
state if you left while the move was settling.
