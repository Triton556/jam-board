# Known gaps and next work

[Index](README.md). Source baseline alpha28 `2b263795b31767da29db0b62dc81f4da19dfc4d1`; source inspection 2026-10-22. Priorities describe impact, not permission to mutate live user data. All runtime/native acceptance remains unexecuted by this documentation audit.

## Status ledger

| Work | Status on 2026-10-22 | Completion evidence required |
|---|---|---|
| Human-first Task/Story | Alpha29 working-tree implementation present; final gates pending | HF01–HF06 functional + open-state visual evidence; preserve reports, readiness and drafts |
| Reference frame grip/empty state | Proposed; source causes identified | RF01, RF02 |
| Create/edit notes inline | Proposed; no new schema or implementation asserted | RF03 including create ambiguity and duplicate guard |
| Notification bell/history | Proposed | NT01 including retention, identity, accessible View and stale destination |
| Hidden dialog spacing | Source mismatch identified; broader visual inspection pending | VS01 and H-D11 nested flow |
| Zoom/DPI polish | Separate implementation lane; no fix claimed here | VS02/VS03 native checks |
| Short routine refinement / brain handover | Documented proposal; current full prompt unchanged | AG02/AG11, no loss of binding/validator/bootstrap rules |
| Session message/tool streaming | Future, out of current implementation scope | Supported client transport, consent, scope identity, filtering/retention; never hidden reasoning |

## Concrete source findings


| ID | Priority / confidence | Concrete evidence | Targeted acceptance test |
|---|---|---|---|
| F01 | P1 confirmed source cause | `features/references/ReferencesPage.tsx:1177`: `!data?.items.length` gates empty illustration; frames ignored. | Empty canvas → add only frame → illustration gone; archive last frame → illustration returns only if no active content; verify archived records/filter state separately. |
| F02 | P1 confirmed affordance restriction | `ReferencesPage.tsx:442` dragHandle `.reference-frame-tab`; `Nodes.tsx:281+` tab controls are nodrag; `references.css:342–405` frame/outline pointer-events none, tab auto, overview tab opacity 0. | Drag obvious title/grip at 100%, 75%, 40%, 39% zoom; border vs interior behavior understandable; collapse/edit/archive never start drag; interior still allows node selection/pan. Resize remains reachable. |
| F03 | P1 confirmed mismatch | `ReferencesPage.tsx:1066,1213+`, `references/dialogs.tsx:8+` create note in AddReferenceDialog. `Nodes.tsx:226–279` inline body editing only, double-click/Enter. | Add note → immediate positioned editable card; title and body writable inline; one activation does not require guessing double-click; keyboard start/save/cancel; failed create/save retains text; no duplicate after repeated Add/Save. |
| F04 | P1 confirmed missing capability | `lib/ui-store.ts:10–20,112–173`: no durable history; last three toasts; five-second expiry; `lib/project-selection.ts` clears toasts. `app.tsx:734+` current View opens Inbox or Board task. | Bell → empty/recent/read states → View exact item; expired toast retained in history per declared retention; new event while panel open; long list; current project vs old project explicit. Do not merely preserve old task-key URLs across project switches. |
| F05 | P1 confirmed structural mismatch; visual effect needs render | `references/dialogs.tsx` plain forms; field wrappers nested inside form. `styles/v22.css:508` spacing applies only `.dialog > .field`; `styles/m5.css:57` `.m5-form` has grid gap 16px, absent here. `styles/app.css:1637` label gap separates label/input, not adjacent fields. | New frame, edit frame, add link, edit caption/tags/link: consistent heading→body→field→feedback→footer gaps, especially error and pending variants. Compare Asset/Member dialogs, not only screenshots of closed page. |
| F06 | P1 confirmed cognitive load | `task/TaskDrawer.tsx:675+` renders full BriefEditor then Notes, Rounds, assets, Comments. `task/BriefEditor.tsx:215+` exposes Goal/Context/Where/Changes/Tests/Boundaries/Result/User quotes. | Default task view exposes human description, comments, planning/regenerate entry; technical structure separately disclosed. Existing agent fields survive human edits exactly; readiness errors offer clear route into required detail. |
| F07 | P1 likely interaction gap, not executed | Task actions is local `menu` div in `TaskDrawer.tsx:430+`; `useModal` specially defers Escape only for open `.custom-select`. Reference native `<details>` menu also has no analogous integration. | Task → actions menu → Escape closes menu first rather than entire drawer; reference action details Escape/outside click contract explicit; focus returns to opener. Confirm baseline before repair. |
| F08 | P1 inconsistent pending protection, source verified | Task archive dialog at `TaskDrawer.tsx:926+` lacks `busy` and archive action pending disable. MemberDialog `TeamPage.tsx:50+` lacks busy; submit checks valid but not pending (button alone disables). Edge label `ReferencesPage.tsx:1290+` raw async submit lacks pending lock and reports through global error toast. | Double click/Enter, close during pending, then late failure: one mutation, accurate outcome, errors inside active surface, no stale close of newer editor. Treat lost response as unconfirmed, not auto-retry. |
| F09 | P2 structural clipping risk | `CustomSelect.tsx` renders absolute popup inline, not portal; `.dialog` overflow auto and viewport height cap (`app.css:1601+`); popup is top:100%, min-width 200px. | Open dropdown at bottom of tall modal, narrow window and 200% text: search and last option reachable without clipping/moving page unexpectedly; dropdown Escape followed by modal Escape; no horizontal overflow from long labels. |
| F10 | P2 native boundary unverified | `controls.tsx` DateTimeInput invokes native showPicker; useModal Escape special case knows CustomSelect only. Native datalist and file pickers add OS-level surfaces. | On exact Windows build, picker Escape cancels picker without discarding task; cancel file selection returns focus; native picker not claimed proven by DOM/browser mock. |
| F11 | P2 hidden loading gap | `command/CommandCenter.tsx:44+` lazy palette uses Suspense fallback null, unlike route/task LazyBoundary paths. | Cold Ctrl+K, repeated hotkey, chunk rejection and Escape while loading: visible acknowledgment/recoverability; no late unexpected popup after dismissal. |


## Decisions before the next feature

- Bell retention: session-only vs durable, maximum history, unread semantics, event deduplication and project scope must be explicit. Prefer project-local history initially unless cross-project navigation is deliberately designed; do not preserve unscoped old task keys.
- Inline notes: decide whether Add creates a persisted blank draft or a local draft. Current MCP note creation requires text. Specify cancel/empty-note cleanup and ambiguous create recovery before choosing an implementation.
- Frame interaction: visible grip/selection area should not steal child-node manipulation or interior canvas pan. Low zoom must not leave only invisible controls.
- Form spacing: adopt one reusable form rhythm, not isolated pixel patches; test field errors and nested dropdowns as well as default states.
- Human-first: technical plan is still editable and operationally authoritative; do not let hidden invalid fields silently disable Save without explanation.
- Refine: full setup vs explicit continuation is a future choice, not inferred from a prior copy click or online heartbeat. Board questions and client approval questions are different.
- Handover: role transfer is explicit and per epic; reading history alone does not take authority or reassign workers.

## Closing a gap

Keep its ID. Record exact changed version, linked acceptance IDs, test location, observed result and remaining platform limitations. Do not erase original failure attribution. Compilation, hashes, screenshots without interaction, or a mocked bridge alone cannot close a native usability gap.

## Zoom diagnostic handoff (source evidence, no runtime proof)

A separate read-only diagnostic found permanent `will-change: transform` on canvas layers (`references/references.css:13–22`), fixed max-512px WebP thumbnails used below zoom 1 (`references/Media.tsx`), and intentionally rasterized overview below 0.4 (`OverviewScene.tsx`). These are distinct possible causes: readable DOM blur, image resolution, and intentional overview approximation. Do not call all three one zoom bug. VS03 covers them separately. Candidate repairs remain owned by a later implementation lane, not this documentation change. The isolated cloud Chromium attempt failed before page load; no screenshot/native acceptance came from it. Do not retry by changing security settings.

## Alpha29 validation handoff (2026-10-22)

Implementation owner reports **539 DOM tests passed**, including 30 new behavior probes. Four new functional-browser scenarios were added/typechecked but **not executed** at this checkpoint. This documentation author did not rerun those tests; the release verification record must supply final source/version and exact terminal evidence. DOM success does not establish native pixel geometry, Windows GUI behavior or browser visual acceptance. These results apply to human-first Task/Story work, not proposed frames/notes/bell/zoom/prompt features.
