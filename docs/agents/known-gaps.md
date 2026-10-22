# Known gaps and next work

[Index](README.md). Source baseline alpha28 `2b263795b31767da29db0b62dc81f4da19dfc4d1`; source inspection 2026-10-22. Priorities describe impact, not permission to mutate live user data. All runtime/native acceptance remains unexecuted by this documentation audit.

## Status ledger

| Work | Status on 2026-10-22 | Completion evidence required |
|---|---|---|
| Human-first Task/Story | Corrected alpha29 DOM closure and bounded native read-only evidence; native text entry blocked | HF01–HF06 functional + open-state visual evidence; preserve reports, readiness and drafts |
| Reference frame grip/empty state | Alpha30 source/DOM; alpha32 source visual treatment; native pending | RF01, RF02 |
| Direct note paper | Alpha30–36 canvas form was explicitly rejected by the user; alpha38 replaces it with direct placement/writing | RF03 including reopen/no-heading, autosave ambiguity, retained drafts and actual rendered appearance |
| Notification bell/history | Alpha31 implemented from existing scoped activity; corrected paging/navigation races | NT01 including retention, identity, accessible View and stale destination |
| Hidden dialog spacing | Reference form rhythm corrected in30; select collision repair in31; broader visual inspection pending | VS01 and H-D11 nested flow |
| Zoom/DPI polish | Alpha30 image-resolution logic implemented; entire-board/text sharpness unverified | VS02/VS03 native checks |
| Short routine refinement / brain handover | Alpha31 candidate implements explicit setup/continuation; read-only handover remains recipe-only | AG02/AG11; [mode contract](refinement-modes.md), browser/native and real generated-summary evidence pending |
| Session message/tool streaming | Future, out of current implementation scope | Supported client transport, consent, scope identity, filtering/retention; never hidden reasoning |

## Concrete source findings


| ID | Priority / confidence | Concrete evidence | Targeted acceptance test |
|---|---|---|---|
| F01 | Alpha30 source/DOM correction; native pending | `features/references/ReferencesPage.tsx:1177`: `!data?.items.length` gates empty illustration; frames ignored. | Empty canvas → add only frame → illustration gone; archive last frame → illustration returns only if no active content; verify archived records/filter state separately. |
| F02 | Alpha30 grip correction; alpha32 source visual revision; native pending | `ReferencesPage.tsx:442` dragHandle `.reference-frame-tab`; `Nodes.tsx:281+` tab controls are nodrag; `references.css:342–405` frame/outline pointer-events none, tab auto, overview tab opacity 0. | Drag obvious title/grip at 100%, 75%, 40%, 39% zoom; border vs interior behavior understandable; collapse/edit/archive never start drag; interior still allows node selection/pan. Resize remains reachable. |
| F03 | Alpha30–36 canvas form rejected by user; corrected alpha39/40 hosted paper lifecycle and six PNG states pass, native input unrun | `references/DraftNote.tsx`, `StickyEditor.tsx`, `use-sticky-note.ts`; historical form is replaced, not visually accepted. | Place → direct body/optional heading → autosave → finish/reopen; no new blank records; retained newer typing/conflict/uncertain-create recovery; active editor survives overview/removal until explicit recovery/discard. |
| F04 | Alpha31 persisted agent-history implementation; native pending | `lib/ui-store.ts:10–20,112–173`: no durable history; last three toasts; five-second expiry; `lib/project-selection.ts` clears toasts. `app.tsx:734+` current View opens Inbox or Board task. | Bell → empty/recent/read states → View exact item; eligible persisted agent updates remain available independently of toast expiry; file receipts are not this history; new event while panel open; long list; current project vs old project explicit. Do not merely preserve old task-key URLs across project switches. |
| F05 | Alpha30 source spacing correction; revealed-state visual acceptance pending | `references/dialogs.tsx` plain forms; field wrappers nested inside form. `styles/v22.css:508` spacing applies only `.dialog > .field`; `styles/m5.css:57` `.m5-form` has grid gap 16px, absent here. `styles/app.css:1637` label gap separates label/input, not adjacent fields. | New frame, edit frame, add link, edit caption/tags/link: consistent heading→body→field→feedback→footer gaps, especially error and pending variants. Compare Asset/Member dialogs, not only screenshots of closed page. |
| F06 | Corrected alpha29 behavior; native hierarchy read-only observed | `task/TaskDrawer.tsx:675+` renders full BriefEditor then Notes, Rounds, assets, Comments. `task/BriefEditor.tsx:215+` exposes Goal/Context/Where/Changes/Tests/Boundaries/Result/User quotes. | Default task view exposes human description, comments, planning/regenerate entry; technical structure separately disclosed. Existing agent fields survive human edits exactly; readiness errors offer clear route into required detail. |
| F07 | Reproduced alpha31; alpha33 task-menu Escape repair | Task actions is local `menu` div in `TaskDrawer.tsx:430+`; `useModal` specially defers Escape only for open `.custom-select`. Reference native `<details>` menu also has no analogous integration. | Task → actions menu → Escape closes menu first rather than entire drawer; reference action details Escape/outside click contract explicit; focus returns to opener. Confirm baseline before repair. |
| F08 | Reproduced alpha31; alpha33 captured pending/recovery repair | Task archive dialog at `TaskDrawer.tsx:926+` lacks `busy` and archive action pending disable. MemberDialog `TeamPage.tsx:50+` lacks busy; submit checks valid but not pending (button alone disables). Edge label `ReferencesPage.tsx:1290+` raw async submit lacks pending lock and reports through global error toast. | Double click/Enter, close during pending, then late failure: one mutation, accurate outcome, errors inside active surface, no stale close of newer editor. Treat lost response as unconfirmed, not auto-retry. |
| F09 | Native29 clipping observed; alpha31 bounded placement repair pending native | `CustomSelect.tsx` renders absolute popup inline, not portal; `.dialog` overflow auto and viewport height cap (`app.css:1601+`); popup is top:100%, min-width 200px. | Open dropdown at bottom of tall modal, narrow window and 200% text: search and last option reachable without clipping/moving page unexpectedly; dropdown Escape followed by modal Escape; no horizontal overflow from long labels. |
| F10 | P2 native boundary unverified | `controls.tsx` DateTimeInput invokes native showPicker; useModal Escape special case knows CustomSelect only. Native datalist and file pickers add OS-level surfaces. | On exact Windows build, picker Escape cancels picker without discarding task; cancel file selection returns focus; native picker not claimed proven by DOM/browser mock. |
| F11 | Reproduced alpha31; alpha33 local loading/error recovery | `command/CommandCenter.tsx:44+` lazy palette uses Suspense fallback null, unlike route/task LazyBoundary paths. | Cold Ctrl+K, repeated hotkey, chunk rejection and Escape while loading: visible acknowledgment/recoverability; no late unexpected popup after dismissal. |


## Decisions before the next feature

- Bell decision: existing project activity is durable; read markers are session-only. Seven actionable agent event kinds, bounded pages and explicit newer reads are documented. No unscoped old task-key navigation or guaranteed toast-delivery history.
- Note decision (alpha38 candidate): Add selects placement; untouched blank paper is local, heading or body triggers autosave. No separate Save form. Existing cleared paper remains saved. Uncertain creation retains copyable text and permits read-only reconciliation, never automatic replay or a rollback claim.
- Frame interaction: visible grip/selection area should not steal child-node manipulation or interior canvas pan. Low zoom must not leave only invisible controls.
- Form spacing: adopt one reusable form rhythm, not isolated pixel patches; test field errors and nested dropdowns as well as default states.
- Human-first: technical plan is still editable and operationally authoritative; do not let hidden invalid fields silently disable Save without explanation.
- Refine: alpha31 candidate has explicit setup/continuation; never inferred from a prior copy click or online heartbeat. Board questions and client approval questions are different.
- Handover: role transfer is explicit and per epic; reading history alone does not take authority or reassign workers.

## Closing a gap

Keep its ID. Record exact changed version, linked acceptance IDs, test location, observed result and remaining platform limitations. Do not erase original failure attribution. Compilation, hashes, screenshots without interaction, or a mocked bridge alone cannot close a native usability gap.

## Zoom diagnostic handoff (source evidence, no runtime proof)

A separate read-only diagnostic found permanent `will-change: transform` on canvas layers (`references/references.css:13–22`), fixed max-512px WebP thumbnails used below zoom 1 (`references/Media.tsx`), and intentionally rasterized overview below 0.4 (`OverviewScene.tsx`). These are distinct possible causes: readable DOM blur, image resolution, and intentional overview approximation. Do not call all three one zoom bug. VS03 covers them separately. Alpha30 repairs image-resolution selection only; the compositing and overview hypotheses remain unproven visually. The isolated cloud Chromium attempt failed before page load; no screenshot/native acceptance came from it. Do not retry by changing security settings.

## Alpha29 validation handoff (2026-10-22)

Implementation owner reports **539 DOM tests passed**, including 30 new behavior probes. Four new functional-browser scenarios were added/typechecked but **not executed** at this checkpoint. This documentation author did not rerun those tests; the release verification record must supply final source/version and exact terminal evidence. DOM success does not establish native pixel geometry, Windows GUI behavior or browser visual acceptance. These results apply to human-first Task/Story work, not proposed frames/notes/bell/zoom/prompt features.

## Alpha30 source status

Frames/empty art/inline notes and image source resolution are implemented in the
alpha30 candidate. Their focused behavior evidence does not close native gesture,
small-window layout or entire-board/text zoom blur. Permanent compositing hints
remain unchanged pending actual visual/performance evidence.

## Alpha31 candidate limits

Notification history/presence/Refine are implemented candidates, not unconditionally
closed human usability findings. Review-entry timestamp and structured reviewer
activity remain absent. The heartbeat cache gap is source/repro-supported but not
a diagnosis of the user's minimize/restore incident. Table/detail presence wording
is unchanged. Native write sequences remain unrun after the alpha29 input-tool
capability error; DOM and hosted browser evidence must stay distinct. Status-menu
clipping and disclosure ink have a narrow source repair awaiting exact native31.
Raw session streaming and Story-level comments remain separate future/model work.

## Alpha32 visual/readability increment

The empty-column copy is reduced to “No tasks yet” or “No matching tasks”, with
14px medium/semibold text and concise column subtitles. Existing scope controls
retain the Ready/Start/claim explanation; no authority state or handler changes.
The frame treatment is a separate visual candidate, not evidence that alpha30
canvas geometry, gestures or whole-board blur already passed native acceptance.

## Alpha33 hidden-surface closure scope

F07 task-action Escape, F08 archive/member/edge pending lifetime, and F11 cold or
rejected command loading were reproduced with reachable user-event probes before
repair. Archive duplicate calls, underlying Ctrl+S save, late edge close and lost
recovery are not dismissed as style issues. Alpha33 adds guarded pending/recovery
using existing project ownership and deliberate Close/reopen inspection after an
uncertain write, not idempotency or cancellation. Confirmed follow-up read failure
is kept separate. Task Unarchive now has a confirmation surface. Owner actual-router
probes additionally found and corrected edge-opener focus lost through native
autoFocus timing. See [verification](../verification/0.3.0-alpha.33.md) for exact gates;
these DOM results do not establish native picker behavior or every other menu.

Alpha33 review also distinguished known pre-dispatch refusal from an unconfirmed
dispatched outcome. Each repaired dialog records whether its API call began;
read-only retained drafts and no automatic replay remain unchanged. The shared
project-write hook and backend contracts are not broadened.

## Alpha34 manual aid, not automatic wake

Saved answers can be deliberately handed back to an existing brain chat through
a copy-only prompt. Active MCP waits remain supported, but there is no adapter
that starts a new model turn in a finished conversation. CLI/API/embedded-chat
design is concept-only and not an implementation prerequisite or implicit grant.
The prompt cannot guarantee that a model follows the instructions; real-client
workflow observation is separate from DOM/clipboard checks.

- Alpha34 native presence observation: the visible Board activity label refreshes
  and expires correctly, but an already-open browser-native title popup stays old
  until re-hover. Alpha35 replaces that Board label popup with live React content;
  focused DOM checks pass, exact native closure remains pending. Other native-title
  tooltips are not claimed as redesigned or dynamically validated by this repair.

### Alpha35 explicit feedback / compact select candidate

Questions cached-error answer loss and Table cached-row loss were reproduced and
repaired in scoped DOM tests. Explicit Questions/Journal/Assets/References/Bell
reads now have local owned receipts; this does not cover all action families.
See the [23-row inventory](deltas/feedback35-inventory.md) for remaining callers,
autosave and Activity gaps. Native34 also exposed compact Link reference select
clipping, distinct from the corrected lower-edge Task Status menu; alpha35's
feature-detected top layer/in-flow fallback needs actual native closure.

Native34 also confirmed short frame-title truncation at 49% and reference menu
Escape/outside non-dismissal. Alpha35 source repairs are independently reviewed;
26 focused tests and prepared browser scenarios do not close native appearance.
Explicit Fit is corrected; a deliberately preserved saved origin camera can still
require Fit/pan to reveal a header. Remaining family feedback gaps stay in the
inventory rather than being implicitly accepted by this release.

## Alpha35 native follow-up and alpha36 spacing

Exact35 observed frame/Fit, reference-menu dismissal, dark compact Link Select,
both-theme Task Status and stationary tooltip expiry corrections. The opposite
stationary tooltip direction and native input/save/error cases remain unrun; see
the exact-version verification addendum rather than treating all action rows as
passed. It also observed a 13 px toolbar/filter background overlap after Refresh.
Alpha36 replaces fixed overlay offsets with normal flow; DOM/source checks are
not native spacing acceptance. Dynamic resizing of an already-open note and
extreme control content consuming the viewport remain separate limits.

## Alpha35 hosted failures and alpha37 correction

The first published35 run passed 86/89 browser cases, not the entire suite. Two
frame tests ran before the lazy canvas existed; a third exposed real summary
Space suppression by ReactFlow. Alpha37 fixes the readiness contract and isolates
the summary key without removing the failing Space assertion. The exact alpha37
hosted run passed those three cases but was not green: Linux 92/93 then exposed
caption-dialog return focus, and Windows failed the unchanged preview timing
observer. Alpha38 corrects these bounded causes; its hosted result is still
pending. Changed-control native confirmation remains separate. The user's rejection
of the inline creation form is not resolved by this keyboard repair: direct
placement/writing with optional title is the separate alpha38 candidate, not yet
rendered acceptance.

## Alpha38 remaining evidence

The old inline form is not accepted simply because it is on the canvas. Direct
paper must be inspected after actual placement, typing, optional heading and
reopening; local native transport is currently unavailable. Hosted screenshot
scenarios are prepared, not executed evidence. Content-equality checking protects
against a different current heading/body, not historical ABA or unguarded future
agent writes. Uncertain creation cannot be reliably deduplicated without a server
idempotency key; the UI must retain text and never automatically create again.

Actual-router review also caught a pristine saved-note blocker after project
context loss. Alpha38 allows a genuinely clean departure, while a dispatched
unresolved operation remains protected even if the user types back to baseline.
DOM/source checks cover this distinction; no native interruption claim is made.

## Alpha38 actual rendering and alpha39 correction

The corrected alpha38 hosted run passed94/96; body-only paper creation/autosave
was rendered in light/dark. Optional-heading/reopen failed because a canvas clone
of an old query row was treated as a new remote edit after our own acknowledgement.
Alpha39 distinguishes repeated observation from changed content without removing
the server equality guard. Subsequent alpha39 and alpha40 hosted runs passed the full lifecycle/heading
cases and six paper PNG states; the original conflict screenshot remains failure
evidence. No native38/39 note
input or rendering claim is made. Exact content+marker ABA remains indistinguishable
without revision history; no stronger concurrency guarantee is claimed.

## Alpha40 readability boundary

The 46-family source pass is not a blanket visual or accessibility pass. The AST
index excludes dynamic/backend/native copy and all data permutations; user text
is neither translated nor rewritten. Hosted synthetic state/PNG checks and
native unavailable transport stay distinct. Source/DOM evidence cannot close
minimum-native-width, fractional-DPI or all hidden error-layout cases.

Exact alpha40 completed 103 hosted browser cases and 12 inspected synthetic
PNGs. The named paper/pickup/guidance checks are observed; other families in the
source ledger are not silently promoted to full visual acceptance. See the
[terminal version record](../verification/0.3.0-alpha.40.md#terminal-hosted-and-rendered-result--2026-10-22).
