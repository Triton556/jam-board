# Feature-change checklist

[Index](README.md) · Applies to every new feature and meaningful behavior repair.

## Before implementation

- [ ] State the person's goal in ordinary language; name the current inconvenience and next safe action.
- [ ] Identify baseline commit/version and applicable H-* / AG* / acceptance IDs. Add a new stable ID if absent.
- [ ] Record actor (human/brain/worker), exact project/entity scope, allowed mutations, forbidden side effects and persistence/retention.
- [ ] Draw base → revealed surface → child surface → success/error/loading/empty/stale/retry; include keyboard and route return paths.
- [ ] For async work, define before-dispatch cancellation vs already-dispatched uncertain result, duplicate guard and reconciliation. A→B→A is not the same selection epoch.
- [ ] Check [UX evidence](ux-evidence.md); justify a departure rather than blindly copying another design system's appearance.

## During implementation

- [ ] Update [human map](human-interactions.md), [agent map](agent-actions.md), [known gaps](known-gaps.md) and relevant [acceptance](acceptance-matrix.md) in the same change; label implemented/WIP/proposed separately.
- [ ] Keep technical structure, permission checks, evidence/report history and existing data semantics intact unless explicitly part of the feature.
- [ ] Include focus entry/trap/return, Escape depth, Back/Forward, dirty and pending policies; preserve drafts on failure and collapse.
- [ ] Include responsive/zoom/DPI, long content, empty vs failed reads, dark/light and reduced motion.
- [ ] No automatic retry of an ambiguous mutation; no substituting fresh validators into an old decision.
- [ ] Test names or adjacent comments include stable scenario IDs; cite test path in the acceptance record.

## Before claiming usable

- [ ] Exercise the complete user goal, not only presence of a button or a snapshot hash.
- [ ] Execute interrupted/repeated flows and affected neighbor paths; check saved state and expected side effects.
- [ ] Inspect screenshots of **open** nested surfaces, with errors/pending/long text, both themes; record gaps/overflow/focus visibility.
- [ ] Use native exact-package checks for native picker, file/drop, OS scaling or platform-specific claims. DOM/mock evidence must stay labeled.
- [ ] Report PASS / FAIL / NOT RUN / BLOCKED per scenario with exact source/package/platform and evidence. A build green cannot replace any unrun UX row.
- [ ] If source changes after validation, rerun affected tests. Record limitations and non-regression surfaces explicitly.
- [ ] Update version status and remaining gaps. Keep historical failures attributable to their original version.

## Reusable change record

```text
Feature / version / source:
Person's goal:
Actor and authorization:
Human paths / agent states changed:
New depth or native boundary:
Data retained / changed:
Async and stale-result behavior:
Acceptance IDs and test paths:
Functional observed result:
Visual states inspected (theme / viewport / canvas zoom / OS scale):
Native evidence or NOT RUN reason:
Known gaps / next action / owner:
```

This checklist does not authorize accessing a user's live app, worker sessions, data, or external services. Prefer disposable fictional fixtures within the authorized environment.
