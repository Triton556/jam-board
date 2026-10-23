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
