# Agent working documentation

This is the maintained map of **what people and agents can do**, how nested interactions behave, and what evidence is needed before a change is called usable. Start here before adding a feature; update these files in the same change.

## Read in this order

1. [Human interaction tree](human-interactions.md): 86 stable route/action-family IDs (46 original plus BD01-BD24 and R09-R24, including the round-5 inventory and round-7 additions) and nested surfaces.
2. [Agent action/state map](agent-actions.md): all 52 current MCP tools, human-only decisions, lifecycle, recovery and handover.
3. [Behavioral and visual acceptance](acceptance-matrix.md): scenario IDs, functional assertions, visual states and honest result recording.
4. [Known gaps / next work](known-gaps.md): observed source causes, planned changes and open choices.
5. [UX evidence and decisions](ux-evidence.md): authoritative web sources applied to this application, not generic styling rules.
6. [Feature-change checklist](feature-checklist.md): the required map/test/documentation update contract.

## Evidence boundary

- Baseline inspected: alpha28, source `2b263795b31767da29db0b62dc81f4da19dfc4d1`, 2026-10-22. Canonical transport and permissions: [MCP contract](../mcp.md). Architecture: [architecture](../architecture.md); decision history: [workflow UX](../workflow-ux.md).
- Alpha29 source candidate: Task Description and true Comments primary; Story Description maps `outcomeMd`; collapsed Agent plan retains mounted editors; scoped in-session drafts. Implementation is present; see the [alpha29 verification record](../verification/0.3.0-alpha.29.md) for actual behavioral checks and pending browser/native evidence.
- Alpha30 source adds inline reference notes, visible frame controls and image pixel-resolution selection; see its verification. Alpha31 integrates notification history, explicit Refine modes, presence freshness and nested select placement as a separate candidate. Alpha32 adds concise empty-column text and a calmer single frame representation; its visual acceptance remains separate. Alpha33 repairs independently reproduced hidden pending/menu/loading interactions. At that alpha33 checkpoint session streaming was not implemented; the later brain dock includes streaming.
- This documentation audit ran **source inspection and web research**, not new application acceptance tests. Prior exact-version results remain in [verification](../verification/0.3.0-alpha.28.md); do not transfer their pass status to another version/platform.
- Build/type/lint/hash checks establish engineering integrity or artifact identity, not ease of use. A quality claim needs observed behavior and an inspected open-state layout. Browser/mock, DOM, native package and actual-human observations are different evidence classes.

## Current readability and movement pass

[Alpha40 ledger](readability-motion.md) covers all 46 mapped families as source review,
with explicit functional/rendered evidence boundaries. See its version record for
actual terminal gates; historical appendices below retain their original status.

## Invariants to preserve

Human description is not the agent's entire implementation schema. A prepared prompt is not a connected or launched session. Ready is not execution permission. Start is not assignment or process launch. A question answer is not Start approval. A heartbeat is not proof of task work. Release/Pause do not stop external processes. A historical report is persistent board evidence, not a copy of all chat or source files.

## Map ownership and completeness

`human-interactions.md` covers the discovered route/action families, including hidden controls. `agent-actions.md` enumerates the entire 52-tool current inventory rather than an illustrative subset. Neither claims to enumerate infinitely many content/state combinations. Every new route, action, agent tool, permission/state transition or hidden layer must add/update an ID and acceptance rows. Maintain existing IDs; mark retired behavior rather than silently reusing identifiers. If a code/contract change and this map disagree, investigate the source/live schema and update both; never invent compatibility or skip permission checks to match prose.

## Alpha29 validation handoff (2026-10-22)

Implementation owner reports **539 DOM tests passed**, including 30 new behavior probes. Four new functional-browser scenarios were added/typechecked but **not executed** at this checkpoint. This documentation author did not rerun those tests; the release verification record must supply final source/version and exact terminal evidence. DOM success does not establish native pixel geometry, Windows GUI behavior or browser visual acceptance. These results apply to human-first Task/Story work, not proposed frames/notes/bell/zoom/prompt features.

## Feature contracts

- [Refine modes and local request](refinement-modes.md)
- [Persisted project notifications](notification-history.md)
- [Card presence and cache freshness](../live-card-presence.md)
- [Nested select placement and disclosure ink](overlay-placement.md)

`node --test scripts/check-interaction-map.test.mjs` checks canonical table
definitions for duplicate stable IDs. It is documentation integrity, not usability
acceptance, and does not validate every possible state or model response.

## Saved-answer continuation (alpha34)

[Continue in brain chat](answer-continuation.md) began as an explicit copy aid on
confirmed answers and persisted Answered cards in alpha34. The current
[brain dock](../brain-dock.md) adds a primary compose action that stages a scoped
continuation; it still does not auto-send, wake a turn or grant execution.

## Alpha35 feedback and native-found overlay corrections

The [feedback inventory](deltas/feedback35-inventory.md) records 23 inspected action
rows and remaining gaps. The candidate preserves cached editing on read failure,
reports explicit checks, and repairs native-found tooltip/frame/menu/compact-select
issues. See [alpha35 verification](../verification/0.3.0-alpha.35.md); neither a
scoped fix nor an aggregate test count is a whole-application usability pass.

The final local alpha35 source checkpoint passed 749 DOM and 26 Node checks, both
TypeScript configurations, lint/build, and 161 Rust tests (three existing opt-in
volume cases unrun). The later exact35 hosted run passed Windows and **86/89** Linux browser scenarios;
it was not green overall. Alpha37 addresses the three diagnosed failures, with
its hosted rerun still pending. Exact35 native follow-up is recorded separately.
See verification for the failed initial checkpoint and its real autosave
correction, not only totals.

## Alpha36 reference overlay spacing

The [alpha36 record](../verification/0.3.0-alpha.36.md) addresses an actual native35
toolbar/filter background overlap. Shared normal flow and current bounds replace
fixed vertical offsets. The [alpha35 native addendum](../verification/0.3.0-alpha.35.md#subsequent-exact-alpha35-native-check)
keeps the preceding package's observations and unrun paths attributable; it is not
automatic acceptance of changed source.

Local36 gates passed 752 DOM / 26 Node checks, both TypeScript configurations,
lint/build and version/map checks. Rust source equivalence to35, formatting and
locked metadata were checked without claiming a new full Rust test run. The 93
prepared browser cases remain unrun on that source. Exact36 native checks later
observed separated controls in Light/Dark at 1180px, plus bounded blank-gap pan
and filter behavior. Minimum-window checks were stopped by unavailable native
tool transport; this is not a whole-canvas or Windows GUI pass.

## Alpha38 direct paper candidate

The user rejected the alpha30–36 canvas form as still feeling modal. The new
[direct-note contract](direct-sticky-notes.md) supersedes that creation/editing
path: placement, immediate writing, optional persisted heading and guarded
autosave. Existing media/result cards are not silently rewritten. Read the
[alpha38 verification record](../verification/0.3.0-alpha.38.md) for its checkpoint gates;
a source implementation or a prepared screenshot test is not visual acceptance.

At the alpha38 freeze, local integration passed 792 DOM / 26 Node / 178 Rust
checks, both frontend typechecks, actual binding export and isolated stdio smoke.
Its 96 hosted-browser scenarios and actual-paper screenshots were still pending;
see the [exact verification boundary](../verification/0.3.0-alpha.38.md).

The historical alpha38 pending statement above is superseded for the repaired
alpha39 runtime by [its terminal record](../verification/0.3.0-alpha.39.md):
Linux96/96 and Windows green; six actual synthetic paper PNGs inspected.
This does not convert native-unrun cases into passes. Alpha40 has separate gates.

## Alpha40 verified runtime checkpoint

The [46-family readability ledger](readability-motion.md) records the source audit
and its limits. Exact public runtime `e7c37260` completed Linux **103/103 browser**
and Windows **178 Rust /805 DOM plus debug desktop build** successfully. Twelve
actual synthetic screenshots were inspected, covering paper creation/heading/reopen,
restrained pickup/reduced motion and narrow Light/Dark guidance. See the
[terminal evidence](../verification/0.3.0-alpha.40.md#terminal-hosted-and-rendered-result--2026-10-22).
This supersedes the browser-pending checkpoint statements for the tested runtime,
not the separate unrun native, real-agent or exhaustive visual cases.

## Alpha41 standalone board guidance and connection

The app now owns its optional skill and serves the same source through MCP guide
resources. Settings has a neutral **Connect agent to board** copy flow; setup does
not appoint a brain or start work. The folder hint is scoped to the board and is
not its identity. The legacy full-playbook installer is replaced by a bundled
project-scope install with review, preservation checks and outside-catalog backup.
See [alpha41 verification](../verification/0.3.0-alpha.41.md) for actual results and
blocked browser/native checks; do not transfer alpha40 pixel acceptance.

## Current brain-dock increment

[Brain dock](../brain-dock.md) is the authoritative contract for the implemented
ACP chat, terminal and built-in API runtimes. The UI reaches the Tauri adapter and
`jam-agents`; every runtime is project-pinned and uses ordinary MCP permissions.
Board Refine/Continue/Ask brain actions stage composer drafts, never automatic
Send or Start. Settings groups dock profiles before the external MCP disclosure.

The human map includes BD01-BD24; the agent map includes AG15-AG18.
[UX01-UX09 and BC01-BC14](acceptance-matrix.md#brain-dock-increment-acceptance-current-source-browsernative-qa-pending)
cover board entry points, canvas/Inbox/task layout and every nested dock surface.
Round-7 fake, DOM and Chromium/mock results are recorded in worker handoffs;
they do not substitute for exact-version packaged/native or live-provider QA.
[Known gaps](known-gaps.md#brain-dock-integration-boundary) records live-provider,
packaged cleanup, terminal rendering confirmation and live-adapter limits. Historical 46-family
and alpha40/41 results retain their exact source boundary, not this increment's
acceptance. The seven canvas organization tools plus unlink_reference bring the current MCP inventory to 52.
