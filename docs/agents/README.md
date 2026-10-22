# Agent working documentation

This is the maintained map of **what people and agents can do**, how nested interactions behave, and what evidence is needed before a change is called usable. Start here before adding a feature; update these files in the same change.

## Read in this order

1. [Human interaction tree](human-interactions.md): 46 stable route/action-family IDs and nested surfaces.
2. [Agent action/state map](agent-actions.md): all 44 baseline MCP tools, human-only decisions, lifecycle, recovery and handover.
3. [Behavioral and visual acceptance](acceptance-matrix.md): scenario IDs, functional assertions, visual states and honest result recording.
4. [Known gaps / next work](known-gaps.md): observed source causes, planned changes and open choices.
5. [UX evidence and decisions](ux-evidence.md): authoritative web sources applied to this application, not generic styling rules.
6. [Feature-change checklist](feature-checklist.md): the required map/test/documentation update contract.

## Evidence boundary

- Baseline inspected: alpha28, source `2b263795b31767da29db0b62dc81f4da19dfc4d1`, 2026-10-22. Canonical transport and permissions: [MCP contract](../mcp.md). Architecture: [architecture](../architecture.md); decision history: [workflow UX](../workflow-ux.md).
- Alpha29 source candidate: Task Description and true Comments primary; Story Description maps `outcomeMd`; collapsed Agent plan retains mounted editors; scoped in-session drafts. Implementation is present; see the [alpha29 verification record](../verification/0.3.0-alpha.29.md) for actual behavioral checks and pending browser/native evidence.
- Alpha30 source adds inline reference notes, visible frame controls and image pixel-resolution selection; see its verification. Alpha31 integrates notification history, explicit Refine modes, presence freshness and nested select placement as a separate candidate. Alpha32 adds concise empty-column text and a calmer single frame representation; its visual acceptance remains separate. Alpha33 repairs independently reproduced hidden pending/menu/loading interactions. Session streaming is not implemented.
- This documentation audit ran **source inspection and web research**, not new application acceptance tests. Prior exact-version results remain in [verification](../verification/0.3.0-alpha.28.md); do not transfer their pass status to another version/platform.
- Build/type/lint/hash checks establish engineering integrity or artifact identity, not ease of use. A quality claim needs observed behavior and an inspected open-state layout. Browser/mock, DOM, native package and actual-human observations are different evidence classes.

## Invariants to preserve

Human description is not the agent's entire implementation schema. A prepared prompt is not a connected or launched session. Ready is not execution permission. Start is not assignment or process launch. A question answer is not Start approval. A heartbeat is not proof of task work. Release/Pause do not stop external processes. A historical report is persistent board evidence, not a copy of all chat or source files.

## Map ownership and completeness

`human-interactions.md` covers the discovered route/action families, including hidden controls. `agent-actions.md` enumerates the entire 44-tool baseline rather than an illustrative subset. Neither claims to enumerate infinitely many content/state combinations. Every new route, action, agent tool, permission/state transition or hidden layer must add/update an ID and acceptance rows. Maintain existing IDs; mark retired behavior rather than silently reusing identifiers. If a code/contract change and this map disagree, investigate the source/live schema and update both; never invent compatibility or skip permission checks to match prose.

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

[Continue in brain chat](answer-continuation.md) is an explicit copy aid on confirmed
answers and persisted Answered cards. It does not wake a finished client session,
launch a worker, send a chat message or grant execution. CLI/API workspace ideas
remain separate concepts, not implemented connection surfaces.

## Alpha35 feedback and native-found overlay corrections

The [feedback inventory](deltas/feedback35-inventory.md) records 23 inspected action
rows and remaining gaps. The candidate preserves cached editing on read failure,
reports explicit checks, and repairs native-found tooltip/frame/menu/compact-select
issues. See [alpha35 verification](../verification/0.3.0-alpha.35.md); neither a
scoped fix nor an aggregate test count is a whole-application usability pass.

The final local alpha35 source checkpoint passed 749 DOM and 26 Node checks, both
TypeScript configurations, lint/build, and 161 Rust tests (three existing opt-in
volume cases unrun). The 89 prepared browser scenarios remain NOT RUN; exact35
native follow-up is now recorded separately and hosted acceptance remains pending. See verification for the
failed initial checkpoint and its real autosave correction, not only totals.

## Alpha36 reference overlay spacing

The [alpha36 record](../verification/0.3.0-alpha.36.md) addresses an actual native35
toolbar/filter background overlap. Shared normal flow and current bounds replace
fixed vertical offsets. The [alpha35 native addendum](../verification/0.3.0-alpha.35.md#subsequent-exact-alpha35-native-check)
keeps the preceding package's observations and unrun paths attributable; it is not
automatic acceptance of changed source.

Local36 gates passed 752 DOM / 26 Node checks, both TypeScript configurations,
lint/build and version/map checks. Rust source equivalence to35, formatting and
locked metadata were checked without claiming a new full Rust test run. The 93
prepared browser cases and exact36 native rendering are still separate gates.
