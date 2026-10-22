# Changelog

All notable changes to Jam Board are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0-alpha.31] — 2026-10-22

### Understandable coordination and revealed surfaces

- Project notifications reconstruct actionable agent updates from existing scoped
  history. Explicit bounded pagination, newer-update reveal and read markers are
  separate from transient toasts, approvals and full activity history. View checks
  the captured project/entity and keeps read/navigation failures recoverable.
- Refine offers explicit First / new chat and Continue in this chat modes, a local
  scoped request draft and exact captured target IDs. Copy does not connect, save,
  launch or execute. Guidance asks for a concise user-language description only
  where human text is empty, preserving existing wishes and technical contracts.
  Canonical MCP planning guidance uses the same distinction and asks which language
  to use if the original notes/latest human request do not make it clear.
- Board cards distinguish human assignment, unconfirmed execution, unavailable
  holders and waiting review instead of inventing activity. A single visible-app
  presence reader refreshes heartbeat data with project/lifetime/newer-cache fences.
  Generic status is not a reviewer appointment or proof of execution.
- Custom-select menus choose visible space above/below the trigger within viewport
  and scroll clips, with keyboard semantics retained. Agent plan uses monochrome
  disclosure ink and truthful archived help; singular counts are corrected.
- Agent-facing maps now include these paths and evidence limits; CI checks duplicate
  stable action/acceptance definitions as documentation integrity, not UX proof.

No database migration, new MCP tool, identity/permission change, automatic model
launch or raw session streaming. [Verification](docs/verification/0.3.0-alpha.31.md).

## [0.3.0-alpha.30] — 2026-10-22

### References canvas editing and image resolution

- Add → Note now opens a local paper on the canvas, with title/body editing and
  explicit Save. It creates no blank record; pending, dirty exit and unconfirmed
  results retain text and never automatically replay creation.
- Frame-only canvases no longer show the empty illustration. Frames have an
  explicit full-width grip/header and clearer resize controls; their interiors
  remain available to canvas/child gestures. Reference dialogs share field spacing.
- Inline draft entry uses measured available canvas space and readable zoom;
  confirmation focus, overlay stacking and router exit guards are covered.
- Readable images use a thumbnail only when its pixel dimensions cover the actual
  painted size, canvas zoom and device pixel ratio; otherwise use the original.
  Failed thumbnails retain the original, and failed images offer read-only retry.
  This does not establish that text/canvas compositing blur is fixed.

No database, MCP or permission changes. Browser/native geometry and gesture
acceptance remain separate from source/DOM checks; see
[verification](docs/verification/0.3.0-alpha.30.md).

## [0.3.0-alpha.29] — 2026-10-22

### Human-first task and story editing

- Task Description and actual Comments now come before the structured agent plan.
  Existing descriptions, comments and brief fields are preserved; an empty
  description may show the existing goal as a clearly labelled read-only context,
  never as silently copied or generated text.
- Story Description uses its existing outcome field. Remaining context and
  acceptance criteria live in an explicit Agent plan disclosure. Both task and
  story technical editors remain mounted while collapsed, retaining drafts and
  the existing readiness/review rules.
- Technical task autosave is isolated from unsaved human Description/status edits;
  explicit task Save still submits its intended dirty fields. Story technical
  pending/errors stay visible while the plan is collapsed, with read-only latest
  Story recovery and retained drafts rather than automatic replay.
- Comment drafts and Story description drafts stay attached to their entity in
  this app session. Comment posting captures its original target and body,
  prevents duplicate pending sends, and keeps an unconfirmed result for manual
  inspection rather than automatically retrying.
- Added an agent-facing interaction/state map, acceptance matrix and remaining
  gaps under `docs/agents/`. Story-level comments, notification history, canvas
  ergonomics, shorter refinement prompts and session streaming are not implied
  by this first increment.

No database migration, MCP schema, execution permission or task readiness
policy changed. [Verification](docs/verification/0.3.0-alpha.29.md).

## [0.3.0-alpha.28] - 2026-10-22

### Fixed

- Closing a Board task drawer after a status save now returns focus to that task's
  replacement card. If the card is filtered, archived, or its list is still
  reconciling, focus returns to the stable Board entry instead. Expired project
  selections, unmounted views and older dialog layers cannot pull focus back.
  Nested dialogs retain their parent-control priority; there is no delayed retry.
- Restored the intended keyboard-active option background in custom selects by
  correcting CSS specificity. Active focus and the selected value remain distinct;
  keyboard movement alone does not change the task status.

### Verification

- Corrected the preview-deadline test fixture after a Windows CI timing failure.
  It now measures the accepted connection through observed client EOF, keeps the
  same 4.8–5.4-second bounds, and reports transfer/whole-call diagnostics. The
  silent peer no longer closes on a competing schedule; watchdog errors fail.
  Production `curl --max-time 5`, application version and dependencies are unchanged.
- Added real-App save/close and delayed-list-read regressions, selection/ABA,
  missing-card, route-unmount and layered-dialog checks. Added light/dark Chromium
  computed-color scenarios, not just class-name assertions.
- Corrected the two remaining alpha27 browser contracts: the configuration receipt
  is a Settings-local status, and the Epic Stories view must be explicitly selected
  after navigating to a URL without that tab. Clipboard contents, captured project,
  persisted state and the full report/question workflow assertions remain intact.
- Alpha27's actual Linux result was 58/60, and its native check was a partial pass
  with the two focus/feedback defects above. Those results are not relabeled green.
  Exact alpha28 gates and remaining platform limits are in its verification notes.

## [0.3.0-alpha.27] - 2026-10-22

### Changed

- Removed keyboard dragging of Board task cards, as requested. Space and Enter
  open cards normally; the existing Status control remains keyboard-operable.
  Pointer dragging, task-status validation and MCP movement are retained.
  Keyboard navigation, board scrolling and brief-list reordering are unchanged;
  the Status control is not a replacement for within-column ordering.
- Removed obsolete keyboard-pickup instructions and drag-only ARIA from Board
  card buttons. Pointer gestures still capture the original task revision.

### Verification

- Added a strict all-E2E TypeScript config and CI gate. Two existing fixture files
  now explicitly provide nullable API fields and reject missing layout elements;
  no assertion, dependency or compiler strictness was weakened.
- Migrated browser contracts to current contextual empty states, polite notice
  summaries, project-specific clipboard receipts, readable Markdown content and
  hierarchy counts. Exact saved content, captured validators, real clipboard
  contents, highlighting and reduced-motion assertions are retained.
- Replaced former keyboard-drag coverage with keyboard activation/status editing
  and pointer-based stale-intent/refusal/recovery checks. No scenario was skipped
  and no browser timeout increased. Full external browser results remain a
  separate checkpoint in the version verification notes.

## [0.3.0-alpha.26] - 2026-10-22

### Fixed

- Board move callbacks belong to the captured project selection generation and
  mounted view. A late result cannot restore an old project's snapshot into the
  current board, revive after A→B→A, refill removed cache, or open a stale Ready
  dialog. Inputs are captured before deferred dispatch; mutations are never replayed.
- Moves keep last-read/event positions while saving instead of writing speculative
  whole-board positions. Completion reconciles by read only; simultaneous moves
  cannot roll back one another's data. Pending feedback explains this deliberate
  tradeoff without changing drag gestures, readiness or execution checks.
- Generic native errors are described as unconfirmed results, not proof of failed
  persistence. A bounded persistent notice explains read recovery; failed reads
  retain observed data and the existing Try again action retries only that read.

- The installed-smoke **test fixture** now canonicalizes its newly owned temporary
  root before building a receipt, covering aliased Windows TEMP paths. Production
  anti-redirection checks are unchanged; an ancestor-junction regression still
  requires redirected input to be refused. No app/runtime version change.

### Verification

- [Verification and limits](docs/verification/0.3.0-alpha.26.md). Earlier native
  evidence belongs to its exact package; no native failure injection is implied.

## [0.3.0-alpha.25] - 2026-10-22

### Fixed

- Board quick-capture guidance now distinguishes an unfiltered draft in Unplanned
  work from an Epic-filtered draft with a chosen Story. It no longer promises
  later Story reassignment: this candidate has no exposed task-reparent action.
  Existing task creation, readiness and execution policies are unchanged.
- The first-project walkthrough shows both direct Story → + Task and filtered
  Board capture, and names the top-bar Switch project control correctly. README
  includes the visible Plan → Epic → Brain appointment route beside chat.

### Verification

- [Verification and limits](docs/verification/0.3.0-alpha.25.md). This is a
  copy/docs/test correction; alpha24's separate native observations remain
  attributed to that exact package, not automatically to this version.

## [0.3.0-alpha.24] - 2026-10-22

### Fixed

- References image paste captures its project and page lifetime before decoding.
  Leaving the page or switching projects, including switching back, stops an
  undispatched image after decode, encode or byte preparation. Decoded bitmap
  resources are closed before asynchronous encoding. No old image is replayed.
- An already dispatched clipboard request is not cancelled or assumed rolled back.
  Captured-project receipts distinguish confirmed, unconfirmed and not-attempted
  outcomes; late completions do not select items or refresh a different/new view.
  Explicit Refresh references remains the read-only recovery path. Ordinary
  confirmed receipts stay transient; problems use the existing bounded notices.

## [0.3.0-alpha.23] - 2026-10-21

### Fixed

- Cached selected-Epic and Story detail read failures retain the exact Markdown
  editor, local draft and focus instead of replacing them with an error screen.
  The last-loaded-view warning offers a read retry; first loads with no data still
  show a distinct error/retry state.
- Background recovery and late reads from a former entity do not replace the
  current editor or trigger a save. Ordinary user blur still invokes the existing
  Markdown autosave contract; it was not silently disabled or relabelled read-only.
  The tested data-first TaskDrawer path remains unchanged.

## [0.3.0-alpha.22] - 2026-10-21

### Fixed

- Assets and References offer explicit read-only Refresh for late-settled file
  requests after returning to their origin. Captured-project receipts explain this
  recovery; the old batch stays fenced and no write is replayed automatically.
- References cached background read errors no longer unmount the canvas and erase
  an unsaved note dialog. Repeated failures and eventual read recovery retain the
  same fields, text and focus; errors with no cached data stay distinct.
- Board task/member list failures retain quick-capture drafts, and Plan epic-list
  failures retain the new-epic dialog. Cached data is labelled as the last loaded
  view, with a read-only retry; initial failures still block unavailable content.
  The already-safe Table inline draft behavior is unchanged.

### Changed

- Read refreshes have explicit processing feedback. References read notices are
  bounded within the canvas; filtering remains intact when refreshing Assets.
  No backend schema, execution permission, mutation retry or persistent queue changed.

## [0.3.0-alpha.21] - 2026-10-21

### Fixed

- Command-palette MCP setup opens the existing pinned Settings → Agents flow
  instead of copying an unpinned duplicate configuration with invalid apostrophe
  escaping. MCP/config/Codex/Claude searches remain discoverable; missing runtime
  data no longer makes this action silently close without a destination.
- Both Codex HTTP snippet builders explicitly send `X-Jam-Agent: Codex` with the
  optional project header, matching the existing stdio identity default.
- Enabled Table filters and archived/openable rows keep readable text instead of
  whole-control opacity. Selection rings, pressed state and archived stamps remain.

### Changed

- Setup explains distinct stable brain/worker names, shared identity in inherited
  connections, reconnecting after configuration changes, and the consequences for
  status, event filtering and independent review. This is guidance for existing
  behavior, not a new launcher, identity editor or authentication mechanism.
- Claude command hints explicitly identify their existing PowerShell quoting.
  The existing Ready/butter alias is centralized without changing its color.

## [0.3.0-alpha.20] - 2026-10-21

### Fixed

- Assets and References file batches capture their originating project and page
  lifetime. Leaving or switching projects stops files not yet dispatched, including
  an A → B → A return; it does not cancel an already-dispatched command.
- Partial batches distinguish confirmed writes, unconfirmed requests and files
  not attempted. A transport error can occur after persistence, so receipts do not
  promise rollback or automatically retry. Only the still-current origin's lists
  are refreshed/marked stale, including when a normal change event is absent.
- Assets shows reading/error/retry states instead of false empty results. Cached
  results remain available after a refresh error, and no-match filters have an
  explicit reset. All-kind grids omit empty groups while preserving kind filters
  and collapsed-group preferences.

### Changed

- File batches show scoped processing feedback and captured-project receipts.
  Problematic receipts are dismissible and retained within the existing latest-three
  in-memory notice bound; expandable file details do not become live announcements.
  Fully confirmed successes remain transient. There is no persistent import queue,
  automatic replay or delivery guarantee after the app exits.
- The restricted alpha19 Linux native pass independently closed the targeted Table
  header/partial-row and Story permission-layout findings at 1180px; this is not
  alpha20 native import acceptance. See this version's verification for limits.

## [0.3.0-alpha.19] - 2026-10-21

### Fixed

- Table keyboard entry prefers a fully readable row below the sticky headers,
  rather than a one-pixel sliver at either edge. A viewport too short for a full
  row uses the greatest visible overlap; remembered row identity is retained
  when readable, without taking focus from filters or changing virtualization.
- Story permission summary and actions use separate full-width rows in the narrow
  drawer, including when the outer desktop window is wide. Permission consequences
  and counts remain present; no execution policy changed.

### Changed

- The table's 84px sticky-header allowance now uses body-row scroll margins rather
  than a scroll-container inset that also excludes the sticky sort controls.
  This is a source-backed candidate for the observed native header-focus jump;
  native geometry still needs independent verification, not a claimed closure.

See [verification notes](docs/verification/0.3.0-alpha.19.md) for synthetic viewport
coverage, preserved native observations and exact-version checks.

## [0.3.0-alpha.18] - 2026-10-21

### Fixed

- Lazy page modules now have local visible loading and error states. A slow or
  failed Table/Settings/other feature import no longer hides the surrounding
  navigation; Projects also offers an explicit route back to Board.
- Task and Story module loading/failure has a normal focused, closable drawer.
  Escape/Close removes the pending intent, and a late resolution or rejection
  cannot reopen it. Loaded editor drafts and the existing data-query retries are
  unchanged. Story's eager Plan dependency is retained, not silently rearchitected.
- Recovery offers a user-initiated **Reload app** with an unsaved-draft warning,
  not an automatic reload or a Retry that reuses a cached lazy rejection. Named
  recovery components retain control identity/focus across clock updates.

### Verification

- [Exact checks and limits](docs/verification/0.3.0-alpha.18.md). Real-App controlled
  import probes cover pending, rejected, superseded and warm states; no actual
  network-delay, native timing, screen-reader or production reload claim is made.
  No backend, schema, dependency or execution-permission change.

## [0.3.0-alpha.17] - 2026-10-21

### Fixed

- Plan's Participation and Separate reviewer labels now target only their triggers,
  not the entire custom option subtree. Each choice keeps its own accessible name;
  the existing layout, values, pointer/keyboard selection and Escape behavior remain.
  This is a narrowly reproduced label association repair, not a custom-select rewrite.

### Documentation

- README clearly separates optional legacy playbook guidance from required MCP
  connection, flags strict output-schema upgrades, and distinguishes historical
  media/public downloads from the unreleased development candidate.
- The walkthrough uses the exact **New work paused** label. An empty MCP project
  scope means the session's pinned project, never whichever board the UI displays.

### Verification

- [Exact checks and limits](docs/verification/0.3.0-alpha.17.md). No backend, schema,
  dependency, permission or migration change. Native checks on the preceding
  alpha16 candidate retain that version attribution.

## [0.3.0-alpha.16] - 2026-10-21

### Fixed

- Markdown fields now render ordinary prose, headings, lists and links beside an
  explicit **Edit** action, not inside that action's button. Reading a reference no
  longer also opens the editor. Disabled editing does not disable reading; empty
  disabled fields say **Not provided**. Escape and Ctrl/Meta+S return to Edit when
  available; ordinary blur preserves the user's next focus target and existing save
  behavior. No HTML rendering, opener policy or backend save semantics changed.
- Asset Kind labels no longer wrap the custom select's entire option subtree.
  Options retain their own accessible names instead of all being named “Kind”.

### Improved

- Assets/onboarding copy now describes general projects. New unspecified assets
  default to `other`; `.json` alone no longer implies a game level. Existing
  classified assets and explicit kind choices are preserved; known `.tmx`/`.ldtk`
  suggestions and the current kind enum are unchanged.
- A whole-project brain handoff explicitly pages the non-archived task inventory,
  including unassigned Backlog captures, before targeted evidence reads. It no
  longer leaves that inventory implicit in `get_board`, which is only a summary.
  Epic/Story/Task handoffs remain scoped. This is guidance, not a claim of model
  compliance or permission to execute.

### Verification

- [Exact checks and limits](docs/verification/0.3.0-alpha.16.md). No schema, tool,
  dependency, grant or migration change; source-backed rationale is recorded in
  [the workflow design notes](docs/workflow-ux.md#18-separate-reading-from-editing-and-keep-project-language-general).

## [0.3.0-alpha.15] - 2026-10-21

### Added

- `get_session_context` now returns `latestActivityCursor`, the latest committed
  activity sequence belonging to the pinned project (zero for no history). Identity
  and high-water are read in the same snapshot; switching the human's selected
  project cannot redirect the session. This is a bootstrap aid, not an execution
  grant, per-project sequence counter or database-generation identity.

### Improved

- Plan/work/review prompts and board/epic resources now share bounded observation
  guidance: retain saved project/scope/filter checkpoints, use inclusive
  `wait_for_changes` pages, handle a page before saving its cursor, and use fresh
  pre-baseline capture only when there is no unprocessed recovery checkpoint.
  Continued observation requires an assigned role/request and ends at its stopping
  condition; recovery does not create an extra monitoring assignment.
- Removed default unbounded recovery and duplicate task/resource reads while
  preserving complete decision evidence and captured claim/review validators.
  Deliberate historical audit and the legacy API remain available unchanged.

### Fixed

- Kept Welcome's chunk-error screen component stable across empty-project shell
  clock updates. Reload/Projects controls now retain their DOM identity and keyboard
  focus instead of being replaced each second. This closes the independent alpha14
  review regression; there is still no automatic reload or fake chunk retry.

### Compatibility and verification

- This adds a required output property on the new server's schema, not a new tool
  or database migration. Tolerant older consumers may ignore it; strict/cached
  output schemas need coordinated updates. Missing on an older server is not zero.
- A saved scan cursor may exceed project high-water after foreign/nonmatching
  events. Never treat that comparison as database rewind or overwrite recovery
  progress. Pages cap event count, not bytes; continuous catch-up may not finish.
- [Exact verification, source provenance and limitations](docs/verification/0.3.0-alpha.15.md).
  Guidance is longer than alpha12; no measured token, model-quality or latency
  improvement is claimed, and no automated checkpoint client was introduced.

## [0.3.0-alpha.14] - 2026-10-21

### Fixed

- Asset and reference dialogs capture a single submitted operation and project,
  keep pending edits/dismissal locked with visible status, and retain known-failure
  drafts for an explicit retry. Late completion cannot close a remounted form or
  act on a changed project/target. This covers asset editing/linking, adding a note
  or link, reference captions/tags/links, and frame creation/editing. The existing
  reference picker also blocks duplicate links and preserves its search on failure.
- Asset-link source reads distinguish loading, failure, an empty list and no matches.
  Retry retains search/selection rather than presenting a failed read as no assets.
- Project name, start/end, timezone and milestone fields no longer remount after
  an older save and erase newer typing. Newer edits blurred during a pending save
  remain visibly **Unsaved**, with an explicit Save action after settlement; they
  are never silently queued/replayed. Failed background reads preserve the editor.
  Template-save confirmation also has pending/error/focus recovery.
- The on-demand Welcome screen now shows loading feedback even inside the router's
  own suspense boundary. A rejected chunk offers explicit **Reload app** or
  **Open Projects**, rather than an unusable retry of React.lazy's cached rejection.
  These close two independent alpha13 review findings while retaining the split.

### Compatibility and verification

- No database migration, MCP/native contract, dependency, authorization, task
  readiness or worker-launch change. These are UI intent fences, not transactional
  cancellation, server idempotency or new cross-client compare-and-swap protection.
- [Exact validation and limitations](docs/verification/0.3.0-alpha.14.md).
  The separate session-cursor proposal and later generic-asset/Markdown clarity
  work are deliberately not included in this correctness batch.

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
