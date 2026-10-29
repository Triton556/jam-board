---
name: jam-board
description: Use a connected Jam Board to plan, execute or review explicitly selected board work. Use only when the user selects this board; installing the skill or connecting MCP does not start work.
---

# Work with Jam Board

This skill belongs to Jam Board and ships with its MCP version. It does not require
agent-playbook, a particular model, a universal brain skill or another task planner.
The agent client owns session creation and model selection; the board owns its
project records, assignment, questions, execution permission and reports.

## Choose the requested operation

| Request | Read / do | Result |
| --- | --- | --- |
| Connect or resume | Call `get_session_context` and match the intended exact project ID before board reads. Use the bootstrap/recovery section in [operations](references/operations.md). | Correct project and handled checkpoint, or a named connection mismatch. |
| Plan or refine an epic, story or task | Read the selected records and relevant human descriptions, comments, questions and assets. Use the server's `plan_epic` prompt for the current protocol. | Preserved human intent, resolved or visible questions, actionable briefs. Planning does not execute work. |
| Coordinate started board work | Check the selected scope with `get_execution`. Organize permitted worker assignments using the client's existing capabilities and the user's selected settings. | Actual worker IDs and board assignments, or an honest launch blocker. |
| Work on a task | Use `work_on_next_task`, read the task and scope, then claim with the inspected validators. | Implementation within the brief and `submit_report` with actual observations. |
| Review a report | Use `review_task`; compare the exact current report to task tests and story acceptance. | Accept or specific changes requested against the inspected report/context. Never accept your own worker submission. |
| A decision is missing | Ask through `ask_user` when the decision belongs in board history; use chat for client permission or conversation clarification. | A saved answer or a visible unanswered question, not invented consent. |

Read the connected schemas before calls. The app's prompts and schemas describe
this installed server; do not replay examples from another version. If a required
prompt or field is unavailable, report the version gap before the affected write.
[Operations](references/operations.md) contains a bounded current call example.

## Human-facing work and completion

Keep the human Description understandable and preserve their text. Put execution
detail in the structured brief and changes in comments. State actual progress on
the selected scope. For UI work, report the user steps and reached states you
actually inspected, including readability, hidden surfaces and recovery; passing
unit tests or a build is not visual acceptance.

A human Start of a story/epic grants board execution; it does not launch or wake a
client session. A question answer, Ready, heartbeat or copied prompt is not Start.
Pause prevents new claims but does not stop external processes. Finish at the
requested result and report checks and limits. Do not start ongoing monitoring
solely because a wait tool exists. Reports persist on the board; they do not
contain all conversation or source files.

## Organizing the ideas canvas

Read `get_canvas` before moving things, following `nextCursor` while
`truncated` is true. Prefer frames per epic. Do not rearrange the human's manual
layout unless asked. Use `create_frame` / `update_frame` for frames,
`connect_references`, `update_connection` and `remove_connection` for labelled
directed connections, and `arrange_references` for explicit world positions or
`layout:"grid"` inside a frame. Grid preserves unselected occupants and rejects
the whole batch if it cannot fit. A write response is not a concurrency token:
reread and reconcile uncertain results before an intentional retry.

## Building and refining a moodboard

When the user requests a web moodboard for selected work:

1. Read get_canvas and create_frame with title "Moodboard — <topic>" beside the
   related work. Use link_reference { frameId, targetKey } to link it to its
   story or epic; current and future children become references of that target.
2. Find candidates using your client's own authorized web tools and download
   them into your workspace. Jam Board MCP tools never fetch the network.
3. Call add_reference { kind:"asset", filePath, copy:true, frameId, caption }.
   Caption each candidate with its source URL and one line explaining its fit.
   Managed copies (at most 50 MiB each) survive temporary workspace cleanup.
4. Call arrange_references with frameId, the candidate item IDs and layout:"grid".
5. After the person reviews, read get_canvas { frameId, includeArchived:true },
   following all pages. verdict:"keep" means Keep; verdict:"reject" or an item
   archivedBy:"human" means rejected. For each note, attachedTo names the items
   it comments on. Read its full reference text if the canvas excerpt is clipped.
6. Search again using that feedback, explain what changed, and never re-add a
   rejected source. Human feedback is read-only to agents; do not rewrite verdicts.

Built-in API chat has no web tools: a web moodboard requires an agent connection
such as Claude Code or Codex. API chat can organize images the person attaches.
Use unlink_reference { frameId, targetKey } to remove an explicit frame link;
this preserves the frame and its items.
