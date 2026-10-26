# Behavioral and visual acceptance matrix

Alpha.42 H-T01 / VS02 follow-up: status filtering must retain the same filter
geometry when bold emphasis changes. `e2e/polish.spec.ts` checks exact boxes;
the caption reserves both font weights. Windows Chrome/mock targeted check
passed; hosted CI and native acceptance remain separate gates. Other observed
release browser failures stay recorded in the version verification record.

[Index](README.md) · Human map IDs below use prefix **H-** (for example H-D11 refers to D11 in the human map); AG IDs refer to the agent map. Stable IDs are test contracts, not pass claims.

**Initial audit status, 2026-10-22:** all execution rows below are **NOT RUN by this documentation audit**. Alpha29 implementation/test files may exist; release owner records their actual terminal results separately with exact version. Source inspection verifies inventory/causes, not native interaction quality.

## Human outcomes and regressions

| ID | Path / setup → action | Required functional outcome | Required visual / usability evidence |
|---|---|---|---|
| HF01 | H-D01/D03: existing task → edit Description → save → reopen | `descriptionMd` persists; title, brief, reports and comments unchanged except intended edit | Description and real Comments discoverable without expanding Agent plan; both themes |
| HF02 | H-D02: expand Agent plan → edit structured field → collapse/reopen | List edits stay unsaved/mounted; Markdown blur retains its established save behavior but task technical autosave excludes unrelated human fields; errors remain visible while collapsed | Disclosure clearly named; summary legible; no hidden-field validation dead end |
| HF03 | H-P04: Story Description edit → navigate away/back → save | Uses `outcomeMd`; scoped in-session draft retained; no duplicate description/comments schema | Main description readable; secondary acceptance remains reachable and editable |
| HF04 | H-D03: comment draft → failed send / pending repeated Enter → route return | Draft retained; single pending send; uncertain results not replayed; switching tasks/projects never crosses drafts | Error near composer, pending state visible; report/results remain accessible |
| HF05 | Task/story edit → background refresh failure/recovery and concurrent agent update | Draft/focus preserved; stale evidence never silently overwritten | Refresh warning not disguised as empty view; no scroll jump |
| HF06 | Dirty description/technical edit → Escape/Back/project navigation | Existing discard/save contract preserved; read-only archived state enforced | No hidden footer or accidental focus behind dialog |
| RF01 | H-R01: truly empty → create only frame → archive last content | Empty illustration disappears after frame; returns only for genuine empty active canvas | No chibi covering frame; filtered state distinguishable |
| RF02 | H-R02: frame + child node → grip move/resize/collapse/edit/archive/undo | Parent and child positions correct; controls don't start drag; undo scoped | Visible grip at 39/40/75/100% canvas zoom; target size and focus measured |
| RF03 | H-R01/R04: Add note → place paper → direct writing → autosave → reopen | New blank stays local; body-only/heading-only/literal Note/cleared existing round-trip; one flight, newer typing retained, uncertain creation never replayed; guarded updates refuse remote change | Actual paper, no creation-form chrome or required heading; typing/selection/scroll does not pan/drag; visible truthful outcome |
| RF04 | H-R03/R06: reference menu → edit/link dropdown; edge label → failed submit | Correct reference/edge changed once, error in active layer, retained draft | Dropdown/field/footer remain reachable at lower viewport edge |
| NT01 | H-G03 bell → history → View → back; project switches during event delivery | Declared retention/unread policy, deduplication, exact project/entity destination; stale/deleted target explained | Keyboard open/close, empty/long/error history, timestamp/context, no focus theft on arrival |
| KB01 | H-D11: task → Add reference picker → New link/note dialog → cancel each layer | Escape removes only top layer; parent state retained; focus returns one layer at a time | Visible focus, background inert; no clipped child overlay |
| KB02 | H-B02: task Status save relocates card → close → Enter | Focus replacement same-task card or stable Board fallback; no later refetch focus theft | Light/dark active-vs-selected dropdown highlight |
| KB03 | H-D04/D01: actions menu / custom select / native date picker → Escape | Each surface follows its correct top-layer contract; native picker not assumed same as DOM popup | Native package evidence for native picker; pointer and keyboard separately |
| AS01 | Any write dialog → double click/Enter → pending → dismiss/reopen → late result | One mutation; old result cannot close/reset new editor; already-dispatched result not falsely cancelled | Pending notice focus and disabled controls; recovery error visible inside active surface |
| AS02 | Any data view → initial fail → retry; cached-data refresh fail; no matches | Distinguish loading/error/empty/filter/no permission; preserve existing draft/content on background failure | Clear next action, consistent form rhythm during notices |
| AS03 | Paste/file preparation/dialog save → A→B and A→B→A before/after dispatch | Captured project and selection generation; no new-project write/view/focus pollution; unconfirmed outcomes read-reconciled | Accurate origin-context receipt; no misleading rollback/automatic replay |
| RV01 | H-D09: long report → Request changes → nested criteria → comments → stale evidence reread | Captured evidence/criteria correct; text and test choices retained; outdated tests reconciled | “Go to comments” and return reveal target; no below-fold hidden error |
| RV02 | H-D06/D07/D08: stale conflict/readiness/release decision | Reread and deliberate decision required; generation/revision preserved; no unrelated mutation | Changes/consequences understandable without technical guesswork |
| VS01 | All dialogs, especially reference plain forms and nested picker | Correct labels/error associations and actionable controls remain functional | Heading/body/field/error/footer spacing, no overlap; long titles/URLs, 20+ options, 30+ tests |
| VS02 | Ordinary pages/forms at 1440×900,1180×720,800×600; short height; text zoom | All required actions reachable; no lost content under footer | Light/dark, 200% text smoke; 320 CSS-pixel-equivalent reflow for ordinary content separately; no certification inferred |
| VS03 | Canvas at 39/40/75/99/100/125/200/400%; DPR/OS scale 1/1.25/1.5/2 | Pointer targets/coordinates, inline edits, fit/zoom and image loading remain correct | Distinguish DOM text/card sharpness, media resolution and intentional raster overview; settled screenshots + gesture responsiveness |
| VS04 | New agent event while human types/reads/scrolled into drawer | No draft reset, false working state or focus/scroll theft | Agent ring/status remain honest and readable; reduced motion works |

## Agent/human lifecycle scenarios

| ID | Sequence | Observable acceptance (functional, not a hash) |
|---|---|---|
| AC01 | AG01 wrong project → verified exact project → read | Wrong binding fails before scoped content; desktop switch does not retarget session |
| AC02 | AG02 same scope Refine twice → copy failure | Stable prompt explains current retrieval; no launch/write; selectable text survives clipboard failure |
| AC03 | AG03 human correction → agent brief/story update | Intended fields reconciled; omitted fields preserved; whole-list replacement understood; no role takeover |
| AC04 | AG04 board question → human answer → agent wait/read | Question ID and persisted answer match scope; ordinary answer creates no execution grant; chat-only question not counted as Inbox event |
| AC05 | AG05 complete brief Ready under paused scope → attempted claim | Readiness can pass; execution_required prevents work; task/history unchanged by refusal |
| AC06 | AG06 typed request → stale revision / decline / approve | Only exact fresh human approval starts scope; no MCP approval tool; no OS process launched |
| AC07 | AG07 permitted worker claim → simultaneous competitor | One accepted holder/generation and expected status; loser cannot report under old claim |
| AC08 | AG08 report → changed acceptance → review reread → changes/accept | Stale review refused unchanged; exact evidence retained across rounds; tests actual/NOT_RUN honest |
| AC09 | AG09 Pause during live work → report / release → next-round claim | In-flight report/release allowed by contract; new work blocked; Pause/Release never promise external process stop |
| AC10 | AG10 reconnect with checkpoint → bounded events incl relevant filters | No checkpoint reset/lost unprocessed events; cursor advanced only after handling; no endless unauthorized wait |
| AC11 | AG11 replacement brain read-only recovery | Includes relevant Done/archive reports, rejected rounds and answered questions; tails/resource omissions disclosed; no appointment/claim mutation |
| AC12 | AG12 references across project/frame/file cases | Same-project binding enforced; no implicit preview network fetch/file copy; unreadable input produces useful failure |
| AC13 | AG02 new/refined task → human reads Description | Concise user-language outcome in an empty description; existing wishes preserved, technical detail secondary; prompt strings alone do not establish model compliance |
| AC14 | AG14 read canvas -> create epic frame -> connect notes -> arrange grid -> reread/archive -> foreign-ID and failed-batch recovery | Seven tools use pinned project/actor/activity. Directed duplicates/self-edges fail. Grid fits without overlaps or touching unselected occupants; insufficient space or invalid/foreign IDs roll back the entire batch. World/frame-local conversion, archive defaults, filters and explicit paging markers match the contract. `crates/jam-mcp/src/canvas_tests.rs` exercises dispatcher/core behavior; stdio smoke verifies transport. Desktop visual/live-human acceptance remains unrun. |

## Test mapping and evidence levels

Existing baseline locations to reuse: `apps/desktop/src/features/*test.tsx`, lazy route/modal/focus tests, `apps/desktop/e2e/{workflow,planning-drafts,execution,board,v21,v22,v23,v24b,v25}.spec.ts`, native command/core workflow tests under `crates/jam-core/tests` and `apps/desktop/src-tauri/tests`. These are candidate coverage locations, **not a statement each acceptance row is already asserted**.

Alpha29 candidate files: `apps/desktop/src/features/human-first-editors.test.tsx`, `apps/desktop/e2e/human-first.spec.ts`, updated planning-drafts/detail-read-recovery tests. Release owner must link individual test names to HF IDs and record actual results.

1. Core tests: domain state, permission/claim/revision checks, exact intended persisted side effects.
2. DOM/component tests: mounted drafts, keyboard/focus and error state logic. Cannot prove native pixels.
3. Browser functional tests: actual input/route transitions, computed geometry/style and screenshots on fixture. Mock transport cannot prove native persistence.
4. Exact native package: file/date pickers, clipboard/drop, platform rendering and OS scaling; compare persisted fixture state before/after.
5. Human task trial: can a person find/explain/complete the goal without coaching? Record hesitation, wrong turns, recovery and misunderstood terms, not just time or opinion.

## Result record (append per executed scenario)

```text
ID / exact source and package / date / platform:
Fixture and entry path / maximum depth:
Input method / viewport / OS scale / canvas zoom / theme:
Expected outcome:
Observed behavior and persisted side effects:
Focus before/after; scroll/spacing/readability observations:
Evidence: test name/path, screenshot(s), native fixture result:
PASS | FAIL | NOT RUN | BLOCKED:
Remaining limits / next action:
```

No blanket pass from building, checksums, a static screenshot or source inspection. Keep functional result separate from visual usability and from native/platform coverage. Re-run affected scenarios after subsequent source edits.

## Owner-reported alpha29 checkpoint

On 2026-10-22 the implementation owner reported 539 DOM checks green (30 new behavior probes), and four new browser scenarios added/typechecked but not run. This is a handoff report, not independently executed evidence by this audit and not a per-row PASS assignment. Link actual test names/results and the final source checkpoint before closing HF rows. All native/visual rows remain NOT RUN here.

### Alpha29 executed behavioral subset

The implementation owner ran the full 539-test DOM suite. New tests in
`features/human-first-editors.test.tsx` cover HF01–HF05 subsets: exact saved
Description/legacy field preservation, separate labelled goal context, mounted
technical drafts, existing Story field mapping and entity-scoped drafts, pending
comment single-flight, uncertain-response retention, A→B/ABA/unmount fencing,
Cyrillic comment preservation alongside an unsaved description, archived plan
reading, and active-work holder/lifecycle preservation with a stale-version
refusal. Eleven review-correction probes additionally cover technical-only autosave, unrelated and queued human drafts, explicit main Save from focused Goal, project/ABA/entity/unmount ownership, Story pending/error visibility, read-only recovery and newer Story typing during save. Existing draft/read-recovery tests were migrated to the visible labels
and explicit disclosure without dropping their failure and concurrency assertions.

These are behavior passes for the named probes, not a blanket HF01–HF06 visual
pass. `e2e/human-first.spec.ts` adds actual browser input/disclosure/persisted-state
and computed field-padding assertions; they are typechecked and listed but not
run at this source checkpoint. Native light/dark layout, Windows interaction and
human findability remain pending. See [alpha29 verification](../verification/0.3.0-alpha.29.md).

## Alpha30 canvas candidate

RF01/RF02: frame-only empty-art state, explicit grip, resize and child/blank-canvas
gestures. RF03: local note title/body → save/cancel/dirty-confirm/pending/uncertain
read-recovery; exact single create, scope/lifetime fencing, no replay. VS01: nested
reference dialog form spacing and draft confirmation focus. VS03: image dimensions
at fractional zoom × DPR and stale/failure paths. DOM/pure cases are recorded in
alpha30 verification; native geometry, both themes, 800×600/200% scaling and
500-card gesture/clarity checks remain unrun at this source checkpoint.

## Alpha31 candidate additions

AC02: both Refine modes, keyboard choice, scoped local request across Close/project return, copy failure/pending/scope changes, exact entity IDs, no board mutations. See `features/brain-handoff.test.tsx` and `e2e/refinement-modes.spec.ts` (browser/native not yet run). AC13: a newly agent-created task has a concise human-readable user-language description, existing human wishes preserved, technical detail secondary. This end-to-end/model behavior is NOT established by prompt-string tests.

## Alpha31 shared-overlay candidate

KB03/VS01/VS02: CustomSelect lower-edge placement intersects viewport/scroll clips,
chooses above/below and remains scrollable; Escape stays at popup depth before
closing the parent. `components/ui/select-placement.test.tsx` uses synthetic
geometry plus real DOM keyboard behavior; `e2e/overlay-placement.spec.ts` adds
real layout/both-theme checks (not yet run). Agent plan uses monochrome CSS ink;
archived help and singular counts do not imply edit permission.

## Alpha31 presence and history candidate

| ID | Sequence | Required functional result | Evidence boundary |
|---|---|---|---|
| CP01 | H-B01 / AG10: missing, expired, human or unavailable holder | Explicit quiet state, no invented actor/claim | Pure/DOM; native pending |
| CP02 | Review retaining worker; generic other-actor scoped status | Awaiting review, no old-worker animation; optional timestamped last report, no reviewer assertion | Pure/DOM; native pending |
| CP03 | Heartbeat-only update without domain event | One visible Root cadence refreshes member cache, not fake activity | QueryClient/fake timer; integrated/native pending |
| CP04 | Hidden/visible, pending ABA/unmount, newer identical same-ms data, removed/recreated query, errors | No old publication, one read, no overwritten newer observation, retained cache on failure | QueryClient regression; native pending |
| CP05 | Long status and reduced motion | Legible static text, no false activity animation | Final visual/native pending |

NT01 now exercises the persisted Project notifications dialog, bounded pagination,
newer-update reveal and explicit read watermark, exact View validation/question
focus, cancelled scopes and recoverable reads/navigation. Candidate independent
review closed latest/older overlap and suppressed navigation-failure feedback;
this does not establish toast delivery or human approval.

## Alpha32 visual/readability acceptance delta

H-B01 / AS02 / VS02: all five columns distinguish “No tasks yet” from filtered
“No matching tasks”; Quick create removes the empty hint. Confirm 14px text,
medium/semibold weight, long-card wrapping and zero claim/move/execution effects.
The dedicated Board DOM cases pass; narrow800×600 light/dark browser cases are
prepared/typechecked, NOT RUN until hosted execution. Token contrast calculations
exclude grain/compositing and do not establish rendered contrast certification.

H-R02 / RF02 / VS03: inspect new frame boundary/header in light and dark, selected
and unselected, at39/40/75/100% and fractional/high zoom. Verify one representation,
clear grouping, readable title, unobstructed children/pan, grip/resize/collapse,
and unchanged persisted reference content; source/style assertions are not pixels.

## Alpha33 hidden-interaction behavior delta

KB03 / AS01 / AS03: task actions first Escape retains outer drawer and opener;
archive double click dispatches once, blocks underlying Ctrl/Cmd+S and pending
navigation/dismissal. Member and edge forms retain text/focus after uncertainty;
project ABA/unmount/new editor fences prevent follow-up read/close contamination.
Actual-router tests cover all three forms without replacing useBlocker.

H-G01: deferred command import shows a named loading dialog; repeated shortcut plus
Escape cancels intent, late resolution stays closed, warm opening still works.
Rejected import is caught locally; re-entry remains honest cached failure with
Close/explicit Reload rather than automatic reload or fictitious Retry.

The hosted F07/F08 browser scenario checks full task invariance while pending, no
underlying update/claim/Start and one intentional archive. Existing archive/restore
scenario now confirms Unarchive explicitly, retaining its visibility/state checks.
Browser/native runtime evidence is separate from prepared/typechecked scenarios.

AS01 dispatch-stage refinement: archive/member/edge refuse a scheduled project
change before API dispatch with zero calls and precise not-sent feedback. A generic
post-dispatch rejection remains unconfirmed, including modeled persistence before
a lost response. Six pre-dispatch cases and retained post-dispatch regressions pass
in DOM; these are not native transport fault injections.

## Alpha34 answer-continuation delta

AC04 / AC10 / AS03: pending or failed answers do not create a saved receipt;
confirmed and reloaded Answered cards expose the same copy aid. Verify exact
project/question/scope IDs, omission of answer/chat text, current appointment and
phase instructions, clipboard failure/selectable fallback, repeated copy and
project ABA/unmount. Copy must not change task/assignment/permission or send a
message. Inspect the revealed preview at narrow width in light/dark; source or
prompt-string assertions do not establish actual agent compliance or visual ease.

## Alpha35 card-tooltip correction

H-B01 / CP01 / CP03 / CP05: keep the pointer stationary while an existing status becomes
fresh and then expires. The visible label and open tooltip must agree; keep the
same card focus/activation and remove the tooltip when the card disappears.
Longer live text must stay inside the viewport. Four new DOM probes and existing
activity tests pass (23 total); position tests use synthetic coordinates. Native
alpha34 established the old stale-open-title defect; exact alpha35 native closure
is pending, not inherited from those observations.

## Alpha35 explicit-read and compact-modal acceptance

AS02: type an answer, fail a background questions read, then explicitly refresh.
The exact input node/draft/focus must survive the background failure; pending
refresh coalesces repeated input, reports its actual read result and checked-at
time, and performs no answer/claim/Start mutation. The hosted browser case is
prepared/typechecked, NOT RUN; DOM regressions and read-scope fences are recorded
in the [feedback inventory](deltas/feedback35-inventory.md).

RF04 / KB03 / VS01: open Link reference's searchable select in the short modal;
actual options must be visible and hit-testable, with selected versus active state
unchanged until intentional choice. Test two Escapes, outside dismissal, newer
modal focus, scroll-out/resize, native support and throwing/unsupported fallback.
Seven new DOM cases plus eight existing placement cases pass; four browser cases
are prepared/typechecked, NOT RUN. Native34's clipped screenshot is red baseline,
not native35 closure. Preserve the separately passing native34 Task Status case.

H-R02 / RF02: narrow headers prioritize the full short title above always-visible
controls, including overview. Explicit Fit/F reserves painted expanded/collapsed
headers and measured tools, excluding hidden children. Stored camera on route
entry remains unchanged; at the minimum 10% zoom, impossible full bounds require
pan rather than a false all-content-visible claim. H-R03/RF04/KB03: reference
Actions Escape closes only that disclosure, outside pointer keeps the clicked
focus target, and a child dialog returns to the visible summary. Twenty-six focused
DOM/geometry cases pass; three browser scenarios are prepared/typechecked,
NOT RUN. Exact native title/control/hit-target inspection remains pending.

H-P01 / H-P03 / AS01: submit a planning field, leave while pending, then return
after confirmation. Newer text remains editable and a later intentional blur
saves it; unchanged confirmed text is clean and blur sends nothing. Unmounted
project ABA, replaced cache identity and real remote edits cannot authorize old
baseline updates. No departed success receipt, refetch or focus move is emitted.

## Alpha36 reference feedback spacing

VS01/RF03/RF02: after a real Refresh receipt, tools and filters must remain at least
8 px apart in both themes and at narrow widths. Repeat with a long read error,
retry to remove it, then Add Note: preserve the complete local editor and visible
controls below current overlay bounds. Verify filters do not pan the canvas and
empty overlay gaps do; keyboard activation and draft cancellation remain intact.
`reference-controls.spec.ts` contains four prepared browser cases, NOT RUN locally.
`control-layout.test.ts` and `refresh-surfaces.test.tsx` cover measurement and DOM
ownership only. Actual native36 spacing/hit-through must be checked separately.

## Alpha37 reference keyboard ownership

H-R03 / RF04 / KB03: retain Enter → Escape → focused summary → Space reopening,
then outside dismissal and exact dialog-opener return. The actual ReactFlow-hook
DOM regression proves default-not-prevented and unchanged canvas Space handling,
not browser-native disclosure activation. Hosted rerun is required. RF02 retains
all original geometry/hit-test/state assertions after explicit lazy-route readiness.

## Alpha38 direct-note acceptance additions (not blanket PASS)

RF03/H-R01/R04: exercise body-only create → finish → reload/reopen with no heading;
heading-only paper; literal `Note` heading; remove a heading; deliberately clear
an existing paper; old default-heading notes. Verify stored/exported/imported
content, not only a temporary hidden heading. New blank placement/cancel must
produce zero records/events. Auto-save during newer typing must not replace the
new text on acknowledgement. Lost response after create must not replay.

AC12/AG12: two real Store connections competing from the same inspected content
must produce one winner and one conflict without a losing activity event. Verify
unrelated geometry/tags survive content writes, archived records refuse edits,
and old successful callers remain compatible. Shared heading-only acceptance is
additive and must be documented; no MCP schema or global revision claim.

VS01/VS03: actual browser screenshots must show the placed, optional-heading and
reopened paper in both themes after real typing/autosave. The upload allowlist is
only named synthetic PNGs. These are hosted-browser observations when executed,
not native/Windows evidence; prepared tests and builds cannot establish appearance.

RF04/KB03: retain the original caption-dialog Escape→exact Actions summary focus
assertion using a non-note reference, alongside direct-note editing and Tags/Link
dialog return. Actual-dialog/router DOM checks cover all three modal modes; the
hosted regression remains required. Generic Dialog-only fixtures missed React
child autofocus replacing the captured opener, so they are not sufficient here.

## Alpha39 own-save observation regression

RF03/H-R04: a geometry/selection clone of the unchanged previous query row after
our save must not lock the reopened editor as a remote conflict. Body/heading
values and exact editor close/reopen are asserted. Different text with the same
update marker, and reverting old text with a new marker, still stop saving and
retain the draft. Three new DOM regressions pass; the original hosted96-case
suite and six sticky PNG states must rerun unchanged. Alpha38 body-only PNGs are
partial visual evidence, not successful heading/reopen or native acceptance.

## Alpha40 source and behavior requirements

AS02/H-H01: loading/error must not claim empty or completed history; older-page
retry preserves its cursor and loaded rows, and cannot auto-loop while errored.
H-T01 distinguishes genuine empty display from filter mismatch. H-M02 missing
status text never proves online/ready. H-G03 mark-read wording includes older
updates. Existing uncertainty and not-sent tests retain their write-count/draft
assertions with clearer copy.

VS01/VS02/H-P08: short authority bullets wrap at800browserpx in both themes,
13px helper text remains readable; opening guidance grants nothing. H-B01 motion
requires an actual pointer pickup, computed transform and cancellation with zero
move calls. Reduced-motion transform is identity; existing real move/CAS tests
remain. Static PNGs alone cannot prove animation or permission behavior.

Alpha40 terminal evidence: exact public runtime `e7c37260` passed all 103 hosted
browser scenarios, including the requirements immediately above. All 12 synthetic
paper/pickup/guidance PNGs were inspected. This is bounded Chromium behavior and
rendering evidence, not all-family native or accessibility certification; see
[the exact record](../verification/0.3.0-alpha.40.md#terminal-hosted-and-rendered-result--2026-10-22).

## Alpha41 scenarios

- AS41-1: review bundled skill target, cancel, confirm, pending double-click, verify;
  modified/foreign content refusal retains bytes, app-owned upgrade retains backup.
- AS41-2: connection prompt for already connected/missing MCP/wrong project/restart;
  no token disclosure or automatic brain appointment/start.
- AS41-3: project folder save/reload/clear/isolation and stale project rejection.
- AS41-4: actual shipped example over disposable stdio: fresh bootstrap, plan,
  paused claim rejection, human fixture approval, claim, report, self/stale review
  rejection and exact acceptance. This is protocol evidence, not live-model UX.

Execution evidence belongs in the alpha41 verification record.

## Brain-dock increment acceptance (current source; browser/native QA pending)

This section extends existing BC01-BC04; their IDs retain their backend boundaries.
UX01-UX09 cover changed board entry points. The table is an acceptance plan, not
a test execution report. Available test files and earlier engineering checks do
not turn these rows into browser/native or live-provider passes.

| ID | Sequence / human paths | Required functional assertions | Required visual states | Result |
|---|---|---|---|---|
| UX01 | H-I01/I02: open/resolved Questions -> Refresh/answer -> Start request | Questions heading, Refresh and receipt share one row; Start requests remain in the same content column; pending/stale/failure retains correct scope and input; receipt is not process launch | Narrow/wide, long heading/receipt, empty/loading/error and pending approval; aligned content and no overlapping actions | Not yet run (browser/native). |
| UX02 | H-D01/D08: task drawer -> compact permission/claim -> Why? -> Release | Breadcrumb/title precede controls; one Why? reveals both original explanations; pending/stale/dirty release keeps its original version/claim semantics and never stops a process | Long title/breadcrumb, both explanations open, dock visible, narrow width, pending/error; no controls displace the title | Not yet run (browser/native). |
| UX03 | H-P07: heading Refine with brain -> dialog -> Open in brain chat / Copy prompt | Primary action stages captured scoped prompt and scope chip in composer, then closes dialog; does not send, start session, appoint or grant Start; secondary copy and failure recovery preserved | Heading action bounds, selectable long prompt, setup/continue modes, unsaved warning, compose/copy error; keyboard focus after close | Not yet run (browser/native). |
| UX04 | H-R01/G02: Note · N / Add / N / empty New note / empty-pane double-click | Primary Note and ghost Add (File/Link/Note) are distinct; N ignores editable/dialog targets; placement preserves pointer coordinates; double-click focuses local paper at pointer and blank paper creates no record | Toolbar hierarchy/chevron, open Add menu, placement cursor, empty and filtered board, focused blank paper at readable/overview zoom | Not yet run (browser/native). |
| UX05 | H-R04/R07: resting note -> keyboard/menu/double-click edit -> finish | Simplified resting labels and no note resize grip; existing heading/body autosave/conflict/uncertain-write guards retained; double-click a node edits without also creating paper | Resting/selected/editing/hover/focus with softer visible focus; no grip; typing/selection at low and readable zoom, long body and both themes | Not yet run (browser/native). |
| UX06 | H-R03: Create task from note… -> edit prefill -> Cancel/create -> link failure/retry | Cancel causes zero mutations; editable title/description/story prefill; confirmed create then link; link failure names created key; Retry linking note repeats only linking; unknown create outcome requires read/reconcile; project change cannot retarget | Prefill and story picker, create/link pending, created-key failure, link-only retry/Close and unconfirmed-create warning fit dialog and preserve readable note context | Not yet run (browser/native). |
| UX07 | H-I01/P06: saved answer -> Continue in brain chat / copy | Primary continuation stages saved answer and exact scope chip; secondary copy stays available; neither action auto-sends, wakes a model turn or grants Start | Resolved/open answer states, long text, primary/secondary order, copied/error receipt and resulting composer chip visible | Not yet run (browser/native). |
| UX08 | H-R01/R03/R07: select notes -> canvas chips -> Ask brain -> deselect/unmount | Publish canvas context only for current selection/project; deselection/unmount clears publication; note menu stages one reference; toolbar Ask brain (N) appears for 2+ selected with correct count; compose sends nothing | Single/multiple/cleared selection, low zoom, removable chips and long labels; no stale old-project context in composer | Not yet run (browser/native). |
| UX09 | H-S01/S02: Settings Agents -> Brain dock -> External agents (MCP) | Brain dock section first; all older external MCP setup, token/help and bundled skill controls grouped inside one initially collapsed disclosure; open state remembered per session; nested guards unchanged | Collapsed/expanded disclosure, long setup snippets, token masked/revealed state and installer nested pending/error at narrow width | Not yet run (browser/native). |

| ID | Sequence / human paths | Required functional assertions | Required visual states | Evidence boundary | Result |
|---|---|---|---|---|---|
| BC01 | H-BD01: Chat/Terminal session picker -> New/profile -> start -> Stop/Connections | Profile edit/hide/non-secret persistence and credential isSet preserved; Ready starts explicitly, Add key/Choose a model opens relevant editor; unavailable/starting/error blocks duplicate start; session switching preserves scoped drafts/history | Empty/loading/profile-list failure, long names, Ready/Add key/model/unavailable labels; open picker/actions menu and pending/error fit panel | profiles/session Rust tests and BrainDock DOM candidates; source inspection only in this pass | Not yet run for this increment. |
| BC02 | H-BD02: prompt -> ACP/API turn -> permission -> resolve/cancel/Stop turn | Visible first-prompt context; offered options only; pending until explicit resolve/cancel; resolved decision collapses; stop cancels pending permissions; plan and turn-end state truthful; tool permission is not Start | Context chip open/closed, pending/allowed/rejected/cancelled decision, plan/status/error and Stop with multiline transcript | Fake ACP and DOM candidates; real provider/rendered flow not yet run | Not yet run for this increment. |
| BC03 | H-BD03: terminal start -> input/resize -> remount -> Stop/Restart/app exit | PTY I/O and recent snapshot survive remount; resizer calls correct session; xterm keeps Ctrl+J; explicit Stop/restart owns process lifecycle, separate from board Pause/Release; test startup interruption and descendants | Terminal focus, long output, window/dock fit, stopped/crash/restart states and readable scrollback | Native ConPTY/process candidates; packaged-app process cleanup not yet run | Not yet run for this increment. |
| BC04 | H-BD01-08: actual adapters/providers -> native Tauri/webview -> packaged app | Exercise login, real OS credential round trip, provider tools/streaming, sidecar binding and cleanup; do not equate fake/mock/CI tests to live-model success; codex-acp has never been probed on this machine | Actual open chat/terminal/editor/permission/auth/error surfaces; both themes, DPI and overlay/docked layouts | Real adapters/providers not exercised in CI; live/native integration not yet run | Not yet run for this increment. |
| BC05 | H-BD04: Brain / Ctrl+J -> resize -> tabs -> close/backdrop/Escape | Toggle works inside inputs, excluded in xterm; drag/arrows/Home/End stay 340-720 px and persist width; >=1100 px dock pushes workspace, smaller overlays; child Escape first; close leaves session running | Working/permission/error dots, 1099/1100 px, min/max width, task drawer beside dock, backdrop focus and reduced motion | BrainDock/brain-layout DOM candidates; browser/native geometry not yet run | Not yet run for this increment. |
| BC06 | H-BD05: transcript -> thought/tool disclosure -> task/epic/story chips -> scroll away -> Jump to latest | Collapse/expand reported thought and tool output with board chips; exact board navigation; plan/turn events visible; streaming pins only at latest; Jump explicitly restores latest; replay deduplicates per-session seq | Expanded long thoughts/tools/Markdown; chip focus, scrolled position/new-stream notice and jump control; no forced scroll while inspecting history | BrainChat/store DOM candidates; browser/native readability not yet run | Not yet run for this increment. |
| BC07 | H-BD06: compose -> context removal -> @ / commands / Mode/Model -> send/Stop | Automatic view and published chips removable; mentions attach exact board item; slash/config use advertised values; Enter sends, Shift+Enter newline, IME Enter never sends; useBrainDock().compose stages without sending; project/session drafts isolated | Growing composer, empty/long mention/command/config pickers, Escape/focus, pending/error and Stop; long removable chips fit | BrainDock/store DOM candidates; browser/native IME and focus not yet run | Not yet run for this increment. |
| BC08 | H-BD07: Connections list -> API key/Model/Endpoint -> Advanced -> Save/remove | Agents vs API groups; API key first, required API Model and z.ai Coding Plan endpoint hint; Advanced non-secret command/args/env; single Save; boolean stored-key status only; partial profile/key-save failure disclosed; remove errors retain truthful state | Key blank/set/masked, model/endpoint validation, Advanced open/closed, grouped lists, saving/removal/partial failure at narrow width | Profiles/connection DOM and Rust candidates; real credential-store round trip not yet run | Not yet run for this increment. |
| BC09 | H-BD08: auth required -> API key / CLI sign-in -> recovery | API connections show primary Add API key; Claude Code/Codex show Sign in with the CLI plus Use an API key; open matching terminal/editor; explicit Restart/Connections recovery; no secret echo, automatic send or Start grant | Provider-appropriate action order, auth required/unknown/error, missing executable, failed restart and editor focus | Auth/BrainDock DOM candidates; real CLI sign-in/provider auth not yet run | Not yet run for this increment. |
| BC10 | AG15/AG16: built-in API chat -> read/write tool -> allow/reject -> new session | Only jam-board MCP is available; explicitly read-only tools run automatically; writes/unknown annotations ask; Allow once or Always allow this tool for this session only; reject/cancel does not call tool; core Start/claim validators still apply | Automatic read vs pending write card, resolved/cancelled/error output and next-session permission reset; model/endpoint failure remains actionable | crates/jam-agents/src/api_tests.rs candidate; live providers not yet run | Not yet run for this increment. |
| BC11 | AG16/AG17: project A session -> navigate B -> remount/close/reopen -> restart app | Session project/cwd/MCP env/name remain pinned; no A data/draft/context rendered as B; closing UI does not stop runtime; bounded transcript replay only within process; no resume after application restart | Project/session labels and context chip truthful; old-session errors, scratch-vs-folder hint and empty history after restart distinguishable | Wiring/session/store candidates; browser/native project-switch/restart not yet run | Not yet run for this increment. |

Candidate source/test routes: `apps/desktop/src/features/brain/{BrainDock,BrainTerminal}.test.tsx`,
`brain-layout.test.tsx`, `features/references/{note-entry,note-task}.test.tsx`,
`features/inbox/inbox-layout.test.tsx`, `features/task/task-hierarchy.test.tsx`,
`crates/jam-agents/src/{tests,auth_tests,api_tests,launcher_tests}.rs`. Mapping a
file names a coverage route; it does not claim every assertion is implemented or
executed. The only check run by this documentation pass is the interaction-map
validator, reported separately from application QA. No typography acceptance is
transferred from previous builds.


## Round 5 — pending human acceptance

RR01–RR28 correspond one-to-one to the appended human interaction rows.
Contract inventory and earlier Core/MCP tests do not establish browser/native
or human acceptance. All rows are **implementation in progress; not yet run**.
The shared hidden-surface gates in the human map apply to every row.

| ID | Sequence / human path | Required functional assertions | Required visual states | Evidence boundary | Result |
|---|---|---|---|---|---|
| RR01 | H-BD09: Header + or empty-state Start chat -> Connection, searchable Model (Recent/Starred/catalog), Effort -> Start | Remember choices per connection; first ACP start offers Agent default; revalidate cached choices after Ready; cancel/failure preserves intent and never sends or grants board Start | Open launcher, empty/loading/catalog error, unavailable choice, pending Start and narrow keyboard/focus states | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR02 | H-BD10: Composer chip -> searchable model list, effort segment and advertised model_config switches | Use agent-advertised options or API catalog/style; hide unsupported controls; retain combined model/effort options; apply next turn, show post-message divider; failures retain truthful selection | Long labels/tooltips, search/no match/Refresh/free-text ID, hidden effort, Fast mode, pending/error and focus return | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR03 | H-BD11: Composer shield chip -> offered access modes with descriptions -> select | Use known plain labels or agent-provided names/descriptions; unknown modes remain intact; Full auto gets danger tone; no API/terminal category invented; Access never grants board Start | Each offered mode, long descriptions, danger option, hidden category, pending/error and keyboard return | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR04 | H-BD12: Attach button -> native multi-select file dialog -> composer attachment chips -> remove | Cancel adds nothing; copy into pinned session storage; show progress and per-file/message refusals before Send (20 MB/file, 10 files, 50 MB/message); session change cannot retarget results | Native picker cancel/return, thumbnails/file pills, copying, missing/unreadable/oversize errors and remove focus | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR05 | H-BD13: Focused composer -> Ctrl+V image or files -> attachment chips | Preserve ordinary text paste; show copy progress/refusals before Send; late paste results stay with captured project/session; removing a chip does not send | Text/image/file paste, copying/error, mixed batch, long filenames and session-switch recovery | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR06 | H-BD14: Files dragged over dock -> Drop to attach overlay -> drop or leave | Overlay clears on leave/drop/cancel; enforce limits and runtime support before Send; terminal drops type quoted absolute paths rather than sending a chat turn | Dock/terminal target, overlay hit area, rejected/mixed files, leave/cancel and copying/error | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR07 | H-BD15: Canvas item or frame -> composer drop -> removable board_ref chip | Attach exact project/entity context instead of copying a file; preserve text draft; cancel or foreign/stale context cannot retarget or send | Item/frame drag, drop highlight, long/multiple chips, remove, cancelled/foreign drop and narrow composer | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR08 | H-BD16: Transcript image thumbnail -> lightbox or hover Add to canvas -> copied reference | Open image on click; Add to canvas explicitly creates a copied reference in the correct current project; pending/error stays visible; retry requires reconciliation, no automatic Send | Hover/focus action, lightbox, copy pending/error, project-change refusal and visible canvas result | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR09 | H-BD17: Composer mic -> off/not installed/downloading/warming up/ready/recording/transcribing/error | Click toggles recording; show live level/timer and download progress; prepare model when recording starts, not on hover; keep audio local, cap take at 120 seconds, insert text at caret without Send | Every mic state, permission refusal, cancel/error, multiline insertion, narrow composer and reduced motion | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR10 | H-BD18: Mic hover/focus -> Voice input popover -> status, on/off, primary action, Voice settings… | Opening popover does not load model; switch persists enabled state; Download/Start dictation matches readiness; disabling stops owned runtime; errors remain actionable | Off/not installed/ready/loading/error status, switch pending, keyboard reach, popover bounds and focus return | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR11 | H-BD19: Voice settings -> Enabled, Model, Install/Remove, Device, Language, Unload after | Expose Fast/Balanced/Best size/disk state; GPU only when available; install progress/cancel/resume/checksum evidence stays truthful; idle/unload/remove/disable preserve state and stop owned runtime | Missing/downloading/installed model, disk usage, CPU/GPU, language/unload choices, pending/cancel/failure and narrow Settings | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR12 | H-BD20: Composer focused -> Ctrl+Space start/stop -> Esc cancel | Shortcut acts only in composer scope; Esc cancels take at correct depth; no transcription or prompt sent after cancellation; text insertion never submits | Focused/unfocused composer, recording/transcribing, shortcut hint, Escape depth and IME/text retention | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR13 | H-R09: Item body press -> select under 4 px movement or drag -> double-click main action | Image/video/audio/link/file/note bodies drag except real inner controls; double-click opens lightbox/link/file or note editor; Esc restores origin without opening | Grab/grabbing cursor, selection threshold, all item kinds, editable note/media controls, low zoom and cancelled drag | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR14 | H-R10: Frame title tab or empty background -> move frame; child body -> move child only | Preserve frame-local child geometry and selection; inner controls do not drag; Esc restores captured frame/child origin | Title/background/child hit areas, collapsed frame, grab cursor, low zoom, cancellation and nested controls | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR15 | H-R11: Shift+drag anywhere including frame background -> marquee; Shift+click -> add selection | Shift marquee wins over frame/body dragging; retain additive selection; cancel cleanly without moving or opening content | Overlapping items/frames, empty background, mixed selection, low zoom, Esc and visible marquee bounds | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR16 | H-R12: Hover/select item -> Keep or Not this toggle -> repeat to clear | Verdicts are mutually exclusive and persist; reject dims to 45% with Not this tag; keep shows check badge; failure preserves truthful prior state; agents cannot write human verdicts | Hover/focus/selected toolbar, keep/reject/neutral, pending/error, both themes and readable low zoom | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR17 | H-R13: Selected items or frame -> Link to… -> search key/title -> target -> link | Recent targets first, grouped Epics/Stories/Tasks; preserve exact project/selection across async work; link frame current/future children; cancel adds nothing; unlink never deletes content | Search/empty/error, grouped targets, long labels, multi-selection, pending/stale failure and keyboard return | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR18 | H-R14: Task/story/epic References header -> Add ▾ -> choose source | Same component exposes From canvas…, Pick on canvas, Upload file, Add link, New note; child Cancel/Escape returns correct layer; drawer/project changes cannot retarget intent | All five entries, menu anchoring, focus/Escape depth, narrow drawer beside dock and pending disabled states | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR19 | H-R15: Drawer Add ▾ -> From canvas… -> Frames/Items tabs -> search/multi-select -> Link N | Frames show 2×2 first-image mosaic; selected count and exact target stay captured; cancel/no matches/read failure are distinct; uncertain mutation is reconciled before retry | Both tabs, thumbnails/mosaics, empty/search/error, multi-selection count, pending/error and dialog focus | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR20 | H-R16: Drawer Add ▾ -> Pick on canvas -> pick-mode banner -> select items/frame -> Link N or Cancel -> drawer | Banner names exact target key; return to originating drawer; Cancel links nothing; stale/deleted/project-changed target refuses mutation and retains recoverable selection | Banner count/key, item/frame/multi-selection, cancel/return, pending/stale error and keyboard focus | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR21 | H-R17: Drawer Add ▾ -> Upload file -> native picker -> create reference and link | Picker cancel creates nothing; validate readable file and captured target/project; distinguish confirmed creation from failed/uncertain linking; no blind duplicate-create retry | Native picker return/cancel, missing/unreadable file, creating/linking/error, long filename and target receipt | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR22 | H-R18: Drawer Add ▾ -> Add link -> URL/title -> create and link | Validate URL without fetching a remote preview; preserve draft on failure; captured task/story/epic target; cancel creates nothing; reconcile uncertain creation/link separately | Validation, long URL/title, pending/error, retained draft and child-dialog focus return | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR23 | H-R19: Drawer Add ▾ -> New note -> write -> create and link | Retain note content and captured target; cancel/blank new draft creates nothing; distinguish create success from link failure; preserve existing direct-note draft/uncertain-write guards | Blank/body/heading note, pending/error, retained text, created-but-unlinked recovery and narrow editor | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR24 | H-R20: Canvas item or frame -> open drawer References section -> drop | Highlight valid section during drag; clear on leave/drop/cancel; link exact target, preserve content; invalid/foreign/stale target refuses; uncertain response requires reread | Item/frame, valid/invalid drop, highlight/leave/cancel, pending/error and drawer beside dock | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR25 | H-R21: Drawer References -> linked frames first -> Open on canvas or Remove link | Show mosaic/title/item count then direct/via-frame items; navigate correct frame; Remove link only unlinks; other inherited paths can still expose items; handle empty/archived/failed reads | Frame-first ordering, missing images/empty frame, long title/count, provenance, pending/error and navigation return | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR26 | H-R22: Frame title tab -> linked target chip -> target drawer; show up to two chips then +N count | Show exact linked targets without making chips drag handles; open correct epic/story/task; account for removed/archived/project-changed targets without retargeting | Zero/one/two/many chips, long labels, focus/tooltips, low zoom and stale target | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR27 | H-R23: Selected canvas item -> delete/archive -> Undo -> restored item | Deletion soft-archives rather than hard-deletes; record human attribution for agent feedback; Undo restores record/geometry and clears archive attribution; uncertain result is reconciled | Archive receipt, undo pending/error, restored verdict/position, multiple selection and project-change refusal | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
| RR28 | H-R24: Move sticky note over reference -> release -> agent reads attachedTo | Compute world coordinates with frame offsets; centre inside or overlap >=30% of note area attaches feedback; no extra relation UI; moving away removes computed relation | Overlapping note/item in different frames, exact/below threshold, no-overlap, readable note and zoom-independent placement | Contract inventory only; browser/native/human observations pending | implementation in progress; not yet run |
