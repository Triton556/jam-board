# Workflow and usability decisions

This document records product decisions, their rationale and checks. It is not a
claim of independent usability validation. The paper visual language and the
agent-colored ring, pencil and handwritten status remain part of the design.

## 1. A project is a separate board

**Scenario:** work on more than one application without mixing plans or sending
an existing agent to whichever board happens to be open.

The project name in the navigation rail is a labeled control. **Your projects**
provides creation, opening and restoration in one place. A current-project badge
and key prefix make the destination recognizable; connection binding uses the
exact immutable project ID, not matching display text. A connected MCP
session stays pinned to its project; switching the human view is not a command
to redirect or stop workers.

The rationale follows the principles of visible state, familiar language and
recognition rather than recall in [Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
Our inference is that a hidden setting or an unlabeled icon would be insufficient
for this high-consequence context switch.

Checks: unique keys; old project restored unchanged; task edits resolved before
leaving; in-flight saves remain scoped; selected-project lists refresh; archived
projects are recoverable; agents cannot read or mutate another project's IDs.

## 2. Reveal the hierarchy; do not invent another level

**Scenario:** a person sees epics and task cards but cannot find the feature-sized
planning layer.

The hierarchy stays **Epic → Story → Task**. A story is described as a feature or
outcome. The epic overview shows its story count as a direct action, with the task
count alongside it. Story cards and the drawer retain acceptance criteria and
implementation tasks. No separate Feature entity or migration is needed for
terminology alone.

Empty plans explain the next action and offer both manual creation and a brain
handoff. [NN/G's guidance on empty states](https://www.nngroup.com/articles/empty-state-interface-design/)
supports contextual explanation and a direct path to the useful next step. The
optional workflow guide remains collapsed rather than imposing a tutorial.

Checks: stories discoverable from the overview; empty/loading/error states
distinguished; keyboard navigation and dismissal; narrow-window wrapping.

## 3. Planning is not execution authorization

**Scenario:** drop rough notes or assets, ask the brain to clarify and decompose,
edit its proposal, then start work on an agreed story or epic.

The planning handoff includes the exact entity key and expected project. It asks
the brain to read sources, ask focused questions and reconcile human corrections.
The dialog explains that copying the message does not launch an agent. Connection
checking is read-only: it must not take a Ready task as a connectivity test.

The execution policy distinguishes brief readiness from permission
to start. A scope start authorizes the brain to organize workers within that
scope, not to expand the project. Pause stops new work; already-running work may
submit evidence. This is a domain rule, not merely reassuring UI copy.

[Microsoft's HAX guidelines](https://www.microsoft.com/en-us/haxtoolkit/library/)
recommend explicit capability boundaries, correction, disambiguation and clear
consequences of actions. Applying them here means making planning, approval and
execution distinct at the point of action. An agent-supplied `userApproved` flag
is not evidence of a human decision.

Checks: copy errors leave a selectable prompt; Cancel/Escape do not mutate data;
Ready alone cannot authorize a worker; every work-entry API enforces the same
scope policy; pause does not destroy reports; project switching preserves scope.

## 4. State labels must describe the real process

The five columns remain Backlog, Ready, In progress, Review and Done. Review is
not yet accepted work. Planning status and execution permission are separate.
An online agent is not proof that it is actively editing every assigned task.
The animation should communicate the evidence available, not invented progress.

The [Kanban Guide, May 2025](https://kanbanguides.org/the-kanban-guide/2025.5/)
calls for an explicit workflow, started/finished points and control of work in
progress. It does not prescribe this application's hierarchy, visual style,
column names or numeric limits. We therefore use it to clarify policies rather
than to import enterprise process. A limit on the In progress column should be
named specifically and not disappear when an epic filter hides some work.

## 5. Decisions need a visible outcome and usable recovery

**Scenario:** approve a start request or answer a planning question, then its card
leaves the Open list. Keep a short live receipt and move keyboard focus to the
stable section heading rather than leaving it on the removed button. The receipt
states what was saved, not that an agent has actually launched. The same principle
applies to direct Start/Pause and report reviews. A failed review keeps its draft
and an error inside the active dialog; pending actions cannot be duplicated.

This applies [visibility of system status and error recovery](https://www.nngroup.com/articles/ten-usability-heuristics/)
and HAX's [clear action consequences](https://www.microsoft.com/en-us/haxtoolkit/guideline/convey-the-consequences-of-user-actions/)
to a concrete asynchronous workflow. These are design inferences, not claims that
an article independently tested this application.

Checks: success receipt survives card removal; focus stays in the relevant
section; modal errors remain inside its accessible boundary; input survives a
failed save; no duplicate pending submission; generic answers never authorize work.

## 6. Keep navigation legible at an ordinary desktop size

**Scenario:** at an 1180px window a person cannot identify the Plan icon or discover
Draft epics because a compact layout hides labels and its filter. The compact
main rail now retains text; the epic rail retains titles, planning state and its
filter. A smaller width reduces detail rather than removing the means to find
work. This applies recognition-over-recall, not a new navigation hierarchy.

Normal execution controls show permission, counts and the next action. Inherited
and partial grants remain explicit; repeated background explanation lives in a
“How starting works” disclosure. The exact-scope confirmation still shows all
consequences. [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
supports this layering; the concrete layout is our inference, verified separately.

Keyboard Enter retains the task-opening meaning advertised by its button; Space
is the distinct drag action. [WAI-ARIA dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
requires focus inside the dialog and return to an appropriate workflow target.
Native pointer focus already worked in the baseline; explicit activation focus
also covers programmatic/accessibility activation without relying on pointer focus.

**Honest activity:** a live agent heartbeat is not evidence of work on every task
assigned to it. Fresh unscoped/other-task presence remains visible but quiet;
matching task-scoped updates retain the colored paper ring, pencil and handwritten
status. This follows the same visible-state/capability-boundary rationale above.

## 7. Recover tracking without pretending to stop external work

**Scenario:** a worker has stopped responding, a claim was left behind, or an
imported In progress row has no holder. The person needs a visible route back to
planning without making up a report or restarting an archived scope.

Release claim names the captured project, task and holder, checks the task revision
atomically and explains that it only clears board tracking. It does not terminate
a process; scope permission is unchanged. Saved evidence stays available. This is
a concrete application of HAX correction/control and explicit consequences, not a
new worker-process controller. Stale confirmations fail with retained context;
unsaved edits must be saved or discarded first.

**Reports:** the newest round is expanded first, with review actions next to its
evidence. Previous rounds remain available through disclosures rather than
pushing the current decision down the page. This applies progressive disclosure
without hiding historical evidence. Modal focus follows WAI-ARIA's dialog pattern:
closed disclosure content and hidden controls cannot receive keyboard focus.

Checks: cancel makes no change; pending submission is locked; failure is inside
the dialog; success leaves a persistent receipt and logical focus; changed holder,
project or task cannot silently retarget release; archived evidence remains intact.

## 8. Make context readable, and keep decisions attached to what was read

**Scenario:** a report is open while another person changes Story acceptance, or a
new report round arrives. The existing report and criteria remain a captured
snapshot. A changed-evidence notice blocks acceptance until an explicit reread.
Request changes retains comments and test choices; removed tests require deliberate
reconciliation instead of quietly losing the concern. This applies HAX correction
and visible consequences together with conditional-write principles in
[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match). It is our UI
application of those principles, not a source-prescribed review ceremony.

**Recognizable context:** cards show Story titles rather than requiring memory of
keys. The Plan header visibly labels Brain, keeps the hierarchy action and moves
repeated instructions out of the normal path. Goal and Done when precede optional
References. Contextual column policies explain Draft, Ready and review; quick
capture is a draft, not a shortcut to permission or fabricated completed work.
When the board is filtered, an explicit matching Story keeps the new draft in view.
These changes follow the recognition/empty-state/progressive-disclosure sources
above and the observed native 1180px layout, not a new hierarchy or enterprise flow.

**Contrast:** [WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
uses a 4.5:1 minimum for ordinary-size text. Source-token checks use the
[specified sRGB luminance calculation](https://www.w3.org/WAI/WCAG22/Understanding/relative-luminance.html)
without rounding thresholds. Tertiary/error text and dark palette-tinted metadata
were adjusted; the paper palette and activity animation remain. This verifies
specific authored color pairs, not every rendered state, custom color or full WCAG
conformance. Native visual and keyboard acceptance remain separate checks.

## 9. Keep evidence and recovery inside the active decision

An independent interaction probe found that refreshed Request changes showed only
its report summary while actual output, commands, changed files and limitations
remained behind a modal. Closing to inspect that material discarded the draft.
A shared complete report renderer now keeps the evidence inside the decision;
rereading retains comments and test choices. Commands are visible, not hover-only.
This follows the modal focus boundary in the
[WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
and the correction/recognition guidance above. The wider dialog is an application
layout choice, not a recommendation to add confirmation steps to every decision.

Readiness uses the same local-error, retained-draft and pending-lock pattern as
review/release. A failed initial brief read has an explicit retry; an override is
not available before that read succeeds. Busy Close buttons visibly disable,
and success moves focus to stable context if the original action disappears.
Ready remains a planning condition, never a new execution grant.

## 10. Keep human status changes attached to their original intent

A concrete race showed that an old drag or readiness decision could change a new
claim's status, including a same-agent release/reclaim. The native writer now
requires the task revision captured at drag start or decision opening. This applies
[RFC 9110's conditional-write rationale](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match)
to local SQLite commands; it is not an HTTP protocol implementation or a new role.
The atomic check runs before status, ordering, rounds, comments or journal writes.

The UI never refills the validator after a background update. A stale drop restores
authoritative board state. Readiness retains the human's reason, names the changed
state, and offers an intentional reread with the full saved brief. Unsaved fields
must be saved before an override of the saved brief is considered. This follows
the correction/error-recovery guidance above, without adding a generic confirmation
to every ordinary move. Ready still does not grant execution, and moving a card does
not terminate a worker process. Task revisions fence task intent only; they do not
claim to capture every concurrent ancestor planning edit.

## 11. Reconcile human drafts without guessing what “mine” means

A reproduced task-edit conflict showed live server values replacing an open
comparison, while failed saves put the error outside the modal. The comparison now
freezes the starting task, local fields and inspected saved task. A changed version
requires explicit rereading; closing, failed reads and failed writes retain the
draft. This applies the same conditional-write and HAX correction principles as
report review, not a new merge engine or extra approval gate.

Human-readable field names and structured list entries replace JSON dumps. Each
field shows three labelled versions, stacked at narrow widths. Action labels say
whether local edits are saved or discarded. Unchanged top-level and brief fields
keep the inspected saved values; Changes and acceptance-test arrays are replaced
as whole lists, with that limitation visible before saving. The design follows
[Nielsen Norman Group's recognition-over-recall guidance](https://www.nngroup.com/articles/ten-usability-heuristics/)
and keeps pending/error/retry controls within the
[WAI-ARIA modal boundary](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
No automatic rebase, fresh-token replay or external-worker control was added.

## Verification boundaries

Automated frontend tests use a deliberately isolated mock bridge. Rust tests
verify domain rules and real stdio/HTTP behavior. A private mock preview can
verify layout and interaction, but not filesystem operations, native dialogs,
SQLite persistence or real agent execution. Those require native/runtime checks.
No visual approval, unit-test pass or packaged binary substitutes for end-to-end
human/brain/worker acceptance.

## 12. Connection, project identity and optional guidance

A native newcomer walkthrough found that a local-clone chooser was a dead end for
someone without the playbook, and the setup sequence did not expose per-Epic Brain
appointment. The project picker also needs an explicit session mental model: a new
UI selection is not a change to an already connected agent.

The setup now names the target, checks its exact ID before board reads, explains
reconnection/duplicate-entry consequences, and separates mandatory MCP from optional
skill installation. Source acquisition is a disclosed, user-triggered action; copying
instructions is not treated as successful setup. Clipboard receipts name the captured
project. Since alpha10, a project change during the asynchronous token read cancels
the old copy instead of applying it to a later selection. The displayed and copied
configurations both prefer the immutable project ID.

This applies [NN/G recognition rather than recall](https://www.nngroup.com/articles/ten-usability-heuristics/)
and [Microsoft HAX capability/consequence guidance](https://www.microsoft.com/en-us/haxtoolkit/library/)
to the observed scenario; those sources are design rationale, not external product
validation. The [upstream compatibility audit](agent-playbook-compatibility.md) avoids
implying that optional older call examples are a current integration guarantee.

## 13. Readable evidence, correct tabs and ordered clipboard intent

Native alpha7 showed complete report evidence inside a roughly 180px nested scroll
area. Fields existed, but the clipped test row and transient scrollbar obscured
how much remained. Request changes now uses one vertical modal scroll surface and
focus shortcuts between the full captured report and retained comments. This is a
reading affordance, not a new acceptance step or a claim that evidence was reviewed.

The shared tab control previously exposed tab roles without keyboard behavior or
panel relationships. The [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
informs named/associated panels and roving focus. Manual activation avoids changing
a note editor, asset source or transport while arrows merely explore choices.
The [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
informs focus movement within structured evidence and back to its meaningful heading.
Ordinary filters remain radio groups; this is not a blanket conversion to tabs.

An independent alpha9 audit reproduced a slow HTTP token read overwriting a newer
stdio copy. A pending copy now visibly locks setup actions, with a synchronous
handler lock too. Project-cache changes and unmount invalidate its generation before
clipboard invocation and success receipt. This also handles A→B→A without waiting
for a React render. Once a clipboard write has already been invoked, the platform
has no cancellation primitive: the guard prevents stale invocation/receipt, not an
undo of a previously accepted write. No token is logged or added to product data.

## 14. Keep large-board feedback truthful and planning handoffs stable

A multi-project fixture checks 2,000, 1,000 and 40 tasks without starting work. The
table keeps a bounded virtual row window, exact filtered counts and selected-project
results when an older request finishes late. Pending reads say “Reading tasks”,
not zero tasks; failed reads say the count is unavailable rather than implying an
empty board. [TanStack Virtual's visible-window model](https://tanstack.com/virtual/latest/docs/api/virtualizer)
and [TanStack Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
inform these implementation checks. DOM tests do not establish native frame rate;
the [performance methodology](performance.md) separates those kinds of evidence.

Activity fixtures also distinguish fifty unscoped online agents, fifty genuinely
task-scoped actors and an explicitly extreme 2,000-actor stress workload. Assigning
one online actor to many cards must not manufacture task activity. No readiness,
authorization or honest-status rule is weakened to produce better measurements.

Planning prompts capture the project ID and scope when opened. Changing the
selection or receiving a rename does not silently rewrite an already inspected
message. The captured label remains readable context, not identity or permission;
close and reopen to prepare another target. Current MCP prompts likewise treat the
playbook as optional guidance, with live schemas taking precedence over old examples.
This applies the same visible-state and HAX consequence principles used for setup.

Native alpha10 showed that focus alone could leave most of the review Comments
field below the modal viewport. The reading shortcuts now explicitly scroll their
focused target into view without animation. This follows the structured-content
focus rationale in the [WAI modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
and uses the [scrollIntoView API](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView).
The retained review draft and exact captured evidence are unchanged; actual visible
field geometry remains a native acceptance check, not a DOM-test claim.


## 15. A pending creation is not cancelled by hiding its dialog

A delayed Epic/Story/Task create previously allowed Cancel or Escape to hide the
form, then opened the new entity when the write completed. All three paths were
reproduced with ordinary controls. A shared creation form now captures submitted
values, refuses duplicate sends, keeps edits/dismissal locked while pending and
shows a focused, polite processing status. Known rejection restores the retained
draft and ordinary dismissal; explicit retry is a new user action, never automatic.
Unmount or any project transition invalidates late navigation, not the write itself.

[NN/G's system-status guidance](https://www.nngroup.com/articles/visibility-system-status/)
supports immediate, truthful processing feedback. The [WAI modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
normally expects Escape dismissal. Our temporary pending lock is a deliberate
transaction-safety exception, not a blanket accessibility-conformance claim. Focus
moves to the processing message instead of a disabled input, then back to the title
on rejection; the ordinary dialog focus cycle resumes after the request settles.

No client timeout claims a pending write failed. If the app is forcibly closed or
a response is lost, an already submitted creation may remain in the plan. Reopen
and inspect before repeating an uncertain action. This batch adds no rollback,
server idempotency key, background process controller or permission grant.


## 16. Visible navigation and reliable table entry

A source-blind screenshot review found the project-name/chevron ambiguous and the
last board column clipped without an obvious horizontal cue. This is heuristic AI
review, not a human usability study. **Switch project**, directional overflow cues
and explicit **Planning status / Worker permission** labels reduce recall without
adding another hierarchy or compressing readable cards. The [NN/G recognition
heuristic](https://www.nngroup.com/articles/ten-usability-heuristics/) supports these
small affordances. The [MDN overflow accessibility guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow#accessibility)
recommends a focusable, named scroll region. Board keys apply only to that region,
not card drag controls; bounded controls follow resize and never imply hidden
columns when there is no overflow. Scrolling is deliberately nonanimated.

Independent table probes found no Tab entry after virtual scrolling or removal of
the focused row. The fix considers the actual viewport, not merely mounted
overscan. It preserves task identity during data reorder, chooses a visible fallback
when necessary, and never moves focus out of a filter/input. Between virtual-window
commits, only mounted rows' tab stops change; row-window and performance budgets
are unchanged. Keyboard destinations explicitly account for the sticky header.
Synthetic DOM geometry tests validate these choices, not native frame rate.

A separately reproduced inline-create race erased a newer draft after an older
write completed. The table now uses the same captured-intent/pending-feedback
principles as section 15, without pretending dismissal cancels a transaction.
Its status/error editor sits above the virtual table so feedback is not constrained
by a fixed-height row. Read failures expose Retry while retaining filters/drafts.

Normal-size success/recommendation and ending-countdown text use semantic ink
colors meeting the [WCAG contrast-minimum calculation](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
on their declared theme backgrounds; decorative colors remain unchanged. Automated
color arithmetic is not a rendered accessibility certification. Development mock
readiness also follows [Rust's Unicode White_Space definition](https://doc.rust-lang.org/std/primitive.char.html#method.is_whitespace)
rather than JavaScript trim, so previews cannot silently disagree on a brief's
completeness. This changes neither production validation nor permission to execute.

## 17. Preserve capture and settings drafts through slow saves

Independent tests reproduced old asset/reference saves closing newer dialogs,
frame/reference-link duplicate requests, failed asset reads masquerading as an
empty list, and project-field remounts erasing newer typing. Alpha14 applies the
captured-project, single-flight and visible-status policy from section 15 to these
individual dialog writes. A changed context invalidates late UI effects, not a
write already sent. Known failures retain input and an explicit retry; no timeout
turns an uncertain result into permission to submit again. Ordinary Escape resumes
once the operation settles. This remains a deliberate temporary exception to the
[WAI modal dismissal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

Settings are deliberately different: a user can type a newer value while an older
field save is pending. Only the submitted edit revision is acknowledged. If the
newer draft also blurs, it stays visibly **Unsaved** with a **Save …** action rather
than silently queueing an outdated request. This includes editing back to the old
baseline while a different submitted value is still pending. A background read
failure does not remove the draft's DOM. The policy improves local intent clarity;
it does not add backend optimistic concurrency to project/reference metadata.

The alpha13 Welcome split exposed two independent slow/failing-module cases.
Loading is now visible inside a local Suspense boundary. The [React lazy contract](https://react.dev/reference/react/lazy)
caches both the loader promise and its result, including rejection. Therefore the
error screen offers a real user-initiated app reload, or navigation to Projects,
not a retry button that merely remounts the same rejected lazy component. Reload
explicitly warns about unsaved fields; there is no automatic reload or form write.
Dialog tests and controlled module failures are not native layout/network acceptance.

## 18. Separate reading from editing and keep project language general

An independent actual-Markdown DOM audit showed that pointer/Enter on a reference
also activated the containing Edit button. Its headings/lists/links were inside a
button, contrary to the [HTML button content model](https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element).
The repair separates normal document content from a small, explicitly named Edit
control. It does not substitute a role=button wrapper or merely stop propagation.
The [WAI button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/) distinguishes
an action from link navigation; the UI now reflects that distinction. Disabled
editing leaves reading available and uses neutral empty-content wording. Keyboard
save/cancel returns to Edit where available; ordinary blur does not steal focus.
Normal save/cancel behavior had no reproduced duplicate-save defect and is retained.
Native text selection, accessibility-tree behavior and layout are separate checks.

General project capture must not imply that every asset is game art. The existing
`other` kind is the default for an unspecified new asset; explicit/persisted kinds
remain intact. [JSON is a general data interchange format](https://www.rfc-editor.org/info/rfc8259/),
so `.json` by itself is insufficient evidence of a game level. Known existing map
extension suggestions remain. This is a conservative classification/copy correction,
not a new type system, migration, content parser or change to stored assets.
The touched Kind form also separates its label from the custom option subtree,
after a DOM probe found every option exposed as “Kind” rather than its own label.

For project-wide rough capture review, `get_board` alone is insufficient: its task
collections cover in-progress/assigned work, not every unassigned Backlog card. The
prepared handoff therefore names paginated `list_tasks` inventory plus relevant
`get_task` evidence. Narrower scopes stay narrow; archives are not scanned by default.
This addresses a source-level instruction ambiguity in the requested workflow, not
an observed model failure or a new tool/permission. The first-project walkthrough
states the same boundary and does not promise that an external model will follow it.

## 19. Label the trigger, not every option

A follow-on real-PlanPage DOM probe found two remaining wrapped labels: all
Participation choices inherited the field title plus its help text, and every
Separate reviewer choice was named after the field. Their visible values differed.
The [HTML label model](https://html.spec.whatwg.org/multipage/forms.html#the-label-element)
associates a label with one control, not a collection of nested option buttons.
A sibling label now targets each existing trigger; the shared selector, values,
keyboard handling and layout spacing remain unchanged. Tests cover each option's
name, exact keyed update, focus after selection and Escape without a second write.
This is source/DOM evidence, not native accessibility certification.

Documentation uses the same worker-permission and pinned-project vocabulary as
the UI and protocol. Historical screenshots and optional skill installation are
not substitutes for exact-current-build or live-protocol verification.

## 20. Keep navigation and dismissal available while code loads

A native Table transition showed a transient blank frame, with no measured
stall duration. Independent controlled imports then reproduced a distinct DOM
failure: router-level suspension hid the whole shell for Table/Projects/Settings;
rejection replaced it with diagnostics only. Task loading had no visible drawer
or Escape dismissal, and rejection also replaced the whole app.

[React's Suspense guidance](https://react.dev/reference/react/Suspense) makes the
boundary's placement the unit of replacement. Local page boundaries now retain
surrounding navigation, show a named loading status and offer Back to Board.
[React lazy caches its loading result](https://react.dev/reference/react/lazy), so
resetting an error boundary is not advertised as a fresh import attempt. An explicit
Reload app action warns about unsaved drafts; nothing reloads automatically.
Recovery components have stable identity during the shell's clock updates.

Pending/error task and story modules use the existing modal drawer interaction:
focus inside, Tab containment, Escape/Close and return to a surviving opener, as
outlined by the [WAI dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
Dismissing a loading view is not cancellation of a submitted transaction. The
existing loaded editors and their save/draft rules remain in place. Late module
settlement does not restore a dismissed URL intent. Direct Story links are tested
separately because Plan eagerly imports its field metadata from StoryDrawer.
No dependency extraction or broader route rewrite is needed for this repair.

## 21. A file batch is an intent, not a transaction

An actual-App test with modeled native transport reproduced an Assets drop that
started in one project and sent its remaining files to a newly selected project.
References had the same sequential continuation issue. Listener cleanup alone did
not stop the in-flight loop. Each batch now captures its origin and page lifetime,
fences every new dispatch, and does not revive after an A → B → A return. This is
UI continuation fencing, not a new atomic importer or a backend permission change.

[Visibility of system status](https://www.nngroup.com/articles/visibility-system-status/)
supports showing both processing and the actual outcome. Native command handling
can reject while polling/emitting events after a store write. Consequently a generic
error means **unconfirmed**, not “not added.” Receipts distinguish confirmed,
unconfirmed and not-attempted files, name the captured project, and tell the user
to inspect it before re-dropping only what is still needed. No mutation retry button,
automatic replay, rollback promise or process-exit delivery guarantee is added.
Problematic receipts stay only among the latest three in-memory notices; details
are optional, bounded, selectable and excluded from the concise live announcement.

The same status principle separates loading/read failure from genuine empty data
and from filters with no matches. Omitting zero-item groups in the All view brings
real non-game assets forward without changing drop targets, import classification,
kind filters or saved collapse preferences. Unit/DOM tests do not establish native
screen-reader behavior or the rendered height of a large receipt.

## 22. One connection setup and readable enabled controls

The palette had a separate unpinned TOML builder whose apostrophe doubling was
invalid in literal TOML strings. It now navigates to the existing project-captured
Settings → Agents setup, with MCP/config/client search aliases. Both current Codex
HTTP builders explicitly name the agent, matching their stdio default; no client
configuration is installed. The visible identity explanation exposes an existing
server contract rather than adding a process manager: normalized shared names
resolve one member, inherited connections share that identity, and independent
tracking needs independently configured names/reconnection. This avoids requiring
users to recall hidden configuration behavior, consistent with
[NN/g recognition over recall](https://www.nngroup.com/articles/recognition-and-recall/).

Enabled table status filters and archived/openable rows no longer fade all their
text to 55% opacity. Selection retains its ring/pressed state; archived rows retain
the explicit stamp. The existing Ready→Todo→butter token alias is merely colocated
with status tokens, not a new color fix. Tests calculate resolved source-token
contrast in both themes and preserve semantic cues, following
[W3C normal-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
These calculations exclude grain/antialiasing and are not whole-app rendered WCAG
certification. Paper colors and decorative animation remain unchanged.

## 23. Recover a read without discarding local work

The independent late-settlement tests deliberately suppress native events: an old
request persists after the user has returned to a new origin view. Its write epoch
must remain invalid, so the old continuation cannot refresh or dispatch as though
it were the new page. Assets and References now offer an explicit **read-only
Refresh**, and captured-project receipts explain when to use it before inspecting
results or re-dropping only remaining files. This is neither mutation retry nor a
new event-delivery guarantee.

Cached read failures also used to replace the References canvas, Board columns and
Plan list subtree, destroying unsaved note/quick-capture/new-epic state. These views
now keep cached editable content mounted while showing a bounded read-error/retry
notice. Initial no-data failures remain distinct and retryable; stale cached data
is not presented as a fresh successful read. The existing Table behavior is a
negative control and is unchanged. This applies the same
[visibility and recovery principle](https://www.nngroup.com/articles/visibility-system-status/)
to reads: state what failed without silently removing the user's local draft.
No backend, execution permission, cache lifetime or draft-store architecture changes.


## 24. Preserve an editor through a failed detail read

The same independent audit reproduced unsaved Markdown loss in selected-Epic and
Story detail subtrees, but found TaskDrawer's data-first path safe. Only those two
proven branches now retain cached content and use the existing read warning. Initial
no-data errors stay distinct; late reads from a previous entity remain query-scoped.
Background error/recovery preserves the exact input and focus without a write.
Ordinary explicit user blur still saves Markdown, as before. We do not conflate
clicking away from an autosaving field with a write-free background refetch. This
continues the visibility/recovery rationale in section 23, without a new draft store,
backend revision mechanism or permission change.
