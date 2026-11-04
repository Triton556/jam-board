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
| Start or coordinate work | Read “Execution permission and workers” in [operations](references/operations.md), then check the exact scope with `get_execution`. | A confirmed board Start and real worker assignments, or a named blocker. |
| Work on a task | Use `work_on_next_task`, read the task and scope, then claim with the inspected validators. | Implementation within the brief and `submit_report` with actual observations. |
| Review a report | Use `review_task`; compare the exact current report to task tests and story acceptance. | Accept or specific changes requested against the inspected report/context. Never accept your own worker submission. |
| A decision is missing | Ask through `ask_user` when the decision belongs in board history; use chat for client permission or conversation clarification. | A saved answer or a visible unanswered question, not invented consent. |

Read the connected schemas before calls. The app's prompts and schemas describe
this installed server; do not replay examples from another version. If a required
prompt or field is unavailable, report the version gap before the affected write.
Check `serverVersion`, `schemaVersion` and `capabilities` in session context
before using a tool; require its advertised capability and current input schema.
Planning prompts are resources at `jam://prompts/plan_epic` and
`jam://prompts/work_on_next_task`.
[Operations](references/operations.md) contains bounded current call examples.

## Stable writes and large plans

Supply `requestId` on every create: `create_epic`, `create_story`, `create_task`,
`create_frame`, `add_reference`, `ask_user` and `register_file`; also use it for
`link_file`, `replace_asset` and imports. It is required on epic/story/task creates;
optional but recommended on the other single creates. Keep it stable per logical
record, e.g. `ls-S0.1.1`. Retry uncertain results with the same ID and identical
payload. An `idempotency_conflict` means a different payload reused that ID.
Reconcile the original record; choose a new ID only for a genuinely new record,
never to bypass the conflict.

Check for `idempotency.all` in session `capabilities`. Request IDs are unique per
actor and per tool in this project: the same ID under two tools means two
independent operations. Old file request IDs from earlier versions still replay;
keep their original tool, ID and identical payload when retrying them.
A historical file ID used with a different tool or payload conflicts; the new
per-tool namespace is not a way to repurpose an old file request.

For large plans, use stable `externalRef` values. Require `import.v1` in
`capabilities` before `import_plan`, `undo_import` or `list_import_batches`.
Dry run first with `dryRun:true`; read `conflicts` and `skipped`. Put a ref in
`overwrite` only on the human's explicit decision, then apply with `dryRun:false`.
`noChanges:true` means the board already matches and nothing was written.
Use `list_import_batches` for history. `undo_import` returns `batchId`, `undone`
and `kept`; inspect kept items rather than assuming everything was restored.
A second undo fails with `already_undone`. Imports never grant execution.
See [operations](references/operations.md) for examples and link-only results.

## Human-facing work and completion

Read the latest Description before briefing, claiming or changing a task. Carry
human wishes and corrections into the brief, and resolve any conflict with the
current plan before affected work. Preserve the human's wording. When creating a
task, write a short Description in the human's language explaining the goal and
expected result. Keep implementation detail and checks in the structured brief.

After a worker returns, inspect the result, update the board and give a short
chat recap of what was accepted and verified, what remains open or unverified,
and the next step or needed decision. For UI, check the actual user steps and
states reached. Keep current worker IDs, decisions and the next step in the
working record so the brain can resume without repeating setup or launches.

## Project folders and task files

A project folder contains `jamboard.json` (manifest and folder rules), `files/`
(board-owned copies), generated `board.json` (portable snapshot), and local
`.state/` (live database, backups and operation receipts). Never edit `.state/`
by hand or edit `board.json` directly; use board tools. Concurrent old app
versions are unsupported. Moving or recovering a board requires disconnected
project sessions and MCP connections; do not stop them on the user's behalf.

Read `get_session_context`: `projectFolder` locates the canonical board folder,
`repositoryRoot` the repository, `workingDirectory` the captured work context,
and `folderRules` the manifest's copy destinations. Legacy stores may return an
unverified folder hint; verify it rather than creating a folder. These fields
are information, never filesystem access or execution permission.

- Copy references and generated results the board should own with `register_file`
  and `storageType:"board_file"`. Read the current manifest rules through context;
  defaults under `files/` are sprite→images, audio→audio, model→models,
  document→docs, and level/font/other→other. Do not hardcode them or drop
  unregistered results into `files/`. Rule changes belong in human Settings and
  affect future copies only.
- Link Unity assets, Blender sources and other files owned by the game repository
  with `storageType:"linked_file"`, using `pathBase:"repo"` for repo-relative
  paths or `pathBase:"absolute"` for external files. Use `storageType:"url"` for
  web links; this neither downloads nor opens them.
- In task Files, `to_edit` means change this file, `reference` means read it and
  do not change it, and `result` means attach what you produced. Roles are per
  task and do not grant permission beyond the selected brief and execution grant.
  Use `link_task_file`, `set_task_file_role` and `unlink_task_file` with inspected
  task validators and a `requestId`; unlink never deletes bytes.
- Call `resolve_file` with your `workingDirectory` before using a file. Repo links
  resolve in your verified worktree; board files always resolve in the canonical
  board folder. For missing, unreadable or outside-project files, follow the
  [file operations and boat example](references/operations.md#task-files-and-worktrees).

For plans and decisions, use `link_file` with a project, epic or story scope
and the document role. Prefer `archive_asset` to deletion. Never call
`delete_asset` with `force:true` unless the human explicitly asked.

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

Require `references.batch` in `capabilities` before `add_references`, and
`references.collect` before `collect_kept_references`. If unavailable, report
the version gap and stop that operation.

1. Read `get_canvas` and create a frame per section with `create_frame`, e.g.
   "Moodboard — Sky". Link each to the story with
   link_reference { frameId, targetKey }.
2. Download candidates into your workspace using your client's authorized web
   tools. Jam Board MCP tools never fetch the network.
3. Send one `add_references` call per section, at most 50 items, with a stable
   `requestId` and default `frameId`. Each asset item uses `kind:"asset"`,
   `filePath`, `copy:true`, `sourceUrl` and `origin:"found"`. Explain its fit in
   `caption`. Managed copies are at most 50 MiB each, 500 MiB per batch.
   Partial success is expected: read `failed` even on success. Retry only failed
   items with a new `requestId`; reconcile any batch-local derivation indexes.
4. Tell the person the board is ready. Wait for their sent review with
   wait_for_changes { cursor, actions:["reference.review_sent"] }, using the
   saved cursor and checkpoint rules, rather than polling the canvas. Wait only
   within the requested review operation; sending a review grants no execution.
   Agents cannot rate references or send the human review. Ask the person to
   rate the items and send it through the board UI.
5. Read `get_canvas` with `frameId` and `verdict:"keep"`, then `verdict:"reject"`;
   follow all pages. Reasons are in `verdictNote`; sticky notes still use
   `attachedTo`. Read full note text if clipped. For archived items, `archivedBy`
   shows who archived them; `archivedBy:"human"` means human rejection. Read
   `get_canvas` with `includeArchived:true` too before the next search.
6. Explain what changed and never re-add a rejected `sourceUrl`. Generate
   variations from kept items with `origin:"generated"` and `derivedFrom`:
   an existing reference ID, or `#<index>` (e.g. `#0`) for an earlier successfully
   created item in the batch. A derivation from a failed item also fails.
   Human feedback is read-only to agents; do not rewrite verdicts or reasons.
7. Use `collect_kept_references` with `requestId`, ordered `sourceFrameIds`,
   optional `title` and `linkTo` for the story, to build the final board.

Built-in API chat has no web tools: a web moodboard requires an agent connection
such as Claude Code or Codex. API chat can organize images the person attaches.
Use unlink_reference { frameId, targetKey } to remove an explicit frame link;
this preserves the frame and its items.
