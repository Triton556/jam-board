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
