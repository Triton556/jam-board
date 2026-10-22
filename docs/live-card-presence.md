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
