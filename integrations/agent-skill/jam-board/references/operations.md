# Current board operations

Use this reference for the specific board operation, not as a universal agent
workflow. Server schemas remain authoritative. Example placeholders below are
bound to records read during the same decision; they are not literal values.

## Connect, bootstrap and resume

1. Call `get_session_context`; verify the intended exact `projectId` before
   reading board records. A matching name/prefix does not replace the ID.
   Its `projectFolder` is the canonical folder anchor for folder boards; legacy
   stores may return an unverified hint. Read `repositoryRoot`, `workingDirectory`,
   `folderRules` and `manifestRevision` too. If the folder is absent, ask for its
   location rather than guessing or creating one. None of these fields grants access.
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

## Task files and worktrees

Use `get_task` and inspect `files` (the task Files section), including each asset
and its role. Copy vs link and manifest folder rules are described in the guide.
`register_file` requires `storageType` and `requestId`, plus `sourcePath` for a
local file or `url` for a web link. Board storage copies the source; linked
storage retains its path. For repo-relative registration, supply your verified
`workingDirectory`. Optional registration with `taskKey` also needs `role`,
`expectedClaimGeneration` and `expectedUpdatedAt` for an atomic task link.

`link_task_file` and `set_task_file_role` require `taskKey`, `assetId`, `role`,
`expectedClaimGeneration`, `expectedUpdatedAt` and `requestId`. `unlink_task_file`
requires those same fields except `role`; it removes only the task association,
never the asset, bytes, canvas references or history. Role/order writes change
the task revision. Read current `claimGeneration` and `updatedAt` with `get_task`
before each new decision; pass them as the expected validators. Preserve intent
and reread/reconcile on stale/conflict instead of blindly retrying with new tokens.
Reuse a request ID only for an uncertain retry of the identical payload; a new
intent needs a new ID. These writes do not grant Start or create agent sessions.

Resolve again before opening or editing. `resolve_file` with `assetId` and your
`workingDirectory` resolves repo links in a worktree of the same Git common-dir;
an unrelated repository is refused. Inspect `resolutionBasis` and `worktreeRoot`:
without a caller cwd the basis is the anchor repository, not a guessed worktree.
Board files always use the canonical board anchor regardless of cwd.

- `status:"missing"`: report the missing path and ask for the source or corrected
  link; do not create a replacement silently.
- `status:"unreadable"`: report access failure; do not describe it as missing.
  `status:"unknown"` is unverified, not permission to open or edit.
- Outside project is `pathBase:"absolute"`, not an availability status. Check the
  exact resolved path and explicit authorized scope before access; ask if outside
  scope. Do not turn an escaping repo path into an absolute link to bypass refusal.
- URL assets are web links, not worktree files. Resolution does not fetch them.

### Worked example: fix the boat model

Assume the user selected this task, execution is running, and you have claimed
it through the normal protocol. Placeholders below come from inspected records
and your authorized workspace; each line is a tool call, executed in order.

1. Get the task and see Files. Select the model whose role is `to_edit`, not a
   `reference`. Resolve its asset in your worktree and inspect availability and
   scope, then edit that resolved model within the brief. Export the produced
   result to your workspace through your existing authorized tools.
2. Register that result as a board-owned copy using the current folder rules.
   Use the returned `asset.id` as `$resultAsset`, reread the task, and link the
   result with the fresh task validators. Registration alone is not a task link.

```json
[
  {"tool":"get_task","arguments":{"key":"$task"}},
  {"tool":"resolve_file","arguments":{"assetId":"$toEditAsset","workingDirectory":"$workingDirectory"}},
  {"tool":"register_file","arguments":{"storageType":"board_file","sourcePath":"$exportedBoatPath","fileKind":"model","requestId":"boat-result-copy-1"}},
  {"tool":"get_task","arguments":{"key":"$task"}},
  {"tool":"link_task_file","arguments":{"taskKey":"$task","assetId":"$resultAsset","role":"result","expectedClaimGeneration":"$freshGeneration","expectedUpdatedAt":"$freshUpdatedAt","requestId":"boat-result-link-1"}}
]
```

For an explicitly requested role correction or unlink, inspect the task again
and use the appropriate call below, not both as a sequence:

```json
[
  {"tool":"set_task_file_role","arguments":{"taskKey":"$task","assetId":"$asset","role":"reference","expectedClaimGeneration":"$freshGeneration","expectedUpdatedAt":"$freshUpdatedAt","requestId":"file-role-1"}},
  {"tool":"unlink_task_file","arguments":{"taskKey":"$task","assetId":"$asset","expectedClaimGeneration":"$freshGeneration","expectedUpdatedAt":"$freshUpdatedAt","requestId":"file-unlink-1"}}
]
```

## Ideas canvas and moodboards

Canvas rules live in the guide's ideas canvas section. For requested moodboards
and human feedback, follow the [guide moodboard loop](../SKILL.md#building-and-refining-a-moodboard).
Use frameId in link_reference / unlink_reference; read human verdicts, note
attachedTo and archive attribution before the next search.
