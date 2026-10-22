# Behavioral and visual acceptance matrix

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
| RF03 | H-R01/R04: Add note → inline title/body → save/cancel | Immediate edit, intentional empty/cancel policy, one create/write; failed/ambiguous save preserves draft and reconciles | Typing/selection/scroll doesn't pan/zoom/drag canvas; no guessing double click |
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
