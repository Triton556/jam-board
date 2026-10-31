# Round 11 — project folders, Files and shared task views

Updated: 2026-10-31. Branch `feature/round-11`, base
`477ca3ddfd11bad92a4ab73288a5ee06f40eaaca`; shared uncommitted work.
This ledger includes G1 integration and G3 fixture/DOM/browser acceptance, followed by Polish 1; it is not a release or native acceptance pass.
G2 changed documentation only. Results below are attributed to worker reports;
G2 did not rerun their Rust, DOM or browser checks or inspect their PNGs again.
Logs under `test-visuals/` are local ignored evidence, not release assets.

The [approved design](../../test-visuals/round11/design.md) is qualified by the
[common overrides](../../test-visuals/round11/common.md): no SQL-trigger fence
against old binaries, one live board per project ID on this machine, explicit
cloud acknowledgement, 10 recent + 7 daily local backup defaults plus pinned
backups, snapshot field allowlist, and phase-2/3 metadata hooks only.
Earlier alpha46/round-10 results do not accept changed round-11 code.

## Changed behavior and map contract

- Per-project folder manifest, owned files, generated portable snapshot and
  local `.state` database/backup/journal; immutable selection contexts.
- Create/open/duplicate choice, expected-ID Locate, registry-only removal,
  read-only move preview, journaled verified move/resume/pre-cutover rollback,
  Folder rules/cwd/backups/Save now, and explicit snapshot recovery.
- Task Files with copy/link/URL/pick, roles/order, availability, byte-preserving
  unlink and freshly validated native Open/Reveal. Five new MCP tools, 57 total.
- One TaskView/editor across drawer and `?taskView=modal`, retained drafts,
  pending saves/conflicts, route state and nested keyboard/focus handling.
- Agent canonical locator independent of cwd; immutable source/history context,
  cwd precedence and ownership leases blocking move while bound.
- Maps: existing G04, D01–D11, A01, S01–S05, BD01/BD03/BD16,
  AG01/AG11–AG17 and BC01/BC07/BC09/BC11–BC13; new PF01–PF11,
  TF01–TF08, TV01–TV03, AF01–AF06 and FQ01–FQ46. H-A01 denotes A01.

## Package evidence

Counts are actual reported executed tests, not totals to add together: packages
overlap and checkpoints differ. A focused subset is included in its full suite.
Initial failures remain attributable to their checkpoints. U/T partial/shared failures and G1 sandbox blockers below are historical; the G3 results supersede those integration gaps for the tested fixture/mock surfaces.

| Package / scope | Actual checks and evidence | Limits / next owner |
|---|---|---|
| [C](../../test-visuals/round11/r11-c/report.md): v9 storage, registry/lifecycle, moves, snapshots/backups, Files, transports, desktop bindings | Core/MCP/CLI **224 PASS, 3 ignored** ([log](../../test-visuals/round11/r11-c/core-tests.log)); agents **121 PASS** ([log](../../test-visuals/round11/r11-c/agents-tests.log)); desktop **29 PASS** ([log](../../test-visuals/round11/r11-c/desktop-tests.log)). Focused **40 functions**: ST8, DB5, MV7, SN7, FI8, MC5 ([manifest](../../test-visuals/round11/r11-c/focused-tests.json)). Requested Windows path matrix **8/8** reported. SQLite **3.53.2** clears enforced 3.51.3+ guard ([runtime](../../test-visuals/round11/r11-c/sqlite-runtime.log)). Fmt/clippy PASS; two binding exports identical ([receipt](../../test-visuals/round11/r11-c/bindings-reproducibility.log)); installed tsc equivalent PASS ([log](../../test-visuals/round11/r11-c/typecheck-equivalent.log)); pnpm command NOT RUN, absent executable. **PASS 7/7**. | Rust/stdio/HTTP fixtures on Windows; no native/package/UI/Linux/real-agent acceptance. Physical disk-full/AV/sync/offline/remote and dedicated extended path cases unobserved. No non-Windows free-space preflight; sequential cached file status, conservative companion cleanup. |
| [C2](../../test-visuals/round11/R11-C2/report.md): remove/Locate/preview, saved time, create initialization, selection fences, backend Open/Reveal | Core/MCP/CLI **233 PASS, 3 ignored** ([final log](../../test-visuals/round11/R11-C2/core-mcp-cli-final.log)); desktop **30 PASS** ([log](../../test-visuals/round11/R11-C2/desktop-tests.log)); agents **129 PASS** ([log](../../test-visuals/round11/R11-C2/agents-tests.log)). **9 new core + 1 fake-opener desktop** test included. Clippy/scoped fmt/diff PASS; two generated exports match ([first](../../test-visuals/round11/R11-C2/bindings-export-1.log), [second](../../test-visuals/round11/R11-C2/bindings-export-2.log)). TypeScript **FAIL, five integration errors** ([log](../../test-visuals/round11/R11-C2/typecheck.log)). **PASS 7/7 backend deliverables**, not frontend green. | Its five TS errors are historical C2 handoff; later U/T report successful whole-program typechecks on their checkpoints, not integrated G1 acceptance. Linux clippy NOT RUN past missing cross-C compiler ([attempt](../../test-visuals/round11/R11-C2/clippy-linux.log)). Fake opener never launches OS apps. Preview reports categories, no client names; existing empty destination refused. |
| [M](../../test-visuals/round11/R11-M/report.md): shared TaskView/session, routes, draft/pending/conflict retention, modal geometry/focus | Final DOM **128/128, 24 files** ([log](../../test-visuals/round11/R11-M/vitest-browser-followup.log)); Chromium/mock **36/36**: modal13 + board18 + human-first4 + hidden1 ([log](../../test-visuals/round11/R11-M/e2e-final.log), [JSON](../../test-visuals/round11/R11-M/e2e.json)). **16 PNGs individually inspected by M** ([review](../../test-visuals/round11/R11-M/visual-inspection.md), [manifest](../../test-visuals/round11/R11-M/evidence-manifest.json)). Both typechecks, full Biome **455 files**, scoped diff and mock production build PASS; initial gzip **241,890 / 250,000** budget. **PASS 5/5**. | Earlier 34/35 browser and 125/128 fork-pool DOM failures retained; final thread-pool rerun after browser activity passed without raised deadlines. Original linked-assets default was later replaced by T's TaskFiles. Shared instance identity/cache integration and G1 focus correction require changed-source QA. Native/package/providers/full ci-local NOT RUN. |
| [U](../../test-visuals/round11/R11-U/report.md): create/open/recents/move, Folder settings/recovery, UX polish | Owned **41/41**; seven affected suites **109/109** ([final log](../../test-visuals/round11/R11-U/vitest-polish-owned-final.log)). Eight-suite combined **117 PASS / 5 FAIL, 122 total** ([log](../../test-visuals/round11/R11-U/vitest-polish-final.log)). Browser **4/4** unique lifecycle variants ([log](../../test-visuals/round11/R11-U/playwright-polish-final.log)); move refresh reran same **4/4**, not 8 unique tests ([refresh](../../test-visuals/round11/R11-U/playwright-polish-move-final.log)). **36 final PNGs inspected by U**, inventory in report. Both typechecks, 14-file Biome and diff PASS ([tsc](../../test-visuals/round11/R11-U/typecheck-polish-final.log), [e2e tsc](../../test-visuals/round11/R11-U/typecheck-e2e-polish-final.log), [Biome](../../test-visuals/round11/R11-U/biome-polish-final.log)). **PASS 3/6**. | Open/recents partial until persisted registry display names; recovery and contexts partial until shared integration. Five failures in general-project-content concern generic JSON classification; owner requires other, G1 to fix Rust/frontend. 375 shell crowding outside U. Browser/DOM only; native picker/real filesystem/provider NOT RUN. |
| [T](../../test-visuals/round11/R11-T/report.md): Files/Assets, copy/link/URL, roles/order, status, fresh native intent, design polish | Owned **34/34** ([log](../../test-visuals/round11/R11-T/vitest-polish-final.log)); affected **135 PASS / 10 FAIL, 145 total**, 15 suites pass/2 fail ([log](../../test-visuals/round11/R11-T/vitest-affected-polish-final.log)). Standard functional browser **5/5** ([log](../../test-visuals/round11/R11-T/playwright-polish-final-normal.log)). **20 final PNGs inspected by T** ([receipt](../../test-visuals/round11/R11-T/inspected-pngs.json)); type/e2e/scoped Biome PASS ([checks](../../test-visuals/round11/R11-T/checks-polish.json)). Families FI-T01–17, C2-T01–05, P-T01–05 with parameterized cases. **PASS 4/5**. | Ten shared legacy failures: five interaction-walk3, five asset-reference-recovery; linkAsset spies/unnamed comboboxes/new folder boundary need integration repair. Authoritative inventory/CAS/reset/assets and instance caches remain G1. Shared 375 header clips. Real OS Open/Reveal/package/DPI NOT RUN; mocks record intent only. No remaining sandbox blocker for T's permitted runtime checks. |
| [A](../../test-visuals/round11/R11-A/report.md): canonical locator/cwd, immutable source/history, lease/move refusal | Agents **129 PASS**, includes **8 new r11_ tests** ([log](../../test-visuals/round11/R11-A/agents-tests.log)); focused **8/8** ([log](../../test-visuals/round11/R11-A/focused-final.log)); desktop **29 PASS** ([log](../../test-visuals/round11/R11-A/desktop-tests.log)); core/MCP/CLI **224 PASS, 3 ignored** ([log](../../test-visuals/round11/R11-A/core-mcp-tests.log)). Scoped clippy/fmt/tsc/diff PASS; bindings unchanged at A checkpoint. **PASS 5/5**. | Fake ACP/config/loopback HTTP fixtures only. Supplemental generated-config stdio **NOT RUN (sandbox)**, Node spawn EPERM ([log](../../test-visuals/round11/R11-A/generated-stdio.log), [rerun script](../../test-visuals/round11/R11-A/check-generated-stdio.cjs)). Linux clippy NOT RUN past missing compiler ([attempt](../../test-visuals/round11/R11-A/linux-clippy.log)). Low-level legacy choose_cwd retains historical hint fallback; bound desktop validates default. Shared dock mock parity G1; native/package/live provider NOT RUN. |
| [H](../../test-visuals/round11/R11-H/report.md): embedded board-owned guide/operations, roles/worktrees/boat flow and schema guard | In-process guide **5/5 PASS**. `node --test scripts/*.test.mjs` **NOT RUN (sandbox)**: test-file child spawn EPERM. No-isolation all-scripts **27 PASS / 4 NOT RUN (sandbox)**, four smoke-stdio child-spawn failures; exit 1, not suite green. MCP **22 PASS, 1 ignored**; desktop skill tests **10 PASS**. Scoped diff PASS. **PASS 5/5**. Detailed commands/results in report; H supplied no standalone log links. | Text/fixture checks, no actual install/session/OS app. Full subprocess suite must rerun with access. Existing embedding paths serve the same sources, no new registration. No visual layout change; native/browser usability NOT RUN. |
| [G1 integrated](../../test-visuals/round11/R11-G1/report.md): shared mock/routing, recovery, names/classification, legacy tests and UI | Windows Rust **438 passed, 4 ignored** ([log](../../test-visuals/round11/R11-G1/cargo-test-final.log)); clippy/fmt PASS ([clippy](../../test-visuals/round11/R11-G1/clippy.log), [fmt](../../test-visuals/round11/R11-G1/fmt.log)); two exports identical ([hashes](../../test-visuals/round11/R11-G1/bindings-hashes.json)). App/e2e tsc PASS ([app](../../test-visuals/round11/R11-G1/typecheck.log), [e2e](../../test-visuals/round11/R11-G1/typecheck-e2e.log)); Biome **473 files** ([log](../../test-visuals/round11/R11-G1/biome.log)); supplemental shared-mock probe **3 scenarios** ([log](../../test-visuals/round11/R11-G1/mock-smoke.log)). | G1 reported **3/7**, with Vitest/browser sandbox-blocked and zero PNGs. Those pending checks were subsequently exercised by G3; G1 did not itself supply a UI pass. |
| [G3 integrated verification](../../test-visuals/round11/R11-G3/report.md): source repairs, complete suites and rendered inspection | Pre-polish full DOM **174 files / 1,359 tests** ([final-source log](../../test-visuals/round11/R11-G3/vitest-final-source.log)); all functional browser **156/156** ([log](../../test-visuals/round11/R11-G3/playwright.log)); Node **31/31** ([log](../../test-visuals/round11/R11-G3/node-tests.log)), generated stdio **1/1** ([log](../../test-visuals/round11/R11-G3/generated-stdio.log)). **29 PNGs inspected by G3** ([manifest](../../test-visuals/round11/R11-G3/png-inspection.json)); app/e2e tsc and Biome **474 files** PASS ([receipts](../../test-visuals/round11/R11-G3/frontend-results.json)). Rust **438 passed / 4 ignored**, clippy/fmt PASS ([Rust](../../test-visuals/round11/R11-G3/cargo-test.log), [clippy](../../test-visuals/round11/R11-G3/clippy.log), [fmt](../../test-visuals/round11/R11-G3/cargo-fmt.log)); exports identical to G1 ([hashes](../../test-visuals/round11/R11-G3/bindings-hashes.json)). | **5/6** at this checkpoint because ci-local failed its environment prerequisite. Complete 156-case sweep predates polish and is not claimed as a whole-suite rerun after changed UI. No native/package/Linux/real-agent acceptance. |
| [G3 Polish 1](../../test-visuals/round11/R11-G3/report.md#polish-1): move status/stepper and labeled mobile menu | Final whole Vitest **175 files / 1,365 tests passed** ([terminal log](../../test-visuals/round11/R11-G3/polish/vitest-full.log)); affected DOM **70 tests / 7 files** ([log](../../test-visuals/round11/R11-G3/polish/vitest-affected.log)). Affected functional browser **47 passed** ([log](../../test-visuals/round11/R11-G3/polish/playwright-initial.log)); after connector/color fix **9 passed** ([log](../../test-visuals/round11/R11-G3/polish/playwright-final.log)): 47 distinct cases, 56 successful executions, not 56 unique tests. Both tsc PASS ([app](../../test-visuals/round11/R11-G3/polish/tsc-app.log), [e2e](../../test-visuals/round11/R11-G3/polish/tsc-e2e.log)); Biome **476 files**, zero diagnostics ([log](../../test-visuals/round11/R11-G3/polish/biome.log)); **13/13 final PNGs inspected by G3**, inventory in report. | The worker stopped before amending its final line: **POLISH PENDING is stale**; the completed whole-Vitest log is the evidence. No Rust/Node-script source changed in polish; their G3 gates were retained, not rerun by that worker. ci-local not rerun; native boundaries remain unaccepted. |
| [G3 ci-local on Node 26](../../test-visuals/round11/R11-G3/report.md#ci-local-on-node-26): explicit runtime override and full runner | **18 PASS / 5 SKIP, exit 0** ([step receipt](../../test-visuals/round11/R11-G3/ci26/results.json)); final DOM **175 files / 1,366 tests**, browser **156/156**, Rust **438 passed / 4 existing ignores**, Biome **476 files**, both typechecks and debug Tauri build PASS. The stale Polish report marker was corrected to **POLISH PASS 4/4**, retaining its historical 1,365-test count. | Node **26.13.0** via `-AllowNodeMajor 26`, explicitly different from CI's Node 22. Default gate and workflow unchanged; Node 22 parity only through GitHub CI. Built app not launched; native/package/Linux/real-agent boundaries remain unaccepted. |

## Integrated behavior and evidence boundaries

G1 unified JamApi/mock task/files/CAS/settings/reset and selection namespaces,
recovery generation replacement, persisted missing-folder names and JSON kind
other. G3 repaired the mock initialization cycle, selected Files/settings API
routing, initial selection acceptance, lazy task boundary and fixtures, then
completed the integrated DOM/browser stories. See the
[shared integration test](../../apps/desktop/src/features/round11-integration.test.tsx)
and [browser story/spec](../../apps/desktop/e2e/round11-recovery.spec.ts).

Polish running moves show one step-specific status and no footer actions;
interrupted moves show safety guidance and Close / Roll back / Resume; completed
or rolled-back moves show Done. Markers/connectors replace CSS arrows. The
375 More menu has labels, real agent statuses and keyboard/focus behavior.
Connection prompts use configured workingDirectory with legacy hint fallback;
Assets refresh reports either source failure without duplicate alerts.
The stable IDs in the human/acceptance maps now link the relevant specs/PNGs.
G2 read the reports/logs and did not rerun product suites or re-inspect PNGs.

## ci-local on Node 26: explicit owner override

**PASS, exit 0 on Node 26.13.0 via `-AllowNodeMajor 26`: 18 PASS / 5 SKIP / 0 FAIL / 0 NOT RUN runner steps**, including the synchronization guard. [Final stdout](../../test-visuals/round11/R11-G3/ci26/ci-local.log), [stderr](../../test-visuals/round11/R11-G3/ci26/ci-local.stderr.log), [step receipt](../../test-visuals/round11/R11-G3/ci26/results.json), [process](../../test-visuals/round11/R11-G3/ci26/ci-local-process.json), [exit](../../test-visuals/round11/R11-G3/ci26/ci-local.exit.txt).

The original strict run failed the Node 22 prerequisite ([historical log](../../test-visuals/round11/R11-G3/ci-local.log)). The owner subsequently authorized the explicit Node 26 override; no Node installation was performed. The default still requires Node 22 and gives the original error. Setup records **`Node 26.13.0 (CI uses 22; allowed by -AllowNodeMajor)`**, emits a visible warning, and the final summary explicitly says this run did not match CI's Node major. Workflow YAML, the synchronization fingerprint and other runner steps are unchanged. **Node 22 runtime parity is checked only by GitHub CI; it was not established locally and no hosted job was triggered here.**

The first flagged full run found a product close/filter race: a hidden drawer released the background before its deferred route close completed, allowing an archived filter update to retain the old task URL and reopen it after reload. It finished with **155 browser passes / 1 failure**, **16 PASS / 1 FAIL / 5 SKIP / 1 NOT RUN runner steps**, and no debug build ([attempt 1](../../test-visuals/round11/R11-G3/ci26/attempt-1/ci-local.log)). Modal ownership now remains until the route owner accepts the close; a controlled-idle unit/browser regression verifies the boundary. The full script was then rerun from the beginning. [Cause, fix and focused logs](../../test-visuals/round11/R11-G3/report.md#ci-local-on-node-26). No Node-version-specific product workaround or relaxed deadline was introduced.

Both full runs held `.dev-data/e2e.lock` exclusively and used owned ports **1455 / 1457**; the final lock is released. The debug executable was built at `target/debug/jam-board.exe` and **was not launched**. npm ci used the existing lockfile; Chromium setup used `npx --no-install`. Its non-blocking audit advisory remains in the log; no dependency update or audit fix was attempted.

| Runner step | Final result | Detail |
| --- | --- | --- |
| Workflow synchronization guard | **PASS** | Unchanged reviewed workflow fingerprint matches. |
| actions/checkout@v4 | **SKIP** | Use current working tree; no checkout/reset performed |
| Install Linux Tauri dependencies | **SKIP** | Linux only: apt/system libraries, including libarchive-tools for voice ZIP extraction, require GitHub Ubuntu |
| dtolnay/rust-toolchain@stable | **PASS** | Installed stable Rust 1.99.1, rustfmt and clippy checked; no toolchain install. |
| Swatinem/rust-cache@v2 | **SKIP** | Hosted cache action; existing local Cargo cache used |
| actions/setup-node@v4 (Node 22) | **PASS** | Node 26.13.0 (CI uses 22; allowed by -AllowNodeMajor) |
| npm ci | **PASS** | Existing lockfile: 263 packages installed, 264 audited; exit 0. Audit reported 1 high-severity advisory. |
| Check release version consistency and script tests | **PASS** | alpha.46 versions consistent; 26 passed, 0 failed, 0 skipped. |
| Prepare sidecar for Tauri resource validation | **PASS** | Current isolated MCP sidecar prepared. |
| Isolated current MCP contract smoke | **PASS** | 5 contract checks passed against a disposable explicit --db; no execution grant created. |
| cargo fmt --all --check | **PASS** | PASS on Windows. |
| cargo clippy --workspace --all-targets -- -D warnings | **PASS** | PASS on Windows; Linux not run locally. |
| cargo test --workspace | **PASS** | 438 passed, 0 failed, 4 existing fixture ignores; 51 result groups. |
| npm run check | **PASS** | Biome: 476 files, 0 errors, 0 warnings. |
| npm run typecheck | **PASS** | App TypeScript: 0 diagnostics. |
| Typecheck browser scenarios | **PASS** | E2E TypeScript: 0 diagnostics. |
| npm test | **PASS** | 175 files / 1,366 tests passed; 0 failed, 0 skipped. |
| Install Chromium (additional Windows gate) | **PASS** | Existing Playwright CLI via npx --no-install; exit 0. |
| Functional browser scenarios (additional Windows gate) | **PASS** | 156 passed, 0 failed, 0 skipped; includes deterministic archive-close regression. |
| Production table benchmark (manual only) | **SKIP** | Linux manual perf dispatch only; not a normal pre-tag gate |
| Debug desktop build | **PASS** | Tauri --debug --no-bundle PASS, including configured release sidecar and frontend build; executable not launched. |
| actions/upload-artifact@v4 diagnostics | **PASS** | Local diagnostics retained; no GitHub upload. |
| Preserve synthetic UI screenshots | **SKIP** | Hosted Linux upload only; existing test-visuals files retained locally |

These are Windows compile, DOM and mock-browser results. The 5 runner SKIPs remain the original hosted/Linux/manual-only steps. Linux clippy, native pickers/DPI, native packaging and real agents remain NOT RUN locally; the debug build does not establish native application or package acceptance. Printed push/tag advice was not executed.

## Remaining acceptance and owner recheck

FQ33–FQ36 are **NOT RUN, owner check**, not passes inferred from builds/hashes.
Use a disposable exact package/profile/registry and fictional boards/files,
never the owner's production AppData. Never run old app binaries concurrently.

- Native picker cancellation and mixed drop, long/Cyrillic paths, late A→B→A,
  copy cancellation, role/reorder/stale reload, retained bytes after unlink;
  fresh Open/Reveal then missing/deny-read refusal with no launch; DPI
  100/150/200%, Light/Dark and changed layouts at 1440/1000/375.
- Create every onboarding template; duplicate choices/new ID; wrong-ID Locate
  preserves selection/registry; Remove retains files; missing folders retain
  display names. Folder rule conflict retains edits, cwd differs from repository,
  Save now time persists and backup 10/7/pins remain local.
- Move synthetic multi-project legacy board after disconnecting fake owners;
  verify inventory/digests/hashes, interrupt/reopen/resume/pre-cutover rollback,
  retained source/read-only redirect. External edit compare/keep/restore and
  missing-state recovery replace generation caches before writes, retain
  IDs/history and never resurrect execution authority.
- Only the owner may explicitly launch real agents: check process cwd versus
  canonical anchor, A-session pinning while selecting B, original cwd/transcript
  after default changes, disconnect-before-move, old-source reconnect refusal.
  This documentation assignment starts none.
- Linux needs an equipped environment; local cross-target attempts lack the C
  compiler. Disk-full, AV, real sync-client/offline/mapped-remote behavior remain
  unobserved; synthetic warnings and fault injection do not accept them.

No renderers/previews (phase 2) or git badges (phase 3); metadata hooks only.
No automatic commit/push, secret scanning or publication. Snapshot privacy uses
an explicit allowlist; local credentials/cwd/history/connection configs stay out.

## G2 documentation checks

Fresh docs checks and actual results are recorded in
[R11-G2/report.md](../../test-visuals/round11/R11-G2/report.md).
They establish map/schema/link integrity, not usability or integrated behavior.

## Conflicting prose

English task metadata overrides the local Russian communication default;
knowledge capture remains Russian under the session instruction. Round-11
common overrides supersede design proposals for clones/cloud/backup counts/
old-binary SQL fences. Historical round-7/8 branch names and broad machine
access do not override the current branch, docs ownership or sandbox. G2 owns
only its specified docs plus report-local check artifacts, no installs/commit/
push/branch switch. The explicit memory instruction requires a narrow kb-save
capture despite inherited worker memory prohibitions; it grants no product
access or publication. Native/package/real-agent acceptance stays owner-only.
