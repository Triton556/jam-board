# Current board operations

Use this reference for the specific board operation, not as a universal agent
workflow. Server schemas remain authoritative. Example placeholders below are
bound to records read during the same decision; they are not literal values.

## Connect, bootstrap and resume

1. Call `get_session_context`; verify the intended exact `projectId` before
   reading board records. A matching name/prefix does not replace the ID.
   Its `projectFolder` is a saved filesystem hint: verify existence in this
   environment; if absent, ask for a folder rather than guessing or creating one.
2. For a new context only, retain `latestActivityCursor` BEFORE baseline reads.
   Read the selected scope and relevant children, questions, comments, reports
   and references. `get_board` is a summary; page `list_tasks` for a full inventory.
3. Resume an existing context from its saved project/scope/filter/checkpoint,
   never by replacing an unprocessed checkpoint with a fresh cursor or zero.
4. Use `wait_for_changes` with `excludeSelf:false`, `includeProject:true` and
   `timeoutSeconds:1`; process each page before saving `nextCursor`, including
   timeout pages. Drain until `timedOut:true`. Use 60 seconds only for assigned
   ongoing observation. `list_changes_since` is for deliberate historical audit.
5. Keep checkpoints in the current task/session record, not personal biography.
   Filters consume excluded events; widening requires explicit reconciliation.
   Baseline/replay is not an atomic snapshot: deduplicate overlapping observations.

## Plan, start, work, report, review

The example is executed by the disposable stdio integration test. The test's
human approval is a fixture action, never an MCP tool or a shortcut for users.
For real use, the human presses Start in Plan or approves a typed Inbox request.
Use the server planning prompt for questions and existing-work reconciliation;
create the example records only for a genuinely new requested plan.

```json
{
  "epic": {"title":"Skill example","goalMd":"Make the requested interaction understandable","doneWhenMd":"The described user step has verified evidence"},
  "story": {"epicKey":"$epic","title":"Readable interaction","outcomeMd":"The user understands the result","acceptance":[{"id":"A1","criterion":"The requested step shows a clear result","mandatory":true,"check":"Perform the step and inspect the result"}]},
  "task": {"storyKey":"$story","title":"Implement the interaction","goalMd":"Show the requested result","whereMd":"The selected project interaction","changes":[{"title":"Feedback","required":"Show the result of the user action"}],"tests":[{"setup":"Perform the requested action","expected":"Its result is readable and visible"}],"resultMd":"Changed files, observed checks and limitations"},
  "claim": {"key":"$task","expectedClaimGeneration":"$generation","expectedUpdatedAt":"$updated"},
  "report": {"key":"$task","expectedClaimGeneration":"$generation","summaryMd":"Disposable protocol fixture, not an application UX claim","changedFiles":[],"tests":[{"name":"A1","command":"Fixture observation","expected":"Fixture result","actual":"Fixture result","result":"PASS"}],"deviationsMd":"Protocol test only","notVerifiedMd":"No live model or product UI tested"},
  "review": {"key":"$task","verdict":"accept","expectedReportId":"$report","expectedReviewContextRevision":"$revision","commentsMd":"Exact fixture evidence inspected","failedTests":[]}
}
```

- Appoint the brain only for an unassigned epic with the user's authorization;
  `become_brain` is not permission to replace another coordinator.
- Activate the agreed epic/story; run `check_ready`, then `mark_ready` with
  `expectedClaimGeneration` and `expectedUpdatedAt` from the inspected `get_task`.
- Before claiming, call `get_execution` for the story and require
  `effectiveState:"running"`. Ready alone is insufficient. Only the appointed
  brain requests Start approval, not a worker attempting to bypass a pause.
- Retain the generation returned by a successful claim for that attempt's report
  or release. Task edits/moves/archive/Ready also require the inspected update
  revision. `get_task` is the source, not guessed timestamps or replacement tokens.
- Review the current report and criteria, retaining its exact ID and
  `reviewContextRevision`. The assignee/report author cannot review their work.
- On stale/conflict, preserve the draft, reread what changed and reconsider the
  decision. Never silently fetch new validators merely to replay old intent.
- A returned task requires a new claim and report round. Old evidence remains
  history, not proof that the corrected version was checked.

## Organizing the ideas canvas

Read `get_canvas` before moving things, following `nextCursor` while
`truncated` is true. Prefer frames per epic. Do not rearrange the human's manual
layout unless asked. Use `create_frame` / `update_frame` for frames,
`connect_references`, `update_connection` and `remove_connection` for labelled
directed connections, and `arrange_references` for explicit world positions or
`layout:"grid"` inside a frame. Grid preserves unselected occupants and rejects
the whole batch if it cannot fit. A write response is not a concurrency token:
reread and reconcile uncertain results before an intentional retry.


For requested moodboards and human feedback, follow the [guide moodboard loop](../SKILL.md#building-and-refining-a-moodboard). Use frameId in link_reference / unlink_reference; read human verdicts, note attachedTo and archive attribution before the next search.
