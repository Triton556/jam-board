# Card activity feedback candidate

Source base: `fcf5e4f` (alpha29); separate source candidate, not a new accepted native package. The integration owner mounts `useMemberPresenceRefresh()` once in `Root`; the standalone hook alone does not change application refresh behavior.

## What the card can honestly say

- Existing claimed agent + recent exact-task status: existing active feedback, including reduced-motion behavior. No changed claim/role/Start permissions.
- In progress, no assignee: **Execution unconfirmed**. A retained assignee ID missing from current members is instead **Assigned member unavailable · execution unconfirmed**.
- Agent holder without a usable fresh activity signal: **Name · task activity unconfirmed**. A human holder is **Assigned to Name**, not an agent-working assertion.
- Review: **Awaiting review**. Report submission retains the old worker as assignee; the service prohibits that actor from reviewing its own task/report, so its implementation status must not animate Review.
- A fresh exact-task status from a different actor can add **Name last reported N min ago: status**, always static. The tooltip includes the exact status timestamp. This is historical self-reported task activity, not confirmed review, execution ownership or evidence that a Brain took a claim. No review-entry/report timestamp is available on TaskSummary, so we do not imply post-report review activity.
- Ready, Backlog and Done do not gain active/working feedback. Heartbeat alone never creates activity.

TaskCard uses the new card-specific resolver. Existing detail/table `agentWorking` behavior is unchanged. Generic actor reports do not wrap the assignee avatar in that actor's working ring. No per-card timer or rapid live-region announcement is added.

## Heartbeat-only refresh

A current-project external stdio heartbeat updates `project_members.last_seen_at` without adding a domain event. The native event feed emits BoardChanged only for nonempty events. The app's `staleTime: Infinity` does not automatically refresh that member cache on ordinary focus return.

A library-only QueryObserver probe using actual installed TanStack Query reproduced unchanged cached timestamps after a heartbeat-only fixture update and focus false→true; explicit invalidation refreshed the cache. This establishes the cache mechanism, not the cause of the user's observed minimize/restore behavior.

The standalone hook has one visible/current-project 30-second timer and an immediate read on visibility return. It coalesces pending reads, skips an already fetching members query, and subscribes synchronously to project identity changes to track A→B→A epochs. Before publishing it verifies mount, visibility, epoch, project and no newer member cache update or query request. Hidden/unmount stops scheduling and invalidates pending publications. Errors retain cached data; expiry remains driven by the existing shared clock. It emits no domain events and does not claim a failed read proves an agent offline.

## Evidence and limits

2026-10-22 cloud fixture evidence, single-worker focused tests:
- `src/lib/card-presence.test.ts` + `src/features/agent-working.test.tsx`: **31 PASS** (pure + DOM).
- `src/lib/use-member-presence-refresh.test.ts`: **10 PASS** (fake timers + QueryClient; heartbeat cadence, visible return, hidden/unmount/ABA late replies, same-ID app refresh, newer cache/query, error recovery and single flight).
- Scoped Biome checks and `git diff --check`: **PASS**.

Root integration, integrated full suite/typecheck, actual native visibility/minimize/restore, Windows rendering, light/dark open layout and human readability are **NOT RUN in this lane**. IntersectionObserver currently pauses animation for offscreen cards; it does not remove the status line. No animation-gating defect was reproduced here. Missing text and paused animation remain separate diagnostic branches.

## Independent review correction (2026-10-22, 08:59 UTC)

The initial `17e978d` hook had a confirmed cache overwrite race: a newer member observation that is structurally identical in the same millisecond preserves both the data reference and `dataUpdatedAt`. A pending older poll could therefore overwrite it. This defect was independently reproduced and is not evidence about the user's native incident.

The corrected publication guard captures the exact query object, QueryState object and monotonic `dataUpdateCount`, plus a cache lifecycle generation for member-query add/remove events. All must still match before publication, in addition to the original project/ABA/visibility/mount/query-in-flight checks. The lifecycle generation also rejects an absent→created→removed cache cycle, where both endpoint query identities would otherwise be absent.

Deterministic same-millisecond regression: **RED against 17e978d**, **GREEN against corrected source**. Added query removal/recreation, initially absent query with/without intervening lifecycle, and project ABA with an absent query. Final focused run: **46 PASS / 3 files**, including **15 hook tests**, `--maxWorkers=1`, 1.99 seconds. Scoped Biome and diff checks pass. Earlier 10-hook-test result did not cover this race. Integrated typecheck/full suite and native visible/restore/reduced-motion acceptance remain pending with the integration owner.

## Alpha35: live card-tooltip content

The exact alpha34 native Linux fixture observed the intended 30-second heartbeat
refresh and later 120-second activity expiry without navigation. However, a
stationary pointer kept WebKit's already-open native `title` popup showing the old
state in both directions. Moving away and hovering again showed the correct text.
This is tooltip freshness, not stale task data or proof of the user's earlier
Windows incident.

The Board `WorkingLine` now uses the existing React-rendered Tooltip. Its open
content follows the same current state as the visible label, and changed text
recomputes the tooltip position. The outer line dimensions, card identity and
activation remain unchanged; no timers, claims, reads or writes were added. This
repair is scoped to the Board label, not a redesign of all native-title tooltips.

Four new DOM probes cover stationary-hover updates/expiry, card focus/activation,
unmount cleanup and synthetic longer-text positioning; **23 focused tests pass**
including existing activity behavior. Synthetic coordinates are not native layout
proof. Exact alpha35 hover/geometry acceptance remains pending.

Two additional hosted-browser scenarios (light/dark) hold the pointer still across
fresh/expired mock status updates, inspect real tooltip bounds, compare the task
record before/after and save screenshots. They are added/typechecked, **NOT RUN**
locally; mock status injection is not a real external-agent heartbeat or AI session.
