# Known gaps and next work

[Index](README.md). Source baseline alpha28 `2b263795b31767da29db0b62dc81f4da19dfc4d1`; source inspection 2026-10-22. Priorities describe impact, not permission to mutate live user data. All runtime/native acceptance remains unexecuted by this documentation audit.

## Status ledger

| Work | Status on 2026-10-22 | Completion evidence required |
|---|---|---|
| Human-first Task/Story | Corrected alpha29 DOM closure and bounded native read-only evidence; native text entry blocked | HF01–HF06 functional + open-state visual evidence; preserve reports, readiness and drafts |
| Reference frame grip/empty state | Alpha30 source/DOM; alpha32 source visual treatment; native pending | RF01, RF02 |
| Create notes inline | Alpha30 local-draft implementation and behavior tests; persisted-note editing unchanged | RF03 including create ambiguity and duplicate guard |
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
| F03 | Alpha30 inline local draft implemented; native editing pending | `ReferencesPage.tsx:1066,1213+`, `references/dialogs.tsx:8+` create note in AddReferenceDialog. `Nodes.tsx:226–279` inline body editing only, double-click/Enter. | Add note → immediate positioned editable card; title and body writable inline; one activation does not require guessing double-click; keyboard start/save/cancel; failed create/save retains text; no duplicate after repeated Add/Save. |
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
- Inline-note decision: Add creates a local draft only; explicit Save requires nonblank body. An uncertain dispatched create retains copyable text and permits read-only reconciliation, never automatic creation replay or a rollback claim.
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
