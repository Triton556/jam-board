# Round 6 W1 — References content culling

Date: 2026-10-26. Unreleased working tree on `feature/round-6`, baseline
`440200e`, package version `0.3.0-alpha.42`. This is a scoped change record,
not release or native acceptance. No version bump, commit or publication.

The person's goal is to pan and zoom a large ideas board without mounting every
card. Human paths H-R07/R11/R12/R20/R23 and H-BD15 retain their existing selection,
feedback, linking and draft semantics. AG12/AG14 data/authority are unchanged.

## Implementation

- Actual card content and edge paths cull outside the visible viewport plus one
  viewport on each side, at the current camera zoom. Backward/crossing edge
  bounds conservatively include Bezier control points.
- Lightweight Flow node/edge shells remain in the full model for keyboard focus,
  geometry, selection and minimap. Frames remain rendered. This is the equivalent
  content-culling strategy rather than React Flow's strict no-margin flag.
- Selected off-screen cards also cull; select-all cannot defeat culling. Only
  active note editors and dragged cards retain off-screen content. Pending note
  drafts retain their owning editor and DOM; other cards/edges still cull.
- Ctrl/Cmd+A selects non-hidden model nodes. Tab keeps model reading order and
  Flow's automatic focus pan; Enter reveals an off-screen selected note before
  opening its editor. Route focus still expands collapsed frames then fits the
  model target. Semantic `hidden` remains reserved for collapsed children/drafts.
- `window.__jamMock.seedBusyBoard()` replaces the disposable mock canvas with
  exactly 500 items, 50 frames and 200 edges, includes Keep/Not this states and
  starts at 100% zoom. Call before visiting `/references`, or Refresh references
  afterwards. Repeating it does not duplicate fixture assets. No native API or
  production user-data command is added.

## Verification

Terminal checks use the installed Node 24 runtime. The sandbox blocks Vite's
Windows `net use` child process and default Vitest fork workers; tests use a
scratch native-loader config with `resolve.preserveSymlinks: true`, thread pool
and one worker, retaining the normal 5-second per-test deadline.

- PASS: frontend and e2e TypeScript (`npm run typecheck`, `npm run typecheck:e2e`).
- PASS: production mock build using `trace-panzoom.cjs --build-only`, retaining
  the original release bundle budget and code-splitting configuration.
- PASS: complete References suite, **217/217 tests in 29 files**, including
  RC01 culling/minimap/retained editor, keyboard focus/model movement,
  marquee/cancel, grouped move/delete/verdict/link Undo/Redo, drawer/brain payloads,
  route focus, overview drawing and RC02 exact/repeated fixture checks.
  JSON evidence: `test-visuals/round6/w1/references-tests.json`.
- PASS: scoped Biome, 8 changed frontend files; interaction-map integrity,
  **4/4 Node tests** (`node --test --test-isolation=none
  scripts/check-interaction-map.test.mjs` on Node 24); `git diff --check`.
- PASS: Node syntax checks for `trace-panzoom.cjs` and `shoot.cjs`. Script syntax
  and successful production build do not establish browser behavior/performance.
- NOT RUN: headed browser, visual pop-in/focus inspection, native package,
  actual human observation and <=5 long-frame performance target. The round's
  sandbox instructions reserve browser execution for QA. No Rust files changed
  by W1, so no new Rust/Linux acceptance is claimed.

## QA execution

From repository root, using Node 24 (or Node 22 with `--experimental-strip-types`):

```powershell
node test-visuals/round6/w1/trace-panzoom.cjs
```

The script builds a production mock under its own scratch directory, serves
127.0.0.1:1420, opens headed installed Chrome at 1440x1100 / DPR 1, warms up,
then traces three 3-second pan/zoom runs. It verifies exact fixture counts and
that card content is actually culled, reports FPS / frame intervals >20 ms /
maximum interval, and saves per-run Chrome traces, `panzoom-results.json` and
`busy-board.png`. It exits nonzero if any run exceeds five long frames. Optional
`W1_CHROME_PATH`, `W1_PORT`, `W1_DPR` override the environment. Servers and browser
close in `finally`. Screenshots/traces are synthetic browser evidence only.

Inspect normal pan across overscan boundaries, keyboard focus of a far shell,
route focus of `perf-item-49`, both verdicts, overview/minimap and retained editor
states in both themes before marking visual acceptance. Native cross-surface
dragging remains a separate gate.

`test-visuals/round6/w1/shoot.cjs` additionally drives both themes on an already
served production mock (`W1_BASE_URL`, default 127.0.0.1:1420). It checks minimap
model counts, select-all with culled content, route focus and shell keyboard focus,
and saves busy/selection/far-focus/overview PNGs for actual inspection. NOT RUN here.
The temporary Vitest fallback config was removed after the terminal checks.

## Profile-driven stall repair

2026-10-26 follow-up; same unreleased branch and version. The earlier terminal
passes above do not establish performance acceptance. QA subsequently measured
**62–71 frames >20 ms per 3 seconds** on the busy board. Its instrumented frozen
production profile recorded 70/100 long intervals, 14.57 ms mean scripting and
8.58 ms mean main-thread Layerize. Source-mapped hot paths included selector
notifications, React DOM updates, Lucide icons and Tooltip. The dev profile found
all 50 frames rerendering per zoom update, with stable input arrays and no shell
mount churn. Evidence: `test-visuals/round6/qa-canvas/profile/report.md` and its
source-mapped top functions. Profiling overhead/dev times are not acceptance FPS.

Repairs, in requested order:

1. `ReferenceFrame` selects a primitive presentation-zoom bucket, using default
   equality to skip same-bucket zoom/pan. Existing memo and stable model/runtime
   props remain. Labels conservatively preserve a minimum screen size; Fit and
   collapsed bounds use the same quantized layout. Bucket crossings intentionally
   update headers, rather than changing header DOM/styles every frame.
2. Canvas controls use `data-tooltip` and one memoized delegate/portal, including
   toolbar icon controls, frame chips, verdicts, audio and note finish/Actions.
   Hover/focus delay, description ownership, cancellation, Escape/click and scope
   are tested. Drawer popovers retain the shared Tooltip path; the shared app
   Tooltip API is unchanged.
3. Markdown and its lazy content boundary are memoized by the text prop. A parse
   counter verifies no reparse on parent zoom updates and exactly one parse for
   changed text. This does not cache across deliberate content unmount/remount.
4. Far item shells, containing only hidden handle anchors, use
   `content-visibility: auto` and intrinsic dimensions. Live cards, menus and
   retained editors avoid paint containment/clipping. Shell rules explicitly
   remove will-change/filter/opacity stacking hints; overview hit areas and
   dormant handles no longer need opacity stacking. Keeping handle anchors also
   avoids removing Flow's DOM handle geometry when card content is culled.
5. Existing References regressions plus new render, tooltip, Markdown and shell
   policy tests are rerun; final results are recorded below.

Unit invocation counters (50 frames with one linked chip each, 20 note parents
deliberately subscribed to exact zoom; no StrictMode, timing or GPU claim):

| Stage | Zoom 1.00 -> 1.01: frames / shared Tooltips / Markdown | LOD boundary: frames / shared Tooltips / Markdown |
|---|---|---|
| Reproduced baseline | 50 / 250 / 20 | Not sampled in initial failing run |
| After frame buckets | 0 / 0 / 20 | 50 / 250 / 20 |
| After tooltip delegation | 0 / 0 / 20 | 50 / 0 / 20 |
| After Markdown memo and shell policy | 0 / 0 / 0 | 50 / 0 / 0 |

Pure pan is 0 / 0 / 0; `.61 -> .62` is also 0 / 0 / 0. Explicitly selecting all
50 frames still rerenders the frames (50 / 0 / 0), demonstrating that the memo
does not suppress a real selection change. A separate Profiler assertion checks
zero commits of an already-open delegated tooltip during repeated zoom/pan.

Final technical results:

- PASS **223/223 tests in 32 files**: all original 217 References checks plus
  six new render/tooltip/shell/Markdown checks. Full JSON:
  `test-visuals/round6/w1/stalls-references-tests.json`; unit count stages:
  `test-visuals/round6/w1/render-counts.json`.
- After the final bucket-constant/menu-scope edits, reran the three affected
  suites: **20/20 passed**. Both TypeScript configurations passed.
- Scoped Biome: **74 files checked, no fixes**. Interaction-map integrity:
  **4/4 passed**. Scoped `git diff --check` passed.
- Production mock build passed with original budget/splitting plugins;
  initial JS **240,065 bytes gzip**, below 250,000. The temporary test config
  uses native loading/preserved symlinks/one thread worker and is removed again.
- QA trace trajectory/timing sampling are unchanged. End-of-run diagnostics now
  assert far shells actually have `content-visibility: auto`; `shoot.cjs` adds
  delegated-tooltip and frame-LOD screenshots in both themes. Syntax checked;
  those browser scripts have not been executed on this repaired source.

**Browser timing/layer counts, visual/native/human acceptance remain NOT RUN on
the repaired source.** QA must rebuild and rerun the existing `trace-panzoom.cjs`;
the <=5 target is not claimed. No canvas reference text-search expectation is
carried forward: only filters, drawer linking search and route focus exist.

## Second pass: header regression, store fan-out and paint bounds

QA's [retained remeasure report](../../test-visuals/round6/qa-canvas/remeasure/report.md)
records scripting 14.57 -> 9.06 ms/frame, main Layerize 8.58 -> 7.70 and paint /
prepaint 3.84 -> 5.74. All six timing runs still failed. DPR 2 load was uncontrolled;
its slowdown is not attributed to one source change. It also documents a genuine
regression: the 0.2 -> 0.199 bucket doubles header scale and overlaps neighbors.

RC04 implementation:

- Removed numeric header zoom buckets. `frameHeaderScale` is continuous and
  capped by frame width / 200. CSS carries the continuous camera scale; only
  actual compact-row/overview transitions enter React. Header width times scale
  equals the frame width; Fit uses the same bounded geometry. Tests reproduce the
  old 1,500-world-pixel header on a 280-pixel frame and verify width/height continuity
  and neighboring frame spacing at 20%/19.9%.
- `CanvasViewportRuntime` shares one Flow subscription, keyed by underlying
  getState identity rather than useStoreApi's per-component facade. It coalesces
  source writes once per RAF and uses equality before notifying React. Item and
  edge near/overview/selection decisions use one primitive each; frames observe
  layout modes and images observe only thumbnail adequacy, preserving DPR checks.
  Releasing the last observer cancels pending work; reconnect reads the current
  camera. Continuous label scale and minimap mask updates are imperative DOM
  effects, not broad React state. Movement state changes only on gesture edges.
- The model minimap renders all non-hidden geometry/selection in one memoized
  SVG; parent offsets and dimensions come from the same full node model. Its
  rectangles have no individual store subscriptions. Pointer drag, wheel zoom,
  arrow panning and +/- zoom are exercised; its keys bypass canvas item movement.
- Far handle anchors are plain geometry DOM, eliminating their connection-store
  listeners; visible interactive handles remain real Flow handles. The complete
  model, selected IDs, verdict/link data and retained editors are unchanged.

Notification evidence: `canvas-notifications.test.tsx` uses the real 500-item /
50-frame / 200-edge component subtree and nested Flow Zustand implementation.
All item bodies/edges are outside its viewport. It does not instantiate production
NodeWrapper/EdgeWrapper components; those and visible Handle listeners remain in
the actual app. This boundary matters when comparing counts to production.

| One zoom update | Before | After |
|---|---:|---:|
| Flow/Zustand subscriber callbacks | 3,203 | 2 |
| Flow/Zustand selector calls | 3,204 | 2 |
| Shared viewport bridge callbacks | 0 | 1 |
| UI / brain-context / brain-session store notifications | 0 / 0 / 0 | 0 / 0 / 0 |

Before: 500 item near+overview subscriptions, 200 edges with three subscriptions,
50 frame subscriptions, 1,000 far Handle connection subscriptions and 550 stock
minimap per-node selectors dominate the fixture. After: derived predicates are
still checked once per RAF, but unchanged snapshots do not notify React. Four
camera writes in one frame produce one derived observer batch. Continuous camera
steps still render **0 frames / 0 tooltips / 0 Markdown**. Explicit frame selection
still renders the 50 changed frames. Counts and their limits are retained in
`test-visuals/round6/w1/second-pass-counters.json`.

Paint investigation (existing traces, no new browser/ablation):

- `paint-review.json` summarizes all six retained traces. Large Paint clips name
  `DIV class='react-flow__viewport xyflow__viewport react-flow__container'`.
  Maximum recorded clip-coordinate area is about 235 million at DPR 1 and
  771 million at DPR 2. The largest inspected DPR 2 viewport clip spans roughly
  -12,882..15,069 by -12,945..14,504; a sampled viewport Paint lasts 33.984 ms.
- The promoted viewport now receives an explicit rectangular paint clip for the
  visible area plus one viewport on each side, updated in the same RAF batch.
  Tests bound its geometry to 3x3 viewport area at DPR 1/2, independently of board
  size; this does not prove the browser's resulting raster/paint cost. Near menus
  and drafts retain the overscan margin; the model is not clipped or filtered.
- Off-screen content-visibility is retained. The traces do not isolate its cost
  from shadows, text, layer bounds or OS load; no unsupported causal claim or
  measured DPR 2 speedup is made. Fresh QA must check the clip/minimap appearance,
  smooth 20/19.9% labels and both DPRs. `shoot.cjs` now includes those zoom samples
  and real header-vs-frame bounds assertions in both themes.

Final RC04 gates:

- PASS **230/230 tests in 35 files**, complete References subtree plus shared
  Markdown regression, including pending-batch cancellation/reconnect. Evidence:
  `test-visuals/round6/w1/second-pass-tests-final.json`.
- PASS both TypeScript configurations; scoped Biome **81 files**; **4/4**
  interaction-map integrity tests; scoped whitespace/diff check; QA script syntax.
- Production mock build passed with original budget/splitting plugins;
  initial JS **240,063 bytes gzip**. No browser was launched for this repair.
- Notification instrumentation is now enabled in regular `vitest.config.ts` by
  inlining Flow/Zustand into the test module graph. Otherwise a mock of an
  external dependency silently counted zero. The test rejects zero instrumentation
  and per-item fan-out (at most three infrastructure listeners plus one bridge;
  this installation measured two plus one). The final targeted counter rerun passed.
- One earlier combined targeted run timed out while lazily importing Markdown
  under the 5-second deadline; its retry passed. The counter now preloads that
  module in the import phase, retains the normal deadline, and passed in both
  complete runs. The temporary native-loader/thread fallback config is removed.

The standing <=5
long-frame target, browser paint reduction and native/human acceptance are NOT
RUN on RC04; QA must rebuild using the existing trace script. No Rust source,
release version, commit, push or publication is changed by W1.

## RC05 minimap fill cascade correction � 2026-10-26

React Flow's `.react-flow__minimap-node` CSS fill overrides SVG presentation
attributes. Use its supported per-node background/stroke CSS variables instead;
no extra specificity or `!important` overrides. Model geometry, viewport observers
and selection stroke behaviour are unchanged.

Regression evidence: with the actual installed Flow stylesheet and app theme
tokens (Tailwind import omitted by the DOM harness), computed-fill tests initially
failed for all four types in both themes, returning Flow defaults. After the fix,
frame/note/image/link computed fills are transparent/#f8e3a3/#f4c6cf/#dcd3f2 in
light and transparent/#6e5d2e/#6e4450/#4e4670 in dark. The existing minimap
geometry/navigation test also passes: **3/3 DOM tests**. Frontend TypeScript
`tsc --noEmit` and scoped Biome checks passed. Native-loader/thread test fallback
was used and removed. No browser/native screenshot acceptance is claimed.

Per orchestrator, the previous two performance measurements overlapped a release
worker's full CI mirror and are not comparable. No performance work, build or
benchmark was run for RC05; clean idle-machine measurement remains with QA.

## RC06 rendering ablation switches — 2026-10-26

Read clean QA: alpha.42 QS4 (132 items) is 72 FPS / 7 long frames against current
53 FPS / 54 at DPR 1; busy board is ~33 FPS / 68–69 long frames. Paint 9.0 and
Layerize 8.8 ms/frame exceed scripting 5.6. These controlled observations confirm
regression but do not establish which rendering change caused it.

Added `window.__jamCanvasFlags` (pre-mount snapshot, fresh configuration per page)
for culling, contentVisibility, paintClip, frameBuckets, delegatedTooltips,
markdownMemo, rafCamera and gestureWillChange. Defaults stay all-on; non-mock
production ignores overrides. No rendering strategy was selected as a repair.

All-off uses alpha.42 Flow visibility virtualization (except active drafts),
individual immediate camera selectors/observers, raw image/frame zoom, original
Flow MiniMap, per-control tooltips, unmemoized canvas Markdown and no gesture
promotion/viewport clip/shell containment. The bounded smooth frame-header
geometry and Fit correctness stay shared, as do selection/off-screen-focus,
draft and minimap-colour correctness. Other workers' interactions/data remain.
The camera flag groups the model minimap replacement and narrow thumbnail
selector with the RAF observer strategy; contentVisibility depends on culling
leaving far shells. This is a controlled approximation, not a historical binary.

`test-visuals/round6/w1/flag-matrix.cjs` builds with original budget/splitting
plugins and defines 13 configurations × 2 fixtures × 3 runs at headed DPR 1.
It reuses the original W1 trajectory/trace code, rotates order, isolates contexts,
checks exact counts and page errors, and reports median FPS, >20ms intervals,
Paint and Layerize. Exclusive main-thread phase accounting is bounded by timing
marks; Paint includes PrePaint. Full traces/results and a Markdown table persist
under W1. `flags.md` records switch ownership, correctness exceptions and usage.

Verification: References subtree plus shared Markdown **250/250 tests in 36
files**, including fifteen new flag/default/production-gate/mount/zoom/focus and
memo/observer tests, two Flow strategy/gesture checks and shell-containment off.
Current frame/tooltip/Markdown render-count and notification regressions remain
green. Scoped Biome and frontend TypeScript passed. Matrix configuration and
trace-accounting self-tests passed; `--build-only` production mock passed with
the existing bundle budget and splitting plugins. The temporary native-loader /
single-thread fallback was used for tests. No headed matrix, performance result,
native screenshot or source-level performance attribution is claimed; idle QA
will run it. No release version, commit, push or publication changed.

RC07: QA's 108 idle-machine runs selected gesture-only promotion: 132/500 items measured 72.68/72.04 FPS and 6/6 long frames, versus all-on 54.22/35.18 FPS and 53/69 (qa-canvas/flags/report.md, ranking.md, full-table.md).
Ship that path; delete the seven other rendering paths and flags, keep bounded headers, standard minimap colours, model/focus/draft fixes and fixture/trace tooling; simplified-source timing/screenshots await QA, and the <=5 target remains unmet by the measured winner.
