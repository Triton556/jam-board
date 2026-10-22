# Human interaction map

[Agent documentation index](README.md) · [Acceptance matrix](acceptance-matrix.md)

Baseline: alpha28, source `2b263795b31767da29db0b62dc81f4da19dfc4d1`, inspected 2026-10-22. Component paths are relative to `apps/desktop/src/`. This inventories all route/action families found in the source (46 rows), not every possible state permutation. Each row ID is stable; append IDs rather than renumbering existing cases. An inventory is not an executed acceptance result.

## Alpha29 working-tree delta (implementation present; final gates pending)

- D01/D03: Task Description uses existing `descriptionMd`; real task Comments move near it (`task/TaskComments.tsx`). No parallel description schema.
- D02: structured task brief moves under collapsed Agent plan (`plan/AgentPlan.tsx`); children remain mounted/registered. Readiness and reports still use the full structure. Task technical Markdown blur submits only the brief, not an unrelated human Description/status draft. Main task Save intentionally submits all dirty fields. Story technical pending/unconfirmed errors remain visible when collapsed; Read latest Story is read-only and retains local drafts.
- P04: Story Description uses existing `outcomeMd`; remaining intent and acceptance move under Agent plan. Story has **no new comments schema**.
- Task comment and Story Description drafts are scoped/in-session. Do not describe them as persisted across application restart.
- No alpha29 frame, inline-note, bell, zoom, prompt shortening or session-streaming change is asserted here. See known gaps.
- New acceptance IDs HF01–HF06 cover this delta. The table below describes alpha28 unless superseded by these explicit entries; replace baseline labels only with exact-version evidence.

## Depth convention

D0 is a route/base surface; D1 is a revealed drawer, menu, dialog or inline editor; D2+ is the next nested interaction. A disclosure is a depth step but is not automatically a modal. System file/date pickers are native boundaries. Route-to-route navigation resets the base surface; record the return path separately.


Legend: `D0` base route; `D1` revealed editor/menu/modal; `D2+` nested layers. Every row includes the source surface so this is not an imagined product menu.

| ID | D0 → D1 | D2 / D3 / deeper actual path | State/recovery and return tests | Source |
|---|---|---|---|---|
| G01 | App rail → Search & commands dialog | Search text → task/navigation command results | Loading chunk, empty matches, results failure; Escape then opener focus; executing task opens correct drawer, no duplicate overlay | `app.tsx`; `command/CommandCenter.tsx`; `CommandPalette.tsx` |
| G02 | App → Keyboard shortcuts dialog | Shortcut list; no nested mutation | Escape/close; hotkeys inactive in text fields and while incompatible modal open; modal tab loop | `command/CommandCenter.tsx`; `lib/shortcuts.ts` |
| G03 | App → transient toast or Project notifications bell | File receipt details remain separate; bell → paginated persisted agent updates → exact task/question View; explicit read watermark | Pending/read-error/older-latest races, partial history, project/ABA cancellation, route failure recovery, keyboard return; never claims toast delivery | `features/notifications/NotificationBell.tsx`; `app.tsx`; `lib/ui-store.ts` |
| G04 | App → project-name control → Your projects | Active/Archived list → Restore & open / New project | Initial error retry, empty each list, selection pending, lost-response reread, back to current project; agents remain pinned | `projects/ProjectsPage.tsx`; `lib/project-selection.ts` |
| O01 | `/welcome` → project setup steps | Template/timing controls → create | Back between steps, existing project return, validation, pending/error; no accidental demo replacing current work | `onboarding/Welcome.tsx`; `ProjectTiming.tsx` |
| P01 | `/plan` → epic rail filter / selected epic | New epic dialog → create; epic menu → copy actions | Empty plan vs failed read; Draft/Archived visibility; long title/brain labels at narrow width | `plan/PlanPage.tsx:130–310,360+` |
| P02 | `/plan/$epicKey` → Overview | Planning status / Brain / Participation / Separate reviewer dropdowns; worker-model datalist | Empty agent choices, update pending/error, stale background data keeps active edit; dropdown active vs selected colors | `PlanPage.tsx:390–580`; `PlanningControls.tsx`; `PlanningInput.tsx` |
| P03 | Epic → Overview Markdown edit | Write/Preview; linked References → picker → New link/note dialog (D3) | Blur autosave vs explicit save understood; failure keeps draft; focus/read position; exact epic scope in reference creation | `PlanningControls.tsx`; `references/ReferencesSection.tsx`; `references/dialogs.tsx` |
| P04 | Epic → Stories tab → story drawer | Status dropdown; acceptance row editing; + Task → New task dialog → Story dropdown (D3) | Empty tasks, story initial load error/retry, cached read-warning preserving draft, long acceptance scroll; return story/epic | `plan/StoryDrawer.tsx`; `NewPlanningDialog.tsx` |
| P05 | Epic → Journal tab | Filter dropdown; session disclosure → journal contents | Empty journal, filter no matches, long payload wrap, scope navigation and return | `plan/Journal.tsx` |
| P06 | Epic → Questions tab | Question options / custom answer / scope navigation | Submit pending, stale/resolved question, failed answer retained, receipt after removal | `inbox/InboxPage.tsx` shared question surfaces |
| P07 | Epic/story/task → Prepare planning prompt | Brain handoff dialog → selectable prompt / copy | Copy unavailable/fails; captured project/entity exact; unsaved-notes warning; Copy never starts worker | `plan/BrainHandoff.tsx` |
| P08 | Epic/story → Start action | Start scope dialog → consequences; How starting works disclosure | Snapshot invalidated by scope/project change; pending lock; failure inside dialog; Cancel/Escape no grant; Pause separate action | `execution/ExecutionControls.tsx` |
| B01 | `/board` → filter/color controls / columns | Quick task creation → Story choice; task card → task drawer | Empty filtered column vs empty board; horizontal scroll buttons/keys; pointer move refusal/unconfirmed result; no keyboard-drag assumption | `board/Board.tsx`; `BoardHeader.tsx`; `BoardOverflow.tsx`; `EpicFilters.tsx` |
| B02 | Board → task card drawer | Status dropdown → Save → relocated card → close | Original card replaced/filtered/archived; return correct replacement or stable Board entry; no later read stealing focus; A→B→A generation | `board/Board.tsx`; `task/TaskDrawer.tsx`; `components/ui/controls.tsx` |
| T01 | `/table` → filters / sort / working layer | Status/assignee dropdowns; inline task create; row → task drawer | No matches, loading/error, many rows/scroll; keyboard keys don't accidentally submit/create | `table/TaskTable.tsx`; `TableRow.tsx`; `WorkingLayer.tsx`; `InlineTaskCreate.tsx` |
| D01 | Any task entry → task drawer | Status/Assignee dropdowns; Priority/Estimate controls; Due → native picker; Tags → datalist | Initial lazy/data loading/rejection; archived read-only; all control labels; no lost title edit; pending Save; footer remains reachable | `task/TaskDrawer.tsx`; `components/ui/controls.tsx`; `CustomSelect.tsx` |
| D02 | Task drawer → technical brief | Change row → Context and guardrails (D2) → field help tooltip (D3); test rows; Markdown write/preview | Add/remove/reorder lists, required-field errors, empty lists, long code/paths, preserve human description and agent structure | `task/BriefEditor.tsx`; `components/ui/ListEditor.tsx`; `MarkdownField.tsx` |
| D03 | Task drawer → Notes / Comments / History | Notes Write/Preview; comment submit Ctrl+Enter; history disclosure | Comment failure keeps text, duplicate pending submission, new agent comment doesn't reset edit/scroll; history empty/large | `task/TaskDrawer.tsx:700–900` |
| D04 | Task drawer → actions menu | Archive/unarchive dialog → optional reason / dirty warning | Escape sequence; repeated archive; pending close and late result; restore doesn't restart execution | `task/TaskDrawer.tsx:430+,926+` |
| D05 | Dirty task drawer → navigation/close | Discard changes dialog → Keep editing / Discard | Back/Forward/project navigation, nested modal closes first; Keep editing returns to draft; discard exact intended draft only | `task/TaskDrawer.tsx:909+` |
| D06 | Concurrent task edit → Review changes dialog | Three-way comparison → reread latest / keep saved / apply edits | Second concurrent edit invalidates comparison; draft retained; whole-list replacement understandable; narrow columns stack/readable | `task/TaskConflictDialog.tsx` |
| D07 | Task/Board move → readiness dialog | Captured brief disclosure → structured saved brief | Initial load/error Check again; not-ready, ready, stale, archived, already-ready; reason retained on reread; no execution implied | `task/Readiness.tsx`; `ReadOnlyBrief.tsx` |
| D08 | In-progress task → Release claim / Return to Backlog | Confirmation → latest worker status / View team status | Unsaved edit guard, task/project revision changed, failure/receipt; wording explicitly does not stop external worker | `task/ReleaseClaim.tsx` |
| D09 | Task → report rounds → Request changes dialog | Changed files disclosure; captured criteria disclosure → Task/Story/Epic disclosures (D3/4) | Long report then Go to comments/Back to captured report; failed tests removed in latest report; draft retained; no hidden error below fold | `task/Rounds.tsx`; `ReportEvidence.tsx`; `ReviewContext.tsx` |
| D10 | Task → linked assets | Link existing dialog → search/select; Attach file → native file picker | Empty assets/read fail/retry; file picker cancel, missing file, write failure; stale task/project; unlink result visible | `assets/AssetLinkDialog.tsx`; `task/TaskDrawer.tsx:760+` |
| D11 | Task/story/epic → References → Add reference dialog | Search canvas; New link/note → child dialog; New file → native picker | Depth-three focus; child Cancel returns picker, child Save closes intended layers; no-match vs load failure; file-picker return after route/project change | `references/ReferencesSection.tsx:132+`; `references/dialogs.tsx` |
| I01 | `/inbox` → question card | Choices/custom answer; collapse/open; navigate scope → drawer/page | Open/resolved list, empty/read failure/retry, failed write retains answer, removal receipt and stable heading focus | `inbox/InboxPage.tsx` |
| I02 | Inbox → execution request → Approve | Approve start dialog → captured consequences | Stale/superseded/declined/approved, pending and failed approval; no double grant; approval receipt not claim of worker launched | `execution/ExecutionRequests.tsx` |
| A01 | `/assets` → add/edit asset dialog | File/URL tabs; Choose file → native picker; Kind dropdown; link targets | Required field/invalid URL, empty/search/filter, read retry, pending/error/project-changed; tabs keyboard and source-specific fields | `assets/AssetsPage.tsx:127+`; `AssetLinkDialog.tsx` |
| R01 | `/references` → Add menu | Note placement → canvas click/Enter → body on paper; optional Add title; link/frame dialog and native file picker remain separate | New blank is local; idle/blur autosave; pending/newer typing; uncertain create retains text without automatic replay; project/lifetime ownership | `references/ReferencesPage.tsx`; `DraftNote.tsx`; `StickyEditor.tsx`; `use-sticky-note.ts` (alpha38 candidate) |
| R02 | References → frame selection | Resize handles; title tab collapse; edit frame dialog → Epic dropdown; archive → Undo notice | Grab region and low zoom; frame vs child move; collapsed children; archive/undo geometry; selected focus indicator | `references/Nodes.tsx:281+`; `ReferencesPage.tsx:297+,416+`; `references.css:342+` |
| R03 | References → reference Actions details | Edit caption / Tags / Link to dialog → searchable target dropdown (D3); Open target; Archive | Label clipping and popup bounds; return to originating card; dead/archived linked entity; failed mutation visibility | `references/Nodes.tsx:110+`; `references/dialogs.tsx:172+` |
| R04 | References → existing note | Double-click/Enter or Edit note → same direct body/optional-heading editor → finish | No-heading survives reopen; explicit Note heading retained; content-equality conflict preserves draft; cleared existing paper remains a record; no uncertain-write replay | `references/Nodes.tsx`; `StickyEditor.tsx`; `use-sticky-note.ts` (alpha38 candidate) |
| R05 | References → image / audio / video / link | Image lightbox; audio seek/play; external link / Fetch/Remove preview | Missing local file, unsupported preview, long title/lightbox fit; page leave stops audio; fetch error cannot look like success | `references/Media.tsx`; `Nodes.tsx`; `ReferencesPage.tsx:1280+` |
| R06 | References → Connect mode → edge | Edge label dialog; right-click archive; selection delete; Undo/Redo | Mode hint, no edge selected, fail after save, repeated Submit, edge label long/empty; geometry history origin project | `references/ReferencesPage.tsx`; `references/Edge.tsx`; `model.ts` |
| R07 | References → filter / minimap / zoom / fit | Overview representation below 0.4; selected item expansion | All-filtered differs from empty, low-zoom controls still discoverable, fit includes frames; keyboard focus remains visible | `ReferencesPage.tsx`; `OverviewScene.tsx`; `Nodes.tsx` |
| R08 | References → paste/drop batch | Progress → receipt → File details disclosure | Decode delay A→B→A, route leave, partial success, confirmed/unconfirmed/not attempted; explicit Refresh not mutation replay | `references/clipboard-paste.ts`; `lib/file-drop-batch.tsx`; `docs/workflow-ux.md` |
| M01 | `/team` → Add human / Edit teammate dialog | Color swatches; emoji input | Validation and long name; pending close/repeated Enter; failure kept; agent vs human avatar constraints | `team/TeamPage.tsx:17–100` |
| M02 | Team → agent task/status / Connect | Task drawer or Settings; status details | No members, stale heartbeat, agent working different task; do not imply streaming or running work from presence alone | `team/TeamPage.tsx`; `AgentStatus.tsx` |
| H01 | `/activity` → filters | Member/action dropdowns; session disclosure; linked task → drawer | Empty results/read retry, long event payload, changing active filters; return scroll; not interchangeable with notification receipts | `activity/ActivityPage.tsx`; `EventWords.tsx` |
| S01 | `/settings` → Agents / connection tabs | Token reveal/copy; Regenerate token confirmation; connection-help disclosures; config tabs | Masking, copy failure visible, stale project context, token action consequences; never reproduce secret in audit | `settings/SettingsPage.tsx:293–580` |
| S02 | Settings → optional workflow guidance | Missing-playbook help; preview/results; Install into target confirmation | Long path heading wraps, preview/error/reset states, cancel, repeated install; installs files but does not connect/start agent | `settings/SkillSetup.tsx:140+,336+` |
| S03 | Settings → Your local sketchbook | Native export/import/file actions; Load demo confirmation; Archive project typed-name confirmation | Cancel OS picker, invalid import, pending/late errors; running-work check pending/error prevents unsafe archive; correct project receipt | `settings/SettingsPage.tsx:582+,828+` |
| S04 | Settings → Your project | Template dropdown → Switch template? dialog | Cancel retains settings; text explains preservation; long titles/buttons; success/error/local receipt | `settings/ProjectSettings.tsx:188+,301+` |
| S05 | Settings → Your board / Paper | Controls, theme/accent/sound and local actions | Read/write errors; disabled controls distinguish pending; theme change all open overlays; reduce-motion | `settings/SettingsPage.tsx:657–820`; `components/ui/SettingsForm.tsx` |


## Alpha29 validation handoff (2026-10-22)

Implementation owner reports **539 DOM tests passed**, including 30 new behavior probes. Four new functional-browser scenarios were added/typechecked but **not executed** at this checkpoint. This documentation author did not rerun those tests; the release verification record must supply final source/version and exact terminal evidence. DOM success does not establish native pixel geometry, Windows GUI behavior or browser visual acceptance. These results apply to human-first Task/Story work, not proposed frames/notes/bell/zoom/prompt features.

## Alpha30 candidate: H-R01/R02/R04/R05/R07

Add → Note is a local canvas paper, not a modal or immediate empty record. Explicit
Save creates one unframed note at captured coordinates; pending guards, retained
unconfirmed text/read-only Refresh and local-only discard are explicit. Frame-only
content hides the empty art; the full-width visible grip and selected resize
controls do not capture frame interiors. Existing persisted note/agent-result
editing is unchanged. Image source selection accounts for painted device pixels;
read-only image retry does not change references. See [alpha30 verification](../verification/0.3.0-alpha.30.md).

## Alpha31 candidate: H-P07

Refine opens a captured target, explicit setup/continuation radio group, local What should change? request and selectable preview. Close/mode/project-return retain request per immutable target within this app session; copy failure retains it; pending Copy prevents overlapping input, and old completion cannot announce into another preview. No board write/launch. [Details and evidence](refinement-modes.md).

## Alpha31 card presence

H-B01 distinguishes claimed agent activity, human assignment, unavailable holder,
Execution unconfirmed and Awaiting review. Review never borrows the old worker
animation. Generic scoped nonassignee text is timestamped last-reported activity,
not proof of a reviewer/claim. No new focus/modal depth. [Evidence and limits](../live-card-presence.md).

## Alpha32 candidate: H-B01 and H-R02

Empty columns use short genuine-empty versus filtered-empty text, readable weight
and concise subtitles; Quick create still replaces its column's empty hint. Ready,
Start and claim semantics remain in scope/readiness controls, not repeated in long
column prose. Frames now have a single live rounded boundary/header at all zooms, a broad
grip and selected/focus cues; the interior remains pointer-transparent. Duplicate
raster frame/title output is removed, while cards/edges and all inline-draft
safeguards remain unchanged. See the [alpha32 record](../verification/0.3.0-alpha.32.md)
for exact source and observed versus pending evidence.

## Alpha33 candidate: H-G01 / H-D04 / H-M01 / H-R06

Search and commands has an actual loading/error dialog with top-layer Escape and
Close; cached chunk failure offers explicit Reload app with draft-loss warning.
Task actions consume Escape before the drawer; Archive and Unarchive confirmations
lock duplicate dispatch/dismissal while pending, and do not submit the underlying
form via Ctrl/Cmd+S. Teammate and edge-label writes preserve captured fields/error
recovery and cannot close a newer scope; retained text is readable/copyable.
Unconfirmed writes are not replayed; confirmed writes with failed refresh are
labelled separately. Edge editor returns to its real opener after dismissal.

## Alpha34 saved-answer continuation

H-I01 / H-P06: after a confirmed answer, or from Inbox → Answered, choose
**Continue in brain chat** to reveal a selectable IDs-only prompt. Copy is explicit;
clipboard failure retains selectable text, repeated pending copy is single-flight,
and project ABA/unmount suppresses stale feedback. The answer remains persisted on
the board. This is not a launched chat or automatic brain wake. See the
[contract](answer-continuation.md) and release-specific acceptance evidence.

## Alpha35 candidate: live H-B01 activity tooltip

The Board activity label keeps its current description while a tooltip is already
open, including heartbeat refresh and expiry. The existing card remains the focus
and activation target; no new tab stop, action, claim or permission is introduced.
See [native finding and bounded correction](../live-card-presence.md#alpha35-live-card-tooltip-content).

## Alpha35 read feedback and compact select correction

H-I01/P06/P05/T01, H-A01/R01 and H-G03: explicit reads expose Checking, a true
checked-at receipt or an error; background failures preserve existing editable
content. H-P02 autosave keeps newer drafts separate from acknowledged submitted
text and refuses an absent/switched project before dispatch. See the scoped
[feedback inventory](deltas/feedback35-inventory.md), not a whole-app pass claim.
H-R03/H-D01: compact searchable selects can use a native top layer while retaining
modal DOM ownership; unsupported engines have an in-flow fallback. First Escape
closes the select, then its parent. See [placement contract](overlay-placement.md).

H-R02/R03: narrow frame headers use a separate title row; explicit Fit includes
painted header/tool extents. Item Actions supports Escape and outside dismissal,
then returns child-dialog focus to its visible summary. Neither changes stored
frame geometry or resets the saved camera on route entry.

## Alpha36 reference control spacing

H-R01/R02/R03: tools, filters and read notices now share one normal-flow overlay;
receipt/error wrapping pushes subsequent surfaces down with a visible gap. Empty
space between them still accepts canvas gestures. Fit and initial inline-note
placement reserve the complete current overlay, not fixed toolbar offsets. Drafts,
filter semantics, stored camera entry and mutation ownership remain unchanged.

## Alpha37 reference keyboard repair

H-R03: focused item Actions retains native Enter/Space activation; Escape closes
only its menu and returns focus. Summary Space is isolated from the canvas pan
shortcut, while empty-canvas Space remains available. The alpha35 hosted failure
and the unchanged real-key scenario are recorded in alpha37 verification.

## Alpha38 candidate: H-R01 / H-R03 / H-R04 / H-R07

Direct paper supersedes the historical alpha30 Title/Note/Save form. The empty
new paper is local until nonblank heading or body triggers autosave; a deliberate
clear of an existing note is a valid saved state, not deletion. Explicit heading
`Note` and a deliberately empty heading are distinct stored values. Existing
media captions and agent result cards retain their previous editing surfaces.

A returned error is not proof that a write did not happen. Creation uncertainty
keeps text for inspection/read-only recovery and does not create again. Known-ID
updates compare both inspected content fields atomically; this cannot detect a
remote change-away-and-back history and does not make unguarded agent writes
revision-aware. Hosted/native rendered-paper acceptance is recorded separately.
