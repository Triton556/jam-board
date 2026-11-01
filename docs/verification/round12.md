# Round 12 verification — unreleased integration

Branch: `feature/round-12`; baseline HEAD `0771c62ea64f5db9d8b34b58eeddc94c7c8161e0`.
Package version remains `0.3.0-alpha.47`; schema 10, snapshot format 4. No release,
commit, push, tag or branch change was authorized or performed. This record concerns
the integrated working tree, including the accepted package fixes below.

## Package evidence

| Package | Verified scope and handoff | Evidence |
|---|---|---|
| B | Independent card scrollers, pinned controls, drag/wheel/keyboard, 192-card budget and live anchoring. Brain Fix 1 allows horizontal chaining while containing vertical wheel. | [report and Fix 1](../../test-visuals/round12/R12-B/report.md), [9-case browser log](../../test-visuals/round12/R12-B/fix1/browser.log) |
| K | Shell-specific Claude snippets, token-free JSON, retained Codex config, explicit safe copy and presence-only status; scoped DOM/source harness evidence. Literal apostrophe in a cmd path is preserved; the contradictory no-apostrophe requirement is not claimed. | [17-test report](../../test-visuals/round12/R12-K/report.md) |
| C | Lossless fixture migration, typed schemas, compact reads, per-tool receipts, legacy file replay/recovery, import/undo/history, moves, files and bounded preview. Later decisions supersede the original stopped sections. | [report including Fix 2](../../test-visuals/round12/R12-C/report.md), [decision 1/2](../../test-visuals/round12/R12-C/decisions-1.md), [file_legacy amendment](../../test-visuals/round12/R12-C/decisions-2.md) |
| I | Questions/Events, grouped/filter/paged events, visible one-second seen timer, numeric/dot badge and retained answer drafts; Fix 1 aligns the shared column. | [99 DOM / 5 browser report and Fix 1](../../test-visuals/round12/R12-I/report.md) |
| F | Viewer, usage-aware deletion, replace/history, scopes and Assets/Task Files entry points; Fix 1 corrects real titles, metadata and rail separation. Scoped captures used a fixture shell. | [90 DOM / 9 source-browser report](../../test-visuals/round12/R12-F/report.md) |
| P | Markdown parser, conflict/overwrite/import/history/Undo, palette and moves. File input/drop and captured story-version Undo are accepted by Fix 1. Its previously unrun shared-board cases are now included in G. | [117 DOM / 4 visual cases and Fix 1](../../test-visuals/round12/R12-P/report.md) |
| H | Both generated catalogs checked without pending exemptions; partial moodboard retry, per-tool IDs, historical replay and human-only review documented. | [Fix 2: 8 Node / 1 lifecycle test](../../test-visuals/round12/R12-H/report.md) |
| M | Moodboard migration/model/batch/feedback/ancestry/Send/Collect, Inbox core, native revision openers and story-version guard. Core scenario uses 40 images in six frames, 20 verdicts and three reasons; browser scenario uses 47 images, 20 keyboard ratings. Fix 1 consolidates menus and improves controls/pluralization. | [report and Fix 1](../../test-visuals/round12/R12-M/report.md), [exact handoff](../../test-visuals/round12/R12-M/tsc-handoff.md) |
| G | Shared bridge/state and lifecycle, stable create retry IDs without a dispatch read gap, route validation/file overlay, review-section focus, Settings integration, consistency/docs and current whole-tree checks. | [G report](../../test-visuals/round12/R12-G/report.md), [source hashes](../../test-visuals/round12/R12-G/source-hashes.json) |

Package totals above are scoped historical results, not sums to add to G's whole
run and not native acceptance. The current G counts and remaining failures are
recorded in its report with exact log links.

## Revised G Fix 1 — owner approval first

The revised [brief](../../test-visuals/round12/R12-G/fix1.md) replaces the stopped
test/CI plan. The stopped fix's new test and formatting edits were reverted
without reverting accepted earlier work. No tests or CI-local were run after
the revision. Owner live approval, notification timing and CI-local are pending.

The import dialog now uses an English **Choose file…** button, a visually hidden
named input, and **No file chosen** / filename status; the drop zone is retained.
Board card DOM and sizing rules match alpha.47; the existing empty footer's
27 px minimum height and 13 px margin explain the band below tags. No card
sizing change was made; `content-visibility` remains.

Allowed checks: frontend `tsc --noEmit` exits 0 with no diagnostics; Biome on the
changed UI/capture/evidence scripts exits 0. Eight requested Plan Step 1 / Board
PNGs were captured from the source/mock app and opened. These are visual
observations, not tests or owner approval. See [Fix 1 results and rollback list](../../test-visuals/round12/R12-G/report.md#fix-1)
and [capture inventory](../../test-visuals/round12/R12-G/fix1-captures.json).

## Initial integrated checks — historical, before revised Fix 1

- Workspace Rust: **521 passed, 0 failed, 4 existing ignored**;
  [test log](../../test-visuals/round12/R12-G/rust-workspace.log).
  Workspace/all-target Clippy with `-D warnings` and `cargo fmt --all --check`
  passed: [Clippy](../../test-visuals/round12/R12-G/clippy.log),
  [format](../../test-visuals/round12/R12-G/fmt.log).
- Both TypeScript configurations: **0 diagnostics**;
  [frontend](../../test-visuals/round12/R12-G/tsc-final.log),
  [e2e](../../test-visuals/round12/R12-G/tsc-e2e-final.log).
- Node script checks: **34 passed, 0 failed/skipped**;
  [final log](../../test-visuals/round12/R12-G/node-tests-final.log).
  Isolated stdio smoke passed all five checks, with no execution grant:
  [log](../../test-visuals/round12/R12-G/stdio-smoke.log).
- Whole functional Playwright: **195 passed, 0 failed/skipped**;
  [whole log](../../test-visuals/round12/R12-G/browser-verified.log).
  A final width/wrapping constraint on the Connect prompt button was then
  checked by **17/17 DOM tests** and **4/4 integrated browser layouts**;
  [Connect DOM](../../test-visuals/round12/R12-G/vitest-connect-final.json),
  [layout log](../../test-visuals/round12/R12-G/browser-connect-final.log).
  The whole browser run precedes that last style-only repair.
- Latest whole Vitest: **1,512 passed, 1 existing 5-second notification-test
  deadline failure, 0 skipped**, 190 files. An earlier whole serial run passed
  all 1,513; the final focused recovery passed **79/79**. The latest whole result
  is not green and its timing stability remains unresolved:
  [whole JSON](../../test-visuals/round12/R12-G/vitest-verified.json),
  [focused JSON](../../test-visuals/round12/R12-G/vitest-last-focused.json).
- The [G report](../../test-visuals/round12/R12-G/report.md) records every
  retained PNG and the failed/interrupted run history. Playwright uses the
  exclusive `.dev-data/e2e.lock`, source/mock port 1481 and reserved unused 1483;
  its runner releases the lock in `finally`. It does not start the stock
  performance build/preview server or the packaged app.
- `ci-local.ps1 -AllowNodeMajor 26` was invoked with an explicit guard preventing
  its unconditional `npm ci`. Dependencies are healthy; reinstall/download is
  outside this task. The runner stopped at that step and marked its later gates
  NOT_RUN. Individually run checks above are separate evidence, not a green CI
  result. [Runner log](../../test-visuals/round12/R12-G/ci-local.log).

## Evidence limits

NOT RUN: packaged/native app launch or usability, owner live AppData/Little Stones,
real agents/provider prompts, adapter downloads, actual native pickers/openers,
real clipboard/shell execution, installation/update/DPI/cross-browser checks,
actual-human observation and hosted Windows/Linux CI. Rust's four existing ignored
fixture/opt-in volume cases are not passes. Test transports/openers and the source
browser use disposable fictional state. No previous build's acceptance is assigned
to an unobserved surface.

Imports, file bookkeeping, reference feedback and Inbox seen state do not launch
agents or grant Start. Prepared prompts, Ready, answers, heartbeats and presence
retain their separate meanings.
