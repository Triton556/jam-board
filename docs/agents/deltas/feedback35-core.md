# Explicit action feedback — candidate delta (not blanket acceptance)

Base `7d02d2819de1f4432187761bcbba87e124daeef4` (runtime alpha34); separate alpha35 candidate lane. Do not transfer native34 acceptance. This append-only delta is for owner reconciliation into canonical maps.

## Implemented core

- H-I01/P06 / AS02: Questions cached refresh failure keeps the same cards/answer inputs mounted. Explicit Refresh remains available with data; initial read failure is distinct from empty. Real typed answer survives background error and manual recovery without focus movement.
- H-P05 / AS02: Journal keeps last loaded content during failed read. Filtered zero differs from empty history. Refresh reports local pending/completion/error.
- H-T01 / AS02: cached table rows remain visible on read error; retry is read-only and reports its outcome.
- H-P02 / AS01/AS03: PlanningInput blur save exposes pending, acknowledged success, newer-unsaved typing and conservative uncertain outcome. Field/project/lifetime guards reject stale queued dispatch and suppress old receipts. Existing later human refocus→blur retry semantics remain unchanged; no timer replay was added.
- Shared explicit-read receipt is single-flight and checks TanStack's resolved `isError` result, not merely promise fulfillment. Resource/query/filter scope, project ABA and lifetime own the receipt. Success includes local last-checked timestamp (not data-updated time). Background reads never create success receipts. No toast, persisted bell history, focus movement, fake progress, writes or execution grants.

## Evidence

`apps/desktop/src/features/explicit-read-feedback.test.tsx`: nine real-userEvent/deferred DOM cases: repeated clicks, unchanged success, cached answer draft/focus, fulfilled error result, initial failure, preserved Table rows, project/scope ABA, unmount.

`apps/desktop/src/features/planning-input-feedback.test.tsx`: seven deferred userEvent cases for pending/acknowledgement/newer typing, uncertain save, scoped identity/project ABA/lifetime and queued not-sent behavior.

16/16 new tests passed after timestamp adjustment; TypeScript, changed-file Biome and diff checks passed. Before timestamp-only display addition, focused new+existing `planning-drafts`, `route-read-recovery`, `journal-prelude` total33/33 passed; owner must rerun aggregate gate after integration. No full suite/Cargo/browser/native/visual or human acceptance performed by this lane. Happy DOM Table viewport is synthetic, not geometry proof.

## Remaining inventory

The cross-app audit has23 action rows; these core repairs do NOT close all rows. Explicit Assets/References/Bell completion receipts are a separate follow-up. Shared QueryError callers, Plan/Story cached retry receipts, activity pagination announcements, Markdown autosave and broader status changes remain individually scoped work. Copy/continuation/comment existing feedback should not be regressed. Initial empty vs error, clipboard fallback, long-operation uncertainty and agent-presence honesty remain distinct acceptance areas.

## Public UX rationale

[Visibility of system status](https://www.nngroup.com/articles/visibility-system-status/) and [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): understandable timely feedback without focus theft; local accessible state, honest result and retained input for recovery. Technical, visual and human evidence remain separate.
