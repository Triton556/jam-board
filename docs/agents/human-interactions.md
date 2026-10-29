# Human interaction map

## Round 6 W1: H-R07/R11/R12/R20/R23 and H-BD15

RF02 follow-up: H-R02 frame controls keep at least 24 screen pixels at every
supported zoom. When their enlarged targets cannot fit, the bounded header keeps
the title and a Frame actions menu for linking, collapse/expand, editing,
archiving and linked work. Menu dismissal returns focus to its trigger; Edit
keeps the dialog's opener ownership. Fit reserves the larger control row.

RC07 selects gesture-only viewport promotion from QA's 108-run matrix. The seven
other round-6 rendering paths and runtime flags are removed. Standard React Flow
virtualizes nodes/edges, with active note drafts retaining their mounted owners.
H-R02 frame headers remain continuously width-capped at every zoom. H-R07 uses
the standard minimap with transparent frames and themed item colours.

Ctrl/Cmd+A, Shift marquee, group Undo/Redo and drawer/brain drop payloads use model
IDs, independently of mounted cards. Tab reveals a virtualized next item before
focusing it; Enter reveals an off-screen note before editing. Existing overview,
verdicts and draft/recovery paths remain. Shared tooltips and direct zoom updates
are restored. DOM/mock tests do not establish native/browser screenshot quality;
QA will confirm the selected source's timing and screenshots. RC01�RC06 rendering
experiments in the historical W1 record are superseded by RC07.
Alpha.42 release-gate follow-up: H-T01 status filters reserve both normal and
bold caption widths so selecting a status does not shift neighboring controls.
See the version verification record for the Windows Chrome result and remaining
browser failures; no native acceptance is implied.

The current brain-dock increment adds in-app sessions and board entry points,
canvas organization (AG14 / AC14), and the UX changes marked below. It supersedes
older copy-only/no-session descriptions for those paths. Source inventory is not
browser/native acceptance; every changed row below remains not yet run.

[Agent documentation index](README.md) · [Acceptance matrix](acceptance-matrix.md)

Inventory baseline: alpha28, source `2b263795b31767da29db0b62dc81f4da19dfc4d1`, inspected 2026-10-22. Component paths are relative to `apps/desktop/src/`. This inventories all route/action families found in the source (46 original rows; 82 inventory rows including BD01-BD20 and R09-R24; 28 round-5 rows remain pending), not every possible state permutation. The canonical rows are maintained as behavior changes; dated appendices retain historical checkpoint evidence. Each row ID is stable; append IDs rather than renumbering existing cases. An inventory is not an executed acceptance result.

## Alpha29 working-tree delta (implementation present; final gates pending)

- D01/D03: Task Description uses existing `descriptionMd`; real task Comments move near it (`task/TaskComments.tsx`). No parallel description schema.
- D02: structured task brief moves under collapsed Agent plan (`plan/AgentPlan.tsx`); children remain mounted/registered. Readiness and reports still use the full structure. Task technical Markdown blur submits only the brief, not an unrelated human Description/status draft. Main task Save intentionally submits all dirty fields. Story technical pending/unconfirmed errors remain visible when collapsed; Read latest Story is read-only and retains local drafts.
- P04: Story Description uses existing `outcomeMd`; remaining intent and acceptance move under Agent plan. Story has **no new comments schema**.
- Task comment and Story Description drafts are scoped/in-session. Do not describe them as persisted across application restart.
- No alpha29 frame, inline-note, bell, zoom, prompt shortening or session-streaming change is asserted here. See known gaps.
- New acceptance IDs HF01–HF06 cover this delta. Current canonical rows incorporate the brain-dock increment; dated appendices retain their original evidence and do not certify changed code.

## Depth convention

D0 is a route/base surface; D1 is a revealed drawer, menu, dialog or inline editor; D2+ is the next nested interaction. A disclosure is a depth step but is not automatically a modal. System file/date pickers are native boundaries. Route-to-route navigation resets the base surface; record the return path separately.


Legend: `D0` base route; `D1` revealed editor/menu/modal; `D2+` nested layers. Every row includes the source surface so this is not an imagined product menu.

| ID | D0 -> D1 | D2 / D3 / deeper actual path | Functional and recovery assertions | Source | Required visual states | Increment QA result |
|---|---|---|---|---|---|---|
| G01 | App rail → Search & commands dialog | Search text → task/navigation command results | Loading chunk, empty matches, results failure; Escape then opener focus; executing task opens correct drawer, no duplicate overlay | `app.tsx`; `command/CommandCenter.tsx`; `CommandPalette.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| G02 | App -> Keyboard shortcuts dialog / N / Brain Ctrl+J | Shortcut list; N on References enters note placement; Ctrl+J toggles dock, including inputs, except xterm | N ignores editable/dialog targets; Escape closes the correct layer; no shortcut sends a prompt or starts work | `command/CommandCenter.tsx`; `lib/shortcuts.ts`; `features/brain/BrainDock.tsx` | Readable shortcut hints; focused input and xterm states; dock open/closed in both themes | Not yet run (browser/native). |
| G03 | App → transient toast or Project notifications bell | File receipt details remain separate; bell → paginated persisted agent updates → exact task/question View; explicit read watermark | Pending/read-error/older-latest races, partial history, project/ABA cancellation, route failure recovery, keyboard return; never claims toast delivery | `features/notifications/NotificationBell.tsx`; `app.tsx`; `lib/ui-store.ts` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| G04 | App → project-name control → Your projects | Active/Archived list → Restore & open / New project | Initial error retry, empty each list, selection pending, lost-response reread, back to current project; agents remain pinned | `projects/ProjectsPage.tsx`; `lib/project-selection.ts` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| O01 | `/welcome` → project setup steps | Template/timing controls → create | Back between steps, existing project return, validation, pending/error; no accidental demo replacing current work | `onboarding/Welcome.tsx`; `ProjectTiming.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| P01 | `/plan` → epic rail filter / selected epic | New epic dialog → create; epic menu → copy actions | Empty plan vs failed read; Draft/Archived visibility; long title/brain labels at narrow width | `plan/PlanPage.tsx:130–310,360+` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| P02 | `/plan/$epicKey` → Overview | Planning status / Brain / Participation / Separate reviewer dropdowns; worker-model datalist | Empty agent choices, update pending/error, stale background data keeps active edit; dropdown active vs selected colors | `PlanPage.tsx:390–580`; `PlanningControls.tsx`; `PlanningInput.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| P03 | Epic → Overview Markdown edit | Write/Preview; linked References → picker → New link/note dialog (D3) | Blur autosave vs explicit save understood; failure keeps draft; focus/read position; exact epic scope in reference creation | `PlanningControls.tsx`; `references/ReferencesSection.tsx`; `references/dialogs.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| P04 | Epic → Stories tab → story drawer | Status dropdown; acceptance row editing; + Task → New task dialog → Story dropdown (D3) | Empty tasks, story initial load error/retry, cached read-warning preserving draft, long acceptance scroll; return story/epic | `plan/StoryDrawer.tsx`; `NewPlanningDialog.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| P05 | Epic → Journal tab | Filter dropdown; session disclosure → journal contents | Empty journal, filter no matches, long payload wrap, scope navigation and return | `plan/Journal.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| P06 | Epic -> Questions tab -> saved answer | Primary Continue in brain chat stages continuation + scope chip; secondary copy remains | Exact saved answer/project/scope; compose does not send, wake a turn, appoint a brain or approve Start; copy failure retains usable text | `inbox/InboxPage.tsx`; `inbox/AnswerContinuation.tsx`; `brain/brain-store.ts` | Answer receipt and primary/secondary actions readable; long answers, stale scope, copy failure | Not yet run (browser/native). |
| P07 | Epic/story/task drawer heading -> Refine with brain | Setup/continue dialog -> primary Open in brain chat; secondary Copy prompt | Stage the captured scoped prompt + scope chip, then close dialog; preserve existing human text and project guards; no automatic send/start | `plan/BrainHandoff.tsx`; `task/TaskDrawer.tsx`; `plan/StoryDrawer.tsx` | Heading actions fit narrow drawers; dialog preview, unsaved warning, pending/error and copy fallback visible | Not yet run (browser/native). |
| P08 | Epic/story → Start action | Start scope dialog → consequences; How starting works disclosure | Snapshot invalidated by scope/project change; pending lock; failure inside dialog; Cancel/Escape no grant; Pause separate action | `execution/ExecutionControls.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| B01 | `/board` → filter/color controls / columns | Quick task creation → Story choice; task card → task drawer | Empty filtered column vs empty board; horizontal scroll buttons/keys; pointer move refusal/unconfirmed result; no keyboard-drag assumption | `board/Board.tsx`; `BoardHeader.tsx`; `BoardOverflow.tsx`; `EpicFilters.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| B02 | Board → task card drawer | Status dropdown → Save → relocated card → close | Original card replaced/filtered/archived; return correct replacement or stable Board entry; no later read stealing focus; A→B→A generation | `board/Board.tsx`; `task/TaskDrawer.tsx`; `components/ui/controls.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| T01 | `/table` → filters / sort / working layer | Status/assignee dropdowns; inline task create; row → task drawer | No matches, loading/error, many rows/scroll; keyboard keys don't accidentally submit/create | `table/TaskTable.tsx`; `TableRow.tsx`; `WorkingLayer.tsx`; `InlineTaskCreate.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| D01 | Any task entry -> task drawer | Breadcrumb/title -> compact permission and claim controls -> Why?; usual task fields remain | One Why? reveals both retained permission/claim explanations; title edit/drafts, archived read-only state and pending Save preserved | `task/TaskDrawer.tsx`; `task/TaskPermissionStatus.tsx`; `task/ReleaseClaim.tsx` | Readable title-first hierarchy; compact controls wrap; expanded explanations and long breadcrumbs fit with dock open | Not yet run (browser/native). |
| D02 | Task drawer → technical brief | Change row → Context and guardrails (D2) → field help tooltip (D3); test rows; Markdown write/preview | Add/remove/reorder lists, required-field errors, empty lists, long code/paths, preserve human description and agent structure | `task/BriefEditor.tsx`; `components/ui/ListEditor.tsx`; `MarkdownField.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| D03 | Task drawer → Description / Comments / History | Description Write/Preview; comment submit Ctrl+Enter; history disclosure | Comment failure keeps text, duplicate pending submission, new agent comment doesn't reset edit/scroll; history empty/large | `task/TaskDrawer.tsx:700–900` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| D04 | Task drawer → actions menu | Archive/unarchive dialog → optional reason / dirty warning | Escape sequence; repeated archive; pending close and late result; restore doesn't restart execution | `task/TaskDrawer.tsx:430+,926+` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| D05 | Dirty task drawer → navigation/close | Discard changes dialog → Keep editing / Discard | Back/Forward/project navigation, nested modal closes first; Keep editing returns to draft; discard exact intended draft only | `task/TaskDrawer.tsx:909+` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| D06 | Concurrent task edit → Review changes dialog | Three-way comparison → reread latest / keep saved / apply edits | Second concurrent edit invalidates comparison; draft retained; whole-list replacement understandable; narrow columns stack/readable | `task/TaskConflictDialog.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| D07 | Task/Board move → readiness dialog | Captured brief disclosure → structured saved brief | Initial load/error Check again; not-ready, ready, stale, archived, already-ready; reason retained on reread; no execution implied | `task/Readiness.tsx`; `ReadOnlyBrief.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| D08 | In-progress task -> compact claim controls / Why? -> Release claim | Confirmation -> latest worker status / View team status; shared retained explanations | Existing captured-version release and unsaved guard remain; failed/stale release retains confirmation; release does not stop the process | `task/ReleaseClaim.tsx`; `task/TaskPermissionStatus.tsx` | Both explanations discoverable under one Why?; pending/error/receipt legible below title, including narrow task drawer | Not yet run (browser/native). |
| D09 | Task → report rounds → Request changes dialog | Changed files disclosure; captured criteria disclosure → Task/Story/Epic disclosures (D3/4) | Long report then Go to comments/Back to captured report; failed tests removed in latest report; draft retained; no hidden error below fold | `task/Rounds.tsx`; `ReportEvidence.tsx`; `ReviewContext.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| D10 | Task → linked assets | Link existing dialog → search/select; Attach file → native file picker | Empty assets/read fail/retry; file picker cancel, missing file, write failure; stale task/project; unlink result visible | `assets/AssetLinkDialog.tsx`; `task/TaskDrawer.tsx:760+` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| D11 | Task/story/epic → References → Add reference dialog | Search canvas; New link/note → child dialog; New file → native picker | Depth-three focus; child Cancel returns picker, child Save closes intended layers; no-match vs load failure; file-picker return after route/project change | `references/ReferencesSection.tsx:132+`; `references/dialogs.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| I01 | /inbox -> Questions heading row / question card | Heading, Refresh and receipt share a row; answer -> Continue in brain chat / secondary copy | Retain choices/custom-answer drafts on failure; staged continuation contains saved scope/answer and sends nothing; refresh errors differ from empty | `inbox/InboxPage.tsx`; `inbox/AnswerContinuation.tsx` | Heading/actions/receipt wrap without overlap; long resolved answers and stale/error states remain in content column | Not yet run (browser/native). |
| I02 | Inbox -> Start requests in shared content column -> Approve | Approve start dialog -> captured consequences; decline/stale/pending paths | Exact fresh typed approval only; duplicate pending actions blocked; saved receipt does not claim worker launch | `execution/ExecutionRequests.tsx`; `inbox/InboxPage.tsx` | Questions and Start requests align; long receipt/options, failed approval and narrow layouts stay readable | Not yet run (browser/native). |
| A01 | `/assets` → add/edit asset dialog | File/URL tabs; Choose file → native picker; Kind dropdown; link targets | Required field/invalid URL, empty/search/filter, read retry, pending/error/project-changed; tabs keyboard and source-specific fields | `assets/AssetsPage.tsx:127+`; `AssetLinkDialog.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| R01 | /references -> primary Note · N / ghost Add chevron | Add -> File/Link/Note; N or empty New note -> placement; double-click empty pane -> focused local paper at pointer | N ignores editable/dialog targets; double-click only empty pane; blank paper remains unsaved; autosave/uncertain-create guards retained; Ask brain for 2+ selected stages context | `references/ReferencesPage.tsx`; `DraftNote.tsx`; `StickyEditor.tsx`; `use-sticky-note.ts` | Primary/ghost hierarchy; placement cursor, focused blank paper, Add menu and selection-count action at readable/overview zoom | Not yet run (browser/native). |
| R02 | References → frame selection | Resize handles; title tab collapse; edit frame dialog → Epic dropdown; archive → Undo notice | Grab region and low zoom; frame vs child move; collapsed children; archive/undo geometry; selected focus indicator | `references/Nodes.tsx:281+`; `ReferencesPage.tsx:297+,416+`; `references.css:342+` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| R03 | References -> reference Actions menu | Create task from note… -> editable prefill -> Create task; Ask brain about this; existing Edit/Tags/Link/Open/Archive | Cancel creates/links nothing; confirmed create then link; failure names created key, Retry linking note repeats only link; unknown create outcome never replays; Ask brain stages one note | `references/Nodes.tsx`; `references/NoteTaskDialog.tsx`; `references/ReferencesPage.tsx` | Long menu and prefilled title/body/story fit; creation/link pending, failure with created key and link-only retry remain readable | Not yet run (browser/native). |
| R04 | References -> resting note / empty-pane double-click | Keyboard/menu/double-click -> focused direct editor; optional heading -> finish/autosave | Simplified resting labels; no note resize grip; blank new paper stays local; existing clear/no-heading and conflict recovery persist; node double-click does not create another note | `references/Nodes.tsx`; `StickyEditor.tsx`; `ReferencesPage.tsx` | Softer visible focus; resting vs selected vs editing paper; no resize grip; readable text/selection at supported zoom | Not yet run (browser/native). |
| R05 | References → image / audio / video / link | Image lightbox; audio seek/play; external link / Fetch/Remove preview | Missing local file, unsupported preview, long title/lightbox fit; page leave stops audio; fetch error cannot look like success | `references/Media.tsx`; `Nodes.tsx`; `ReferencesPage.tsx:1280+` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| R06 | References → Connect mode → edge | Edge label dialog; right-click archive; selection delete; Undo/Redo | Mode hint, no edge selected, fail after save, repeated Submit, edge label long/empty; geometry history origin project | `references/ReferencesPage.tsx`; `references/Edge.tsx`; `model.ts` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| R07 | References -> filter / minimap / zoom / fit / selection | Selected notes -> published canvas context chips; toolbar Ask brain (N) for 2+ selections | Clear published canvas context on deselection/unmount; filter-empty remains distinct; Ask brain stages selected references without send; selection/focus persist at low zoom | `references/ReferencesPage.tsx`; `OverviewScene.tsx`; `brain/brain-store.ts` | Single/multiple/cleared selection, correct count, removable context chips and overview controls in both themes | Not yet run (browser/native). |
| R08 | References → paste/drop batch | Progress → receipt → File details disclosure | Decode delay A→B→A, route leave, partial success, confirmed/unconfirmed/not attempted; explicit Refresh not mutation replay | `references/clipboard-paste.ts`; `lib/file-drop-batch.tsx`; `docs/workflow-ux.md` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| M01 | `/team` → Add human / Edit teammate dialog | Color swatches; emoji input | Validation and long name; pending close/repeated Enter; failure kept; agent vs human avatar constraints | `team/TeamPage.tsx:17–100` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| M02 | Team → agent task/status / Connect | Task drawer or Settings; status details | No members, stale heartbeat, agent working different task; do not imply streaming or running work from presence alone | `team/TeamPage.tsx`; `AgentStatus.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| H01 | `/activity` → filters | Member/action dropdowns; session disclosure; linked task → drawer | Empty results/read retry, long event payload, changing active filters; return scroll; not interchangeable with notification receipts | `activity/ActivityPage.tsx`; `EventWords.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| S01 | Settings -> Agents -> Brain dock first | Chat/Terminal connection groups -> editor; one collapsed External agents (MCP) disclosure holds older setup | Disclosure state remembered per session; reveal/token/copy and project guards unchanged; opening settings does not launch a session | `settings/SettingsPage.tsx`; `brain/BrainConnections.tsx`; `lib/ui-store.ts` | Brain dock section first; grouped Agents/API profiles; expanded legacy setup and token masking/error states fit narrow width | Not yet run (browser/native). |
| S02 | Settings -> Agents -> External agents (MCP) -> bundled Jam Board skill | Client/project picker -> review -> destination confirmation -> install/verify/log | Retain guarded installer, modified/foreign refusal and backup rules inside remembered session disclosure; no global configuration or model launch | `settings/SettingsPage.tsx`; `settings/SkillSetup.tsx` | Collapsed/expanded setup is discoverable; nested confirmation, pending/cancel/error and verification log remain reachable | Not yet run (browser/native). |
| S03 | Settings → Project data | Native export/import/file actions; Load demo confirmation; Archive project typed-name confirmation | Cancel OS picker, invalid import, pending/late errors; running-work check pending/error prevents unsafe archive; correct project receipt | `settings/SettingsPage.tsx:582+,828+` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| S04 | Settings → Your project | Template dropdown → Switch template? dialog | Cancel retains settings; text explains preservation; long titles/buttons; success/error/local receipt | `settings/ProjectSettings.tsx:188+,301+` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| S05 | Settings → Your board / Paper | Controls, theme/accent/sound and local actions | Read/write errors; disabled controls distinguish pending; theme change all open overlays; reduce-motion | `settings/SettingsPage.tsx:657–820`; `components/ui/SettingsForm.tsx` | See dated acceptance evidence. | Not rerun in this documentation pass. |
| BD01 | Brain dock Chat/Terminal -> session picker / New -> profile picker | Ready starts explicitly; Add key opens key editor; Choose a model opens model editor; unavailable/starting/error; Stop/Connections session actions | Detection never launches/downloads; session start captures project/cwd/name; hidden profiles and failed starts remain inspectable; session switching preserves scoped drafts/history  Package preparation and initialize are separate steps; see the Round-8 launch/status contract in brain-dock.md. | `brain/BrainDock.tsx`; `brain/brain-profiles.ts`; `crates/jam-agents/src/{profiles,session}.rs` | Empty vs loading/error picker; Ready/Add key/unavailable/starting/error labels; long session names and action menu bounds | Not yet run (browser/native). |
| BD02 | Dock chat -> prompt -> streamed turn / permission card | Agent-offered options -> pending -> collapsed decision; plan entries and turn-end events; Stop turn | First prompt has visible session-context chip; permissions remain pending until explicit decision/cancel; API reads auto-run and writes ask; chat/tool permission is not Start approval  Reported context percentage and exact-token/cost tooltip open Session status; context/cost do not represent plan allowance. | `brain/BrainChat.tsx`; `crates/jam-agents/src/{acp,api,session}.rs` | Pending/allowed/rejected/cancelled card; collapsed decision, visible plan/turn result and retained error without transcript jump | Not yet run (browser/native). |
| BD03 | Dock Terminal tab -> explicit terminal session -> xterm input | Resize/remount -> snapshot; Stop / Restart; application exit cleanup | Input/output and recent scrollback retained across remount only; Ctrl+J belongs to xterm there; Stop targets owned session, not board grants; packaged cleanup unverified | `brain/BrainTerminal.tsx`; `crates/jam-agents/src/{terminal,process}.rs` | Readable terminal and focus; fit on dock/window resize; start/stopped/crash/restart and long-output states | Not yet run (browser/native). |
| BD04 | Top-bar Brain / Ctrl+J -> dock shell | Chat/Terminal tabs; resizer drag/arrows/Home/End (340-720 px); close/backdrop/Escape | Width/open preference persists; >=1100 px pushes workspace, below overlays; Escape dismisses child surface before overlay; closing panel does not stop session | `brain/BrainDock.tsx`; `brain/brain-dock.css`; `lib/ui-store.ts` | Working/permission/error dots; 1099/1100 px transition; min/max width, task drawer offset, overlay focus/backdrop and reduced motion | Not yet run (browser/native). |
| BD05 | Chat transcript -> disclosures / board-key chips | Visible session-context chip; thought and tool disclosures with board chips; task/epic/story chips navigate; Jump to latest | Event sequence deduplicated; source positions retained while scrolled away; jump explicitly returns to latest; transcript buffer is in memory, not restart persistence | `brain/BrainChat.tsx`; `brain/brain-store.ts`; `crates/jam-agents/src/session.rs` | Collapsed/expanded thought/tool rows; long Markdown/tool output and streaming states; scrolled transcript, jump control and chip focus | Not yet run (browser/native). |
| BD06 | Chat composer -> editable draft and context chips | Automatic current-view + published chips/removal; @ mention picker; / commands; Mode/Model config pickers; Stop turn | Enter sends, Shift+Enter adds line, IME Enter does not send; useBrainDock().compose stages without sending; project/session drafts remain scoped; unavailable config/errors retain input  /status stays local; exact advertised /usage sends one text block while retaining staged context/files; unadvertised usage opens local status; unknown commands retain input with guidance. | `brain/BrainChat.tsx`; `brain/brain-store.ts`; `lib/agent-dock-api.ts` | Growing multiline composer, selected/removed context, empty/long pickers, pending/config errors and keyboard Escape/focus | Not yet run (browser/native). |
| BD07 | Settings/dock Connections -> connection list -> editor | Agents vs API groups; API key first, Model, Endpoint and z.ai Coding Plan hint; Advanced -> command/args/non-secret env; single Save | Save non-secret profile separately from OS credential write; failed key save discloses partial result; secret status boolean only; set/remove never returns stored key; custom edit/hide retained | `brain/BrainConnections.tsx`; `brain/brain-profiles.ts`; `crates/jam-agents/src/profiles.rs` | Blank/set masked key, required model error, endpoint hint, Advanced open/closed, pending/partial-save/remove-error and long profile fields | Not yet run (browser/native). |
| BD08 | Chat auth/error card -> recovery action | API profile: Add API key; Claude Code/Codex: Sign in with the CLI or Use an API key; Restart session / Connections | CLI sign-in opens matching terminal profile; key action opens editor; no credential echo; recovery requires explicit start/send and does not grant Start or automatically resume a saved session  Startup timeout names the connection and offers explicit Retry / Show logs with collapsed technical Details. | `brain/BrainChat.tsx`; `brain/BrainDock.tsx`; `brain/BrainConnections.tsx`; `crates/jam-agents/src/acp.rs` | Provider-appropriate primary/secondary actions; auth required/unknown, failed restart, key editor focus and missing executable states | Not yet run (browser/native). |


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

## Alpha40 readability / actual motion

The [46-family source ledger](readability-motion.md) records current label and
instruction dispositions. H-P08/I02 preserve Ready≠permission and Start≠launch;
H-G03 marking includes older updates; H-H01 retries the failed older-page cursor
and does not call an error empty/caught-up; H-T01 distinguishes no shown tasks
from filtered results. H-M02 missing status is not availability. H-B01 motion
occurs only on actual pickup/confirmed creation and is disabled for reduced
motion. No agent action/schema/authority or canvas transform behavior changed.

## Alpha41 connection and standalone skill delta

S01 adds the neutral **Connect agent to board** copy flow and a project-scoped
folder hint. Check copied exact ID, missing connection/restart path, token absence,
copy failure, role-neutral completion and stale-project folder save rejection.
S02 replaces external-playbook/Python installation with bundled standalone guidance.
The interaction has an explicit preview/confirmation and truthful pending/error/
verified states. File install is not connection, appointment or execution.

## Brain dock source boundary (feature/brain-dock, current increment)

H-BD01: explicit human start of a profile creates a dock session pinned to the
selected project. Later navigation cannot retarget its MCP server or cwd. Profile
editing/hiding and credential set/clear are separate actions; listing profiles
only detects executables and never launches or downloads an agent.

H-BD02: prompt -> streamed reply/tools -> pending permission -> explicit option or
cancel -> turn end. The first prompt's visible context is retained in history.
Remount reads the bounded session history; closing a dock does not discard it.
H-BD03: terminal start returns a pending session, waits for fitted size before spawning and shows startup until printable output or the 15-second fallback. OSC title changes update the picker. Terminal input/resize/snapshot and explicit Stop own a process tree;
application exit must stop trees, including sessions still starting. Packaged-app
cleanup is not yet verified. H-BD04-BD08 extend shell, transcript, composer,
connections and auth surfaces; UX01-UX09 cover their board entry points.

Backend implementation: `crates/jam-agents`, `src-tauri/src/agent_commands.rs`.
Contract: [brain dock](../brain-dock.md). These IDs record the native boundary;
they do not claim rendered dock or real-provider acceptance.


## Round 5 — additional human paths (pending contract inventory)

These 28 stable IDs extend the earlier action families without renumbering them.
They inventory the two orchestrator-owned contracts; they are not claims of
implemented or accepted UI. The original rows retain their historical status;
the round-7 additions below record their own evidence boundaries.
Shared gates: keyboard/focus/Escape and retained drafts; pending/error/stale-project
recovery; both themes, narrow dock/drawer geometry, zoom/DPI and reduced motion.
No launcher, attachment, Access change or dictation grants board Start or sends
a prompt automatically. Matched acceptance IDs are RR01–RR28.

| ID | Human path | Nested steps | Required functional and recovery assertions | Contract | Acceptance | Status |
|---|---|---|---|---|---|---|
| BD09 | New chat launcher | Header + or empty-state Start chat -> Connection, searchable Model (Recent/Starred/catalog), Effort -> Start | Remember choices per connection; first ACP start offers Agent default; revalidate cached choices after Ready; cancel/failure preserves intent and never sends or grants board Start | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR01 | implementation in progress; not yet run |
| BD10 | Model · Effort chip | Composer chip -> searchable model list, effort segment and advertised model_config switches | Use agent-advertised options or API catalog/style; hide unsupported controls; retain combined model/effort options; apply next turn, show post-message divider; failures retain truthful selection | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR02 | implementation in progress; not yet run |
| BD11 | Access chip | Composer shield chip -> offered access modes with descriptions -> select | Use known plain labels or agent-provided names/descriptions; unknown modes remain intact; Full auto gets danger tone; no API/terminal category invented; Access never grants board Start | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR03 | implementation in progress; not yet run |
| BD12 | Attach files | Attach button -> native multi-select file dialog -> composer attachment chips -> remove | Cancel adds nothing; copy into pinned session storage; show progress and per-file/message refusals before Send (20 MB/file, 10 files, 50 MB/message); session change cannot retarget results | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR04 | implementation in progress; not yet run |
| BD13 | Paste attachments | Focused composer -> Ctrl+V image or files -> attachment chips | Preserve ordinary text paste; show copy progress/refusals before Send; late paste results stay with captured project/session; removing a chip does not send | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR05 | implementation in progress; not yet run |
| BD14 | Drop attachments | Files dragged over dock -> Drop to attach overlay -> drop or leave | Overlay clears on leave/drop/cancel; enforce limits and runtime support before Send; terminal drops type quoted absolute paths rather than sending a chat turn | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR06 | implementation in progress; not yet run |
| BD15 | Canvas context drag to composer | Canvas item or frame -> composer drop -> removable board_ref chip | Attach exact project/entity context instead of copying a file; preserve text draft; cancel or foreign/stale context cannot retarget or send | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR07 | implementation in progress; not yet run |
| BD16 | Attachment Add to canvas | Transcript image thumbnail -> lightbox or hover Add to canvas -> copied reference | Open image on click; Add to canvas explicitly creates a copied reference in the correct current project; pending/error stays visible; retry requires reconciliation, no automatic Send | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR08 | implementation in progress; not yet run |
| BD17 | Mic states and dictation | Composer mic -> off/not installed/downloading/warming up/ready/recording/transcribing/error | Click toggles recording; show live level/timer and download progress; prepare model when recording starts, not on hover; keep audio local, cap take at 120 seconds, insert text at caret without Send | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR09 | implementation in progress; not yet run |
| BD18 | Voice popover switch | Mic hover/focus -> Voice input popover -> status, on/off, primary action, Voice settings… | Opening popover does not load model; switch persists enabled state; Download/Start dictation matches readiness; disabling stops owned runtime; errors remain actionable | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR10 | implementation in progress; not yet run |
| BD19 | Settings → Voice | Voice settings -> Enabled, Model, Install/Remove, Device, Language, Unload after | Expose Fast/Balanced/Best size/disk state; GPU only when available; install progress/cancel/resume/checksum evidence stays truthful; idle/unload/remove/disable preserve state and stop owned runtime | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR11 | implementation in progress; not yet run |
| BD20 | Voice shortcut | Composer focused -> Ctrl+Space start/stop -> Esc cancel | Shortcut acts only in composer scope; Esc cancels take at correct depth; no transcription or prompt sent after cancellation; text insertion never submits | [Brain dock, Phase 3](../brain-dock.md#phase-3--session-controls) | RR12 | implementation in progress; not yet run |
| BD21 | History and terminal resume | History tab -> Chat or Terminal -> search/open -> row menu or Resume | Show provider, model, activity and resume capability; opening does not launch. Rename, Delete/Undo and project-pinned resume retain CLI transcripts on deletion; missing transcripts and duplicate active resumes fail clearly.  Starting/running terminals show Running immediately; open focuses the existing tab. Only ended entries without a user transcript are hidden because unused shells are not resumable conversations; load/startup relink alpha.44 entries (see history contract). | [Brain dock history](../brain-dock.md#phase-4--history-and-resume) | BC13 | Implemented source; fake and mock evidence; native/live acceptance pending. |
| BD22 | Launch logs and warnings | Session actions -> Logs -> timeline / Copy raw / Back; stale MCP warning -> copy path or dismiss | Display bounded redacted step, stderr and warning events with timestamps and distinct states; preserve scroll position and focus return. Warning gives path and fix without modifying configuration.  Session actions also open Session status; the context chip and /status reach the same popover with connection/model/access, evidenced MCP, global config, context/cost, start time and session-scoped Codex Plan usage. | [Brain dock UX](../brain-dock.md#ux) | BC12 | Implemented source; mock evidence; native acceptance pending. |
| BD23 | User configuration on launch | Settings default -> New chat / New terminal / Resume -> question or choice chip -> launch | Ask prompts every ACP/terminal launch; Always / Never dispatch explicit include / exclude without a question, and permit a one-launch override. Cancel sends nothing; API skips agent configuration; exclusion is partial and unsupported custom exclusions fail before launch. | [Brain dock UX](../brain-dock.md#ux) | BC12 | Implemented source; fake and mock evidence; native/live acceptance pending. |
| BD24 | Usage-limit recovery | Provider error -> reset when known -> Switch connection | Usage limits never auto-retry and offer no Retry; ordinary throttling remains distinct. Unknown reset time is omitted. | [Brain dock errors](../brain-dock.md#phase-4--provider-errors-and-retry) | BC14 | Implemented source; recorded-payload and mock evidence; live acceptance pending. |
| R09 | Canvas body drag | Item body press -> select under 4 px movement or drag -> double-click main action | Image/video/audio/link/file/note bodies drag except real inner controls; double-click opens lightbox/link/file or note editor; Esc restores origin without opening | [Canvas references](../canvas-references.md) | RR13 | implementation in progress; not yet run |
| R10 | Frame background drag | Frame title tab or empty background -> move frame; child body -> move child only | Preserve frame-local child geometry and selection; inner controls do not drag; Esc restores captured frame/child origin | [Canvas references](../canvas-references.md) | RR14 | implementation in progress; not yet run |
| R11 | Shift marquee and selection | Shift+drag anywhere including frame background -> marquee; Shift+click -> add selection | Shift marquee wins over frame/body dragging; retain additive selection; cancel cleanly without moving or opening content | [Canvas references](../canvas-references.md) | RR15 | implementation in progress; not yet run |
| R12 | Keep / Not this feedback | Hover/select item -> Keep or Not this toggle -> repeat to clear | Verdicts are mutually exclusive and persist; reject dims to 45% with Not this tag; keep shows check badge; failure preserves truthful prior state; agents cannot write human verdicts | [Canvas references](../canvas-references.md) | RR16 | implementation in progress; not yet run |
| R13 | Link to… target picker | Selected items or frame -> Link to… -> search key/title -> target -> link | Recent targets first, grouped Epics/Stories/Tasks; preserve exact project/selection across async work; link frame current/future children; cancel adds nothing; unlink never deletes content | [Canvas references](../canvas-references.md) | RR17 | implementation in progress; not yet run |
| R14 | Drawer Add ▾ menu | Task/story/epic References header -> Add ▾ -> choose source | Same component exposes From canvas…, Pick on canvas, Upload file, Add link, New note; child Cancel/Escape returns correct layer; drawer/project changes cannot retarget intent | [Canvas references](../canvas-references.md) | RR18 | implementation in progress; not yet run |
| R15 | From canvas… | Drawer Add ▾ -> From canvas… -> Frames/Items tabs -> search/multi-select -> Link N | Frames show 2×2 first-image mosaic; selected count and exact target stay captured; cancel/no matches/read failure are distinct; uncertain mutation is reconciled before retry | [Canvas references](../canvas-references.md) | RR19 | implementation in progress; not yet run |
| R16 | Pick on canvas | Drawer Add ▾ -> Pick on canvas -> pick-mode banner -> select items/frame -> Link N or Cancel -> drawer | Banner names exact target key; return to originating drawer; Cancel links nothing; stale/deleted/project-changed target refuses mutation and retains recoverable selection | [Canvas references](../canvas-references.md) | RR20 | implementation in progress; not yet run |
| R17 | Upload reference from drawer | Drawer Add ▾ -> Upload file -> native picker -> create reference and link | Picker cancel creates nothing; validate readable file and captured target/project; distinguish confirmed creation from failed/uncertain linking; no blind duplicate-create retry | [Canvas references](../canvas-references.md) | RR21 | implementation in progress; not yet run |
| R18 | Add link from drawer | Drawer Add ▾ -> Add link -> URL/title -> create and link | Validate URL without fetching a remote preview; preserve draft on failure; captured task/story/epic target; cancel creates nothing; reconcile uncertain creation/link separately | [Canvas references](../canvas-references.md) | RR22 | implementation in progress; not yet run |
| R19 | New note from drawer | Drawer Add ▾ -> New note -> write -> create and link | Retain note content and captured target; cancel/blank new draft creates nothing; distinguish create success from link failure; preserve existing direct-note draft/uncertain-write guards | [Canvas references](../canvas-references.md) | RR23 | implementation in progress; not yet run |
| R20 | Drag references to drawer | Canvas item or frame -> open drawer References section -> drop | Highlight valid section during drag; clear on leave/drop/cancel; link exact target, preserve content; invalid/foreign/stale target refuses; uncertain response requires reread | [Canvas references](../canvas-references.md) | RR24 | implementation in progress; not yet run |
| R21 | Linked frame cards | Drawer References -> linked frames first -> Open on canvas or Remove link | Show mosaic/title/item count then direct/via-frame items; navigate correct frame; Remove link only unlinks; other inherited paths can still expose items; handle empty/archived/failed reads | [Canvas references](../canvas-references.md) | RR25 | implementation in progress; not yet run |
| R22 | Frame target chips | Frame title tab -> linked target chip -> target drawer; show up to two chips then +N count | Show exact linked targets without making chips drag handles; open correct epic/story/task; account for removed/archived/project-changed targets without retargeting | [Canvas references](../canvas-references.md) | RR26 | implementation in progress; not yet run |
| R23 | Archive and undo feedback | Selected canvas item -> delete/archive -> Undo -> restored item | Deletion soft-archives rather than hard-deletes; record human attribution for agent feedback; Undo restores record/geometry and clears archive attribution; uncertain result is reconciled | [Canvas references](../canvas-references.md) | RR27 | implementation in progress; not yet run |
| R24 | Sticky note feedback placement | Move sticky note over reference -> release -> agent reads attachedTo | Compute world coordinates with frame offsets; centre inside or overlap >=30% of note area attaches feedback; no extra relation UI; moving away removes computed relation | [Canvas references](../canvas-references.md) | RR28 | implementation in progress; not yet run |

## Alpha42 release repair: H-D01 / H-B01 / H-R04 / H-R05

A loading task/story drawer closes its route immediately on Escape, backdrop or
Close, so resolution of the lazy module cannot replace a closing shell and reopen
it. Loaded editors retain animated exit and dirty/pending guards. Image bodies
keep canvas dragging and double-click preview, with a focusable Enter/Space
preview action. Resting note Edit is a keyboard-revealed control; pointer editing
uses the note's double-click or Actions menu. Presence may fit whole words with
an ellipsis; its tooltip retains the full live text. Evidence is recorded in the
[alpha42 verification](../verification/0.3.0-alpha.42.md).
