# Performance and data-volume checks

These checks use disposable **fictional** boards. They do not connect to an existing
user database, run implementation work, grant scope permission or start AI sessions.
Timing results are observations of the stated machine/build/workload, not product
latency guarantees. Browser frame timing, DOM correctness and database timing are
separate kinds of evidence.

## Startup time

Measure a release desktop app from the first Rust entry into `run` to the first
visible paint of real route content. `processToWindowMs` records native window
creation (the initially hidden window exists at setup); `processToFirstPaintMs`
records the frontend `jam:first-paint` mark after a data-backed board/plan or the
welcome view commits, the window becomes visible, and two animation frames pass.
It excludes IPC delivery time. This is a practical first-screen proxy, not a
compositor presentation timestamp or proof that every deferred feature is ready.

Close other Jam Board instances, then run from the repository root:

```powershell
./scripts/measure-startup.ps1 -Executable ./target/release/jam-board.exe -Runs 7
```

Keep the matching `jam-board-mcp.exe` sidecar beside the executable. The script
seeds the real fictional demo using that sidecar in a unique throwaway data
directory, then reuses that directory for all measured launches. It never copies
an installed user's data. Evidence stays under `test-visuals/round6/w6/`: raw JSON
lines and the fixture in a unique subdirectory, plus the latest `startup.json`.
An existing app instance, missing receipt, failed launch or 60-second timeout
fails the run. The retained fixture allows investigation; cleanup is manual.

The first measured launch is labelled **cold** (one sample); the remaining six
are **warm**. Cold does not mean flushed OS/WebView caches: demo seeding and
earlier machine activity can warm those caches. Median uses the middle value or
mean of the middle pair; p90 uses nearest rank. A single cold sample has identical
median and p90. Record machine, Windows/WebView version, power mode, app version,
source revision and concurrent load when comparing runs.

The runtime probe requires `JAM_BOARD_STARTUP_PROBE=1` and a writable path in
`JAM_BOARD_STARTUP_OUT`. It appends exactly one JSON line with
`processToWindowMs`, `processToFirstPaintMs`, `route`, and `version`.
`JAM_BOARD_STARTUP_EXIT=1` exits after a successful write; otherwise the app stays
open. Without the probe flag Rust installs no probe state or initialization
script. The standalone helper is imported from packaged assets only by that
opt-in native script; it adds no JavaScript to the initial chunk. The 250 KB
initial-JS budget stays as a cheap build guard; bundle bytes are not a startup-time
baseline or usability claim.
No human action, agent state or execution grant changes in this diagnostic path.

Owner-machine baseline — **QA pending; no timings measured here**:

| Build / machine / OS / WebView | Runs | Group | Window median / p90 (ms) | First paint median / p90 (ms) |
|---|---:|---|---|---|
| Pending | 1 | Cold (first launch) | — | — |
| Pending | 6 | Warm (remaining launches) | — | — |

## Routine correctness

`cargo test --workspace` includes a small real-Store volume fixture covering counts,
filters, pagination and project isolation. Frontend `npm test` includes a 2,000-task
fixture that checks the actual table virtualizer's bounded row window, exact filter
counts and late-query cancellation after project switching. Its viewport dimensions
are synthetic in Happy DOM: passing it does **not** measure rendered frame rate.

Readiness, task status, presence and execution authorization remain separate in all
fixtures. An agent's unscoped online status must not animate every assigned task.

## Real Store and mixed-transport measurements

From the repository root, with the documented Rust/native prerequisites available:

```sh
# Retaining is optional; otherwise fixtures are removed on completion.
JAM_VOLUME_KEEP=1 cargo test -p jam-core --test volume -- --ignored --nocapture

# Rebuild explicitly: a fresh mtime is not proof of a current binary.
cargo build -p jam-mcp-cli
JAM_VOLUME_KEEP=1 JAM_VOLUME_STDIO_BIN="$PWD/target/debug/jam-board-mcp" \
  cargo test -p jam-mcp --test volume -- --ignored --nocapture
```

Use the corresponding `.exe` path on Windows; this command is not an installer
check. Each harness creates its own database under ignored `.dev-data/volume/`.
Do not substitute a live board. `JAM_VOLUME_STDIO_BIN` is required for the mixed
transport run, which verifies the sidecar's reported version before mutations.

The workload is three projects with 2,000, 1,000 and 40 tasks, including deliberate
Backlog/Ready/manual-Done states, archived samples, complete/incomplete briefs,
tags and comments. All scope execution remains paused. The mixed run uses two
HTTP and two real stdio clients with pinned projects, selection churn, live waits
and foreign-ID refusal checks. HTTP credentials are generated only for that
fixture and are not printed as evidence.

The core harness reports three warmups and twenty samples per operation, median,
nearest-rank p95/min/max, plus serialized JSON bytes and serialization time. The
mixed run reports transport round trips separately. Record the commit, dirty paths,
profile, toolchain, hardware/environment and concurrent load alongside the output.
A normal test-profile result is not a release-build or UI-render measurement.

## Same-database page comparison

The opt-in `task_paging` probe only accepts a retained, explicitly marked fictional
fixture under `.dev-data/volume/`, at the expected schema version. It refuses an
arbitrary database path or missing marker. Create the fixture with the harness
above; never manufacture a marker for existing user data.

```sh
# Replace <fixture> with the fresh retained fixture directory printed by the harness.
JAM_VOLUME_COMPARE_DB="$PWD/.dev-data/volume/<fixture>/fictional-volume.db" \
  JAM_VOLUME_COMPARE_PHASE=record \
  cargo test -p jam-core --test task_paging compare_exact_retained_fictional_fixture \
  -- --ignored --nocapture

# After applying the candidate implementation, use the SAME fixture and profile.
JAM_VOLUME_COMPARE_DB="$PWD/.dev-data/volume/<fixture>/fictional-volume.db" \
  JAM_VOLUME_COMPARE_PHASE=compare \
  cargo test -p jam-core --test task_paging compare_exact_retained_fictional_fixture \
  -- --ignored --nocapture
```

Record uses create-new evidence files and refuses to overwrite an earlier record.
Compare checks all 171 serialized filter results byte for byte, plus all persistent
table rows, table definitions and the schema version. These are logical snapshots,
not byte-identical SQLite files or verification of every index/trigger definition.
The probe calls only read APIs, but `Store` owns writable connections: the claim is
verified unchanged logical data, **not** an operating-system read-only guarantee.
Use an isolated QA workspace and preserve the baseline source, binary and output
before candidate edits; never point the probe at a normal installation. The offset cursor retains its existing contract: one call sees a
consistent transaction snapshot; separate pages do not promise a frozen board while
other clients edit it.

## Observed page-hydration improvement — 2026-10-21

Baseline: alpha10 implementation plus the new measurement harness. Candidate: the
alpha11 page-before-hydration change. Both measured binaries retained alpha10
metadata during this controlled comparison; the final alpha11 build is validated
separately. Same schema-7 fictional database, Rust 1.99.1, Linux x86_64, normal
unoptimized test profile, three warmups and twenty samples per row. The shared host
reported an AMD EPYC 9V74 and nine available parallel threads; CPU quota and memory
limit were not exposed. Host load is not controlled; these are observations, not
latency guarantees, release-build results or UI/frame timings.

Values are **median / nearest-rank p95 milliseconds**; payload bytes are unchanged.

| Project tasks | Operation | Before (ms) | After (ms) | JSON bytes |
|---|---|---:|---:|---:|
| 2,000 | `list_tasks.limit50` | 1303.73 / 1410.96 | 38.44 / 46.26 | 50,512 |
| 2,000 | `list_tasks.limit1` | 1277.72 / 1424.00 | 4.97 / 6.55 | 1,042 |
| 2,000 | `list_tasks.ready_hotspot` | 2924.30 / 3239.98 | 63.25 / 76.69 | 50,955 |
| 1,000 | `list_tasks.limit50` | 695.98 / 747.77 | 34.76 / 42.97 | 50,663 |
| 1,000 | `list_tasks.limit1` | 668.53 / 733.89 | 3.14 / 3.72 | 1,045 |
| 1,000 | `list_tasks.ready_hotspot` | 1395.03 / 1518.03 | 45.63 / 55.76 | 51,104 |
| 40 | `list_tasks.limit50` | 29.34 / 31.43 | 22.59 / 23.63 | 38,498 |
| 40 | `list_tasks.limit1` | 26.96 / 32.53 | 0.79 / 0.85 | 1,044 |
| 40 | `list_tasks.ready_hotspot` | 52.41 / 57.04 | 5.35 / 5.43 | 6,127 |

The implementation filters inexpensive candidate fields before loading full task
context and hydrates only the requested page. Readiness still uses the authoritative
Rust rule, returned fields still come from the same task hydrator, and explicit
foreign ancestors are rejected even when another filter would match nothing.
All 171 before/after results matched (3,415,950 serialized bytes; SHA-256
`d98adb394ffb7ebdb2d65b753516f8420efbdb1c47e111c907fa13b6255d9dbc`). All checked
persistent table data and metadata remained unchanged. Normal tests also exercise
actor modes, Unicode text, empty filters, offset boundaries, questions and concurrent
writes during a single read transaction.

This optimization does **not** change board-wide/table-wide hydration. The original
2,000-task baseline still measured roughly 1.06 seconds to hydrate the full desktop
board and 1.23 seconds for the agent board summary in this debug environment.
Those remain explicit limits, not improvements inferred from paginated reads.

Raw local evidence is retained under ignored `.dev-data/`: `volume-core-baseline.log`,
`volume-mcp-baseline.log`, `volume-exact-before.log`, `volume-exact-after.log` and
`volume-exact-comparison.json`. The latter includes measurements, ratios and hashes.
`volume-exact-final-after.log` repeats the full equivalence check after the final
readiness-predicate correction; the earlier measurement log is preserved unchanged.
No personal board data or HTTP token is included in this document.

## Ready-filter parity, not a new quality policy

The table's SQL readiness predicate previously used default `trim`, which removes
ASCII spaces rather than Rust's complete Unicode whitespace set. The regression
uses every scalar accepted by `char::is_whitespace`, padded meaningful Unicode,
empty fields and complementary Ready true/false result counts. A unit guard detects
future changes to Rust's whitespace table.

A second real-Store reproduction found already accepted NUL-containing brief text
misclassified by SQL `length`: SQLite counts text only before the first NUL, unlike
Rust's trimmed-string emptiness check. The seven existing required-text predicates
now compare the trimmed text directly with the empty string. This preserves current
validation/readiness semantics; it does not introduce stricter text validation or
automatically authorize work. See the official [SQLite scalar-function definitions](https://www.sqlite.org/lang_corefunc.html).

## Production browser table scenarios

From `apps/desktop`, `npm run test:perf` launches a mock-backed **production** build.
A working supported Chromium/Playwright runtime is required. Discovery or a build
alone must be recorded as **NOT_RUN** for timing; screenshots cannot establish FPS.

Each workload has 2,000 tasks over five epics and twenty stories:

| Workload | Presence | Meaning |
|---|---|---|
| `idle` | No additional synthetic actors | Table/window baseline |
| `quiet-50` | Fifty unscoped online actors | Quiet, unconfirmed task activity; no active rings |
| `scoped-50` | Fifty actors, each scoped to one task | Practical bounded active subset |
| `scoped-stress-2000` | One unique actor per task | Explicit worst-case visible-ring stress; not typical usage |

No actor is given simultaneous task scopes just to pass an animation assertion.
The old M4 fixture treated unscoped presence as active; its historical numbers are
not an equivalent comparison with these truthful-status workloads.

The existing budgets are unchanged: at most sixty mounted rows; A/C long-frame
fraction ≤5%, p95 ≤two calibrated display intervals and long tasks ≤50 ms; B
long-frame fraction ≤15% and long tasks ≤100 ms. The harness calibrates idle rAF,
warms up for one second and samples for three seconds. A wheel-scrolls, B drives
scrollTop at 15,000 px/s, C sends PageDown. An equivalent second pass records a
trace; trace overhead is not mixed into the primary timing sample.

New table outputs default to `.dev-data/perf/table/`, not historical `docs/media`.
`JAM_PERF_OUTPUT` chooses an explicit output directory; `JAM_PERF_PHASE=before`
labels a baseline, with `after` as the default. Compare only identical workloads,
profiles and methodology; preserve raw results rather than substituting a claim
that every supported device will meet the same observed timing.

## Design basis and boundaries

[TanStack Virtual's API](https://tanstack.com/virtual/latest/docs/api/virtualizer)
provides the visible-window/overscan model; the tests preserve that bounded window
rather than replacing it with thousands of mounted rows.
[TanStack Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
informs explicit cancellation when changing projects. Tauri calls may continue in
the backend after cancellation; the frontend assertion is that an old result cannot
overwrite the new project's cache, not that SQLite work was physically aborted.

Keep the 250,000-byte initial gzip JavaScript and 500,000-byte individual-chunk build
budgets intact. These are build-size limits, not page-load measurements. Verify
functional equivalence and project boundaries before interpreting a speedup.
