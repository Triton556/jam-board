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
| RF03 | H-R01/R04: proposed Add note → inline title/body → save/cancel | Immediate edit, intentional empty/cancel policy, one create/write; failed/ambiguous save preserves draft and reconciles | Typing/selection/scroll doesn't pan/zoom/drag canvas; no guessing double click |
| RF04 | H-R03/R06: reference menu → edit/link dropdown; edge label → failed submit | Correct reference/edge changed once, error in active layer, retained draft | Dropdown/field/footer remain reachable at lower viewport edge |
| NT01 | H-G03 proposed bell → history → View → back; project switches during event delivery | Declared retention/unread policy, deduplication, exact project/entity destination; stale/deleted target explained | Keyboard open/close, empty/long/error history, timestamp/context, no focus theft on arrival |
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
