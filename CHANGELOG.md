# Changelog

All notable changes to Jam Board are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0-alpha.13] - 2026-10-21

### Fixed

- Virtual table windows retain a visible keyboard entry after scrolling, row removal,
  filtering and sorting. Mounted overscan rows outside the usable viewport do not
  count as visible. Genuine row focus is preserved by task identity when possible;
  search/filter controls keep their own focus. Arrows, Home/End and Enter continue
  working without rendering the whole table. Read failures offer an explicit Retry.
- The table's inline New task editor captures submitted values, prevents duplicate
  writes and visibly holds its pending form. Known errors preserve the complete
  draft for explicit retry; old project/unmounted completions cannot erase a newer
  draft, announce success or scroll another table. Its feedback sits above the
  fixed-height virtual header rather than overflowing the row. This is separate
  from the Plan creation dialogs repaired in alpha12.
- Mock readiness now matches Rust's Unicode whitespace rules, including NEL versus
  BOM and NUL-containing text. Authoritative readiness and execution policy are
  unchanged; this closes a development/test bridge inconsistency.
- Success/recommendation text and ending countdowns use theme-specific ink colors
  instead of lower-contrast decorative colors. Decorative rings/palette stay intact.

### Improved

- The project header explicitly says **Switch project**, retaining the full name in
  accessible text and its title. **Planning status** and **Worker permission** are
  named separately, with a concise reminder that Start permits claims, not launch.
- Overflowing boards show directional cues and bounded Left/Right controls. A named
  keyboard-focusable region supports Left/Right/Home/End only when the region itself
  is focused; task-card opening and drag keys are unchanged. Controls track resize
  and disappear when all columns fit. Scrolling is immediate, including reduced motion.
- Welcome loads only when onboarding is needed. The unchanged initial JavaScript
  budget caught a small overrun; a real empty-app-to-demo/router test verifies the
  lazy boundary rather than raising the limit.

### Verification and limitations

- See [exact-version verification](docs/verification/0.3.0-alpha.13.md). Virtual
  geometry is explicitly synthetic in DOM tests; this batch is not a new native,
  browser frame-time or accessibility-conformance claim. No database migration,
  dependency, execution grant, MCP or native request contract change.
- Pending UI locks do not cancel or make submitted writes idempotent. An uncertain
  write must be inspected before repeating it; no automatic timeout/retry is added.

## [0.3.0-alpha.12] - 2026-10-21

### Fixed

- Epic, Story and planned Task creation now keeps a visibly pending dialog open
  until its submitted write settles. Escape, backdrop, Cancel, repeated Enter and
  repeated clicks cannot dismiss or duplicate the in-flight operation. Processing
  text receives focus; a known failure restores editable fields and retains the
  title/parent for an intentional retry or ordinary dismissal.
- Creation captures submitted values and the original project context. Forced
  unmount or a project transition, including A→B→A, cannot trigger stale success
  navigation. Renaming the same project does not invalidate its identity. Missing
  project context fails closed and an explicit read retry preserves the draft.
- Shared creation code stays with the lazy planning routes, rather than loading
  through the board's shared Story picker. Existing bundle budgets are unchanged.

### Verification and limitations

- The three delayed-dismissal regressions were reproduced before the fix and are
  retained as local evidence. Happy DOM checks exercise actual planning forms,
  deferred success/failure, duplicate-submit guards, pending focus, dismissal,
  project changes and unmount. Native/browser interaction for this batch is not
  yet verified; see [verification notes](docs/verification/0.3.0-alpha.12.md).
- This is a UI transaction-state repair, not a cancellation or idempotency protocol.
  A submitted write may already be committed; closing the application cannot undo
  it. There is no timer that turns a still-pending write into a retryable failure.
  Database schema 7 and existing MCP/native request contracts are unchanged.

## [0.3.0-alpha.11] - 2026-10-21

### Fixed

- Paginated MCP task reads filter candidates before full context hydration and load
  only the returned page. Foreign-ancestor checks, Unicode matching, field values,
  ordering, offset behavior and same-call transaction consistency are preserved.
- Table Ready filtering now matches authoritative Rust Unicode-whitespace rules.
  Tab/newline, nonbreaking-space and em-space-only required fields no longer appear
  ready in the table when the task and MCP correctly report them unready. Accepted
  NUL-containing text also retains Rust emptiness semantics rather than SQLite
  character-length behavior. This is filter parity, not new validation or permission.
- A loading or failed table read no longer claims zero tasks. Counts distinguish
  reading, unavailable and a genuine empty result; single-task counts are singular.
- Planning handoffs capture the exact project ID and scope when opened. Later
  selection/rename cannot rewrite an inspected prompt; overlapping copies are
  refused and old completions cannot announce success in a reopened preview.
- MCP prompts use live schemas and optional playbook guidance rather than a stale
  mandatory version. Existing epics are inspected/refined before creating new work;
  missing project identity requires clarification, not guessed board access.
- Review reading shortcuts explicitly scroll their focused target into view without
  animation. Report/criteria disclosures share the paper-style monochrome chevron
  instead of native emoji-like markers; comments and test choices are preserved.

### Added

- Disposable three-project real-Store and four-client HTTP/stdio volume harnesses,
  an exact same-database before/after probe, and 2,000-row frontend virtualization,
  filtered-count, project-cancellation and honest-presence regression coverage.
- Separate browser performance workloads for idle, fifty unscoped actors, fifty
  task-scoped actors and an explicitly extreme 2,000-actor stress case. Existing
  frame/row/bundle budgets are unchanged; discovery is not a browser timing pass.
- A fictional general-project walkthrough from rough capture through brain
  clarification, human edits, explicit scope Start and evidence-based review, plus
  documented performance methodology and measured limits.

### Verification and compatibility

- Exact same-fixture comparison preserves all 171 serialized result cases and all
  checked persistent table data. Observed 2,000-task page-of-50 median changed from
  1303.73 to 38.44 ms in the same debug environment; see performance notes for p95,
  hardware, profile and limits. Board-wide hydration is not claimed improved.
- No database migration, tool count, mutation schema, role or execution-grant change.
- Alpha10 native light-mode acceptance independently confirmed full report reading,
  conflict draft preservation, setup guidance and manual tabs. Its partial comments
  jump is the observed defect fixed here; new geometry still needs native acceptance.
- Full current-version checks and exact platform/publication boundaries are recorded
  in the versioned verification notes. No real project execution or agent launch.

## [0.3.0-alpha.10] - 2026-10-21

### Fixed

- Configuration copying is single-flight through both controls and its handler.
  Pending token/clipboard work visibly locks copy and transport selection. Later
  accepted copies cannot be overwritten by an earlier overlapping HTTP operation.
- Project changes (including a rapid return to the original project) and unmount
  invalidate delayed clipboard intent before a token is written or success is
  announced. A cancelled read never pretends to have copied the new project.
- True tabs now have named tablists, unique tab/panel relationships, one roving
  keyboard entry point and manual activation: arrows/Home/End explore; Enter/Space
  selects. Vertical arrows retain scrolling. Notes and asset-source draft fields
  survive explicit tab switches; ordinary segmented filters remain radios.
- Request changes shows captured evidence at full natural height inside the modal's
  single vertical scroll surface, not a clipped 180px inner viewport. Go to comments
  and Back to captured report move focus without discarding draft/test selections.
- Help disclosures use monochrome CSS ink chevrons instead of platform-dependent
  emoji-style markers, retaining native details/summary keyboard behavior. Epic
  hierarchy and progress labels use singular “task” when the count is one.

### Verification and compatibility

- The alpha9 overlapping-copy defect was independently reproduced before this fix.
  Source and DOM tests distinguish refused overlapping actions from later accepted
  copies, and verify project/unmount cancellation with fictional tokens only.
- No database, MCP mutation-schema, permission, execution or worker-process change.
- Native alpha7 completed the fictional non-game planning/edit/Ready/Start/report/
  review journey. Current native readability and keyboard checks remain a separate
  acceptance step; see versioned verification notes for precise evidence/limits.

## [0.3.0-alpha.9] - 2026-10-21

### Changed

- Agent setup names the selected project and separates MCP connection, read-only
  verification, per-Epic Brain appointment and optional workflow-skill installation.
  It explains that changing boards cannot redirect an existing agent session.
- Connection checks verify the exact intended project ID and key prefix before
  reading the board. Configuration display and copy use the same captured project
  ID; delayed token access cannot silently copy a newly selected board. Feedback
  names the captured target, and stdio copy does not reveal an unused HTTP token.
- Reconnection and upgrade guidance covers duplicate client entries, refreshed tool
  schemas and rereading/reconciling current task evidence rather than stale replay.
- Optional playbook acquisition now has user-triggered source instructions and a
  copyable clone command. Nothing is downloaded, installed or configured by reading
  the guide. Installation verification is not advertised as protocol compatibility.
- Known legacy playbook examples are documented honestly: the current live MCP
  schema and in-app prompts take precedence for project binding, execution grants
  and captured task/review context. The separate playbook repository is unchanged.
- Agent-facing initialization and the product introduction say “project”, not
  “game jam” only; existing game-jam templates and branding are preserved.

### Verification and compatibility

- No database migration, role, execution-gate or mutation-schema change.
- Exact alpha8 independently passed 26 interaction probes and six source-contrast
  checks. Alpha7 native screenshot-only acceptance confirmed stale keyboard drag
  and Ready decisions refuse safely, with preserved drafts and no automatic work.
- Current-version checks and remaining native/browser limitations are recorded in
  the versioned verification notes. No automatic client setup or process launch.

## [0.3.0-alpha.8] - 2026-10-21

### Fixed

- Human task-edit conflict comparisons now freeze the exact base, local draft and
  saved version being inspected. New background edits block resolution until an
  intentional reread; the client never silently rebases or replays an old decision.
- Conflict save failures remain inside the active modal with the draft intact.
  Pending decisions cannot be double-submitted or dismissed; hidden editor
  shortcuts cannot bypass the open comparison. Failed initial comparison reads
  have a read-only retry instead of discarding edits or repeating a stale write.
- Readable field names and structured change/test entries replace raw property
  names and JSON. Responsive three-version panels distinguish the starting value,
  inspected saved value and local edit without a cramped four-column grid.
- Explicit “Save my edits against latest” and “Discard my edits and use latest”
  labels state the consequences. Whole Changes/test lists are honestly described
  as replacement, not entry-by-entry merging; unrelated unedited fields survive.
- Rereading restores focus to the comparison, and save/discard leaves a stable
  receipt. Closing keeps local edits without a mutation.

### Verification and compatibility

- Existing atomic task-update CAS and field/brief-property merge semantics are
  unchanged. No schema, MCP contract, role, execution grant or process change.
- Exact alpha7 passed independent native-intent safety and interaction audits;
  source and synthetic pointer/keyboard probes are distinct from native geometry.
- Browser assertions use the clearer actions and now exercise a second background
  change during comparison; they are not claimed executed until supported CI or
  browser acceptance runs. See versioned verification notes for current evidence.

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
