# Changelog

All notable changes to Jam Board are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0-alpha.7] - 2026-10-21

### Fixed

- Native human Move and Mark ready now require the task revision captured when
  the action began. The atomic writer rejects stale drag/drop and readiness
  decisions before changing status, round, ordering, override comments or history.
- Pointer and keyboard drag share a captured starting revision. Background updates
  cannot refill it; a refused drop refreshes authoritative board state instead of
  rolling a newer event back to an old optimistic snapshot.
- Readiness keeps its saved brief/status snapshot and override reason. A changed
  task blocks confirmation until an explicit reread; the latest saved brief and
  status are then inspectable without closing the decision or losing the reason.
- Mark ready saves dirty draft fields first, prevents duplicate checks, and leaves
  stable focus and honest feedback. A failed combined Ready/edit save retains
  unsaved fields rather than overriding a different saved brief.
- Supported smoke scripts use current captured task/review context. The installed
  fixture requires an explicit fresh-disposable run and exact parent/path/binary
  checks; historical capture scripts refuse current contracts before side effects.

### Added

- A current isolated real-stdio smoke checks binary/schema identity, complete
  planning, paused execution, missing validators and stale-write rejection without
  replay. It never fabricates a human Start or launches a worker session.
- Script preflight/client regressions and the isolated smoke are included in CI.

### Compatibility and verification

- **Native invocation change:** Move/Mark ready require `expectedUpdatedAt`.
  Generated bindings, UI, mocks and supported examples are synchronized. MCP
  requirements from alpha5 remain unchanged; SQLite remains schema 7.
- Fresh human manual Done remains an explicit non-reviewed completion. Existing
  grants, holders, reports and imports are preserved; no process is stopped.
- Alpha6's complete evidence/recovery fixes passed independent DOM review. Native
  alpha5 testing found an AX-associated Linux WebKit freeze at report/Settings
  table traversal; screenshot-only controls remained responsive. Its exact cause
  and native accessibility remain unresolved, not claimed fixed by this version.
- See versioned verification notes for exact local checks and unverified native,
  browser and Windows-installed paths. No public release or tag is implied.

## [0.3.0-alpha.6] - 2026-10-21

### Fixed

- Request changes now shows the complete captured report inside its modal: changed
  files, commands, expected/actual results, deviations and unverified work. Explicit
  rereading can replace evidence without closing the dialog or losing review drafts.
  The reader and decision dialog share one renderer to avoid partial-evidence drift.
- Test commands are visible text rather than hover-only hints. The review dialog is
  wider, with contained overflow for detailed evidence and readable wrapped output.
- Successful review clears the earlier “inspect before accepting” guidance; a Done
  receipt no longer contradicts a stale pre-acceptance instruction.
- Readiness override keeps failed reasons and actionable errors inside the modal,
  recovers failed initial reads, prevents duplicate submission/dismissal while saving,
  and returns focus to stable task/board context. Success explicitly leaves scope
  permission unchanged and does not claim to have launched a worker.
- Protected confirmation dialogs expose their busy state and disable the Close
  button rather than presenting an apparently usable control that does nothing.

### Verification and compatibility

- No new schema, MCP request contract, execution semantics or permission grant.
- The exact alpha5 backend passed an independent adversarial review. Its Linux
  native migration and first launch also passed; the longer fictional project
  journey remains in progress. This does not certify alpha6 native interaction.
- Exact automated checks and remaining limits are recorded in versioned verification
  notes. Remote branch CI remains alpha3-only; no current browser pass is claimed.

## [0.3.0-alpha.5] - 2026-10-21

### Added

- Persisted task claim generations prevent delayed report/release/status/edit
  requests from changing a later claim, even when the same agent reclaims it.
  Schema 7 preserves existing work and history without granting execution.
- Exact report + task/story/epic review-context checks for human and brain review.
  Reports & review freezes the snapshot being inspected; changed evidence requires
  explicit rereading instead of silently accepting a newer report or criteria.
- Review reconciliation keeps comments and selected failed tests. Obsolete test
  choices remain visible until reconciled; refreshed evidence receives logical focus.
- Source-token contrast regressions cover both themes, normal-size text, action
  buttons and all six palette-tinted card backgrounds.

### Changed

- **Breaking MCP request schema:** covered agent task mutations now require caller-
  captured claim and/or task versions; review requires exact report/context IDs.
  Missing or stale validators fail closed. Refresh tool schemas after upgrading,
  reread the task and reconcile drafts; never refill context and blindly retry.
  Tool names/count and read APIs remain unchanged. See `docs/mcp.md` for the matrix.
- Native human release keeps its confirmation CAS; native reports/reviews require
  captured context. Validators are freshness checks, not credentials, time leases,
  execution grants, process termination or external filesystem fencing.
- Cards show readable Story titles with the key retained in their full context.
  Epic Overview prioritizes Goal and Done when before optional References; Brain
  has a visible label and repeated header instructions use less vertical space.
- All board columns have aligned policy rows and contextual empty states. Quick
  capture creates Backlog drafts only. With epic filters, it requires a matching
  Story so a new draft cannot silently disappear into a different epic.
- Improved faint/error text in both themes and dark tinted-card readability while
  retaining the paper palette and task-scoped ring/pencil/handwritten animations.

### Fixed

- A successful claim returns its accepted generation inside the writer transaction,
  rather than accidentally returning a successor claim from a later read.
- Unsaved task edits cannot be skipped by accepting a report against older saved
  criteria. Failed/racing reviews keep the captured context and human draft.
- Quick capture retains failed titles, suppresses duplicate pending submissions
  and restores keyboard focus for the next draft or back to its trigger.
- Mock review context stays compact across 2,000-task persistence; targeted
  synchronization avoids an all-task loop on each creation.
- Browser scenarios now explicitly authorize synthetic worker fixtures and assert
  visible compact Plan navigation and honest task-scoped presence. The four old
  alpha3 CI expectations are replaced without disabling their interaction coverage.

### Compatibility and verification

- Old database/snapshot imports remain supported; imported validators are not
  authority. Active migrated holders can reread and report while paused.
- Append-only comments/questions/references, informational presence ordering and
  general epic/story edit CAS are explicit limits, not claimed as fenced here.
- Full automated checks and exact native alpha3 acceptance are recorded separately
  in versioned verification notes. Alpha5 native rebuild and independent review
  are pending at commit time; no Windows runtime or clean-distro claim is made.

## [0.3.0-alpha.4] - 2026-10-21

### Added

- Human-facing Release claim / Return to Backlog recovery for In progress tasks,
  including archived work. Confirmation names the project, task and current holder;
  clearing board tracking does not stop an external worker or change scope permission.
- Atomic native release checks the exact task revision and captured project. A
  reassignment, report or other task change while confirmation is open rejects the
  stale action instead of clearing newer work. Unassigned In progress rows can be
  returned to Backlog without inventing an assignee or report.

### Changed

- Reports & review shows the latest round first, with previous evidence in closed
  disclosures. Accept result and Request changes stay beside the current evidence.
- Modal keyboard navigation skips hidden/inert controls and closed disclosure
  content, while retaining the visible summary as a tab stop.
- Recovery feedback remains visible and focused after success. Pending operations
  cannot be duplicated or dismissed; failed confirmations retain their context.

### Verification and compatibility

- Independent exact-alpha3 review closed the review-bypass and archived-release
  findings and verified keyboard, feedback and startup probes. Its actual native
  Linux build now passes first cold launch and scoped Start/Pause/report checks.
- No new database migration or MCP tool. Native release adds versioned human
  confirmation; this does not yet give agent calls a per-claim generation token.
  An old payload from the same agent after a later reclaim remains a known gap.
- Full checks and limits are recorded in the versioned verification notes.

## [0.3.0-alpha.3] - 2026-10-21

### Fixed

- Native cold startup no longer waits for animation frames or a route-specific
  element before showing its hidden window. Fonts have a bounded wait; the
  first-frame receipt is written only if visible frames were actually observed.
- Agents cannot bypass independent report review by directly creating, moving,
  updating or releasing a task to Done—even when the agent is its epic's brain.
  Human manual Done stays available and is not mislabeled as reviewed acceptance.
- Existing holders and humans can release claims after task/story/epic archive,
  without reopening scopes, creating grants, altering evidence or faking reports.
- Enter opens a board card; Space still starts keyboard drag. Activation establishes
  an explicit focus-return target without starting or moving work.
- Epic filters no longer disappear below 1360px. Compact navigation retains epic
  titles and planning states instead of relying on unlabeled color dots.
- Filtering the board no longer hides a Doing-limit warning across its cards.

### Changed

- Main navigation has visible concise labels in its compact rail. The expanded
  sidebar remains available and the board retains horizontal scrolling.
- Execution controls use a compact permission/count/action layout with optional
  explanatory disclosure. “New work allowed” is distinct from actual agent activity;
  plan status has its own visible label.
- Fresh agent presence outside the task is quiet and labeled unconfirmed/elsewhere;
  only task-scoped activity animates the working ring, pencil and handwritten line.
  Reduced-motion behavior and the paper visual language are preserved.

### Verification and compatibility

- Independent review closed both alpha1 regressions at alpha2 and verified eight
  alpha2 feedback/focus/error scenarios. New safety fixes have adversarial, real
  stdio and full workspace coverage; independent retest of this exact version is
  still pending at commit time.
- No schema migration beyond v6. MCP remains 44 tools; direct agent Done is now
  intentionally rejected with guidance to use independent review.
- Native alpha1 screenshots reproduced the hidden filter and Enter behavior;
  exact alpha3 native rebuild/visual acceptance is the next step, not yet a claim.

## [0.3.0-alpha.2] - 2026-10-21

### Added

- Durable human-authorized Start/Pause for an exact story or epic, separate from
  brief readiness. Confirmations name the project and saved scope; they never
  launch operating-system processes or agent sessions.
- Typed Inbox start requests from the appointed epic brain, with explicit human
  approval or decline. Generic question answers cannot grant execution.
- MCP `get_execution`, `list_execution`, `request_execution` and
  `list_execution_requests` (44 tools total). Start/Pause/approval remain native
  human commands, not agent-callable capabilities.
- Task-specific permission guidance, persistent decision receipts and stable
  keyboard focus after scope changes, Inbox decisions and review submission.
- Migration, restart, cross-process claim/pause race, stale approval, inherited
  scope, archive recovery, HTTP and stdio regression coverage.

### Changed

- Every entry into new work checks scope permission, including direct status
  changes, task creation In progress, reassignment and follow-up review rounds.
  Existing holders may still report while paused, including archived evidence.
- Explicit story pauses survive epic resume. Pausing an epic blocks all new work
  beneath it. Closed or restored planning scopes never silently resume execution.
- Project and scope safety counts include individually archived In progress tasks;
  restore only changes visibility, not status, assignee, round or permission.
- Chat commands can request scope work through the brain, but still require a
  typed Inbox confirmation; no untrusted approval flag is accepted.

### Fixed

- Assigning a shared local member now adds project membership atomically, keeping
  project export/import round trips valid.
- Project picker counts and names refresh after board changes and on revisit.
- Failed review submissions show their error inside the active dialog and retain
  comments for retry; pending submissions cannot be duplicated or dismissed.
- Guidance no longer tells a running Ready task—or already reviewed result—to
  start its scope again.

### Compatibility and migration

- Additive database migration v6 creates execution state and request tables.
  Existing projects start paused for new work; existing assignments, rounds and
  reports remain intact. JSON import preserves work history, not grants/approvals.
- This intentionally tightens the MCP workflow: `execution_required` means ask
  the human to start the story/epic or approve its typed Inbox request. Ready
  overrides and brain roles cannot bypass that gate.
- Exact revisions and immutable project/scope IDs reject stale confirmations;
  UI project switching never redirects an existing MCP session or approval.

## [0.3.0-alpha.1] - 2026-10-21

### Added

- A persistent project picker: create separate boards, switch from the header,
  archive projects and restore them without changing individual task archives.
- Project-pinned MCP sessions and the read-only `get_session_context` tool.
  Generated stdio and HTTP configurations explicitly select their project.
- Scoped planning handoffs for a project, epic, story or task. Prompts preserve
  human notes, ask focused questions and explicitly separate refinement from work.
- An expandable workflow guide, visible epic-to-story navigation and a clearer
  three-step agent setup with a read-only connection check.
- Project isolation, migration, concurrency, stdio/HTTP pinning and UI regression
  tests; an automated check keeps application, package and changelog versions aligned.

### Changed

- UI selection no longer redirects connected agents. Native operations capture
  the initiating project, while MCP sessions keep an immutable project binding.
- Member presence, statuses, board events, recent calls, questions, attachments
  and references are project-scoped. Member profiles remain shared locally.
- Creating or loading a demo project keeps existing projects accessible.
  Archiving refuses while any task is In progress; finish or release that work first.
- Setup no longer suggests claiming a task just to test the connection.
  Ready describes a sufficiently specified brief, not human permission to execute.

### Compatibility and migration

- Database migration v5 initializes selection from the previously visible project
  and backfills project membership. Existing hierarchy and task archives are retained;
  old bulk-archived task flags are not guessed or automatically reversed.
- MCP sessions without an explicit project pin capture the selected project at
  initialization. Reconnect with `JAM_BOARD_PROJECT` / `--project` or
  `X-Jam-Project` to target a different board; there is no agent-side switch tool.
- This prerelease has 40 MCP tools. Durable story/epic execution approval gates
  are a subsequent development slice, not a capability of this alpha.

## [0.2.0] - 2026-10-21

### Added

- MCP `wait_for_changes`: filtered activity long-poll with cursor recovery,
  bounded waits and presence updates, using the shared cross-process feed.
- A three-level plan: epics, stories and tasks, with interview summaries,
  acceptance criteria and complete worker briefs.
- Plan and Inbox screens, recommended answers, readiness checks and scoped
  agent statuses. The epic journal records planning, work, questions and reviews.
- Labeled project-interview context in Plan journals keeps questions asked
  before an epic exists visible beside its later work.
- Worker reports and separate human/brain reviews, including changes-requested
  rounds and retained evidence. Workers cannot review their own work.
- A References canvas with local images, audio, video, files, notes, links,
  epic frames, hand-drawn connections and session undo/redo.
- Game jam, Gamedev, Web app and Custom templates; optional milestones and
  template-specific tag suggestions.
- Settings → Agents can install and verify a local agent-playbook skill profile
  for Codex or Claude Code. Nothing is downloaded or installed globally.
- Epic/story/readiness/flag filters in the task table and epic filters on the board.

### Changed

- MCP now exposes 39 tools, hierarchy resources and planning/work/review prompts.
- Readable working presence on cards, table rows and task headers, with paper-pencil
  motion, quiet stale status and static reduced-motion graphics.
- Flat paper cards default to epic coloring; estimates remain optional.
  Shared graphite controls, centered questions and unclipped reference links
  improve the existing light and dark paper themes.

### Breaking MCP and task workflow changes

- The task hierarchy is now required:
  `create_task` requires `storyKey`; tasks always belong to a story and an epic.
- `todo` becomes `backlog` during migration. Columns are Backlog, Ready,
  In progress, Review and Done. Legacy descriptions remain editable Notes.
- Ready requires a complete brief. Workers claim Ready work and submit reports;
  humans or an appointed brain accept it. Overrides require a recorded reason.
- `needsInfo` means an open question on that task only. Ancestor questions remain
  visible in task context without flagging every descendant.
- JSON export version 2 retains hierarchy, briefs, reports, questions and
  references. Version-1 imports remain supported.

### Fixed

- Windows release builds launch as GUI applications without an attached console.
  The release workflow now rejects desktop executables built with the console subsystem.
- Returning submitted work to In progress allocates a usable successor report
  round, preserving earlier reports and reviews. Repeated same-status moves do
  not allocate extra rounds; rejected transitions leave state and history intact.
- Live epic/story updates preserve unsaved title and worker-model drafts.
  Same-field conflicts offer explicit local/remote choices; queued saves remain
  attached to the original entity.
- Unsaved story acceptance criteria survive drawer close and navigation during
  the current app session. Validation, failed-save retry and overlapping saves
  retain the correct story and newer input.
- Workers cannot bypass claim/report or holder rules through generic moves,
  release or direct working-status creation. Human/appointed-brain planning and
  recorded Ready overrides remain available.
- MCP initialization now describes Ready → claim → `submit_report` → separate
  human/appointed-brain review.
- Release checksum generation uses actual uploaded installer filenames and
  verifies their bytes against the local build, including space/dot name changes.

See the [MCP contract](docs/mcp.md#breaking-changes-in-v02) for integration changes.

## [0.1.0] - 2026-10-20

### Added

- Local Windows task board, virtual task table, Markdown editing, comments,
  assets, team presence, activity and light/dark paper themes.
- SQLite WAL storage, live MCP changes, stdio/loopback HTTP transports,
  JSON import/export and non-destructive task/project archival.
- Unsigned per-user NSIS installer with the MCP sidecar.
