# Cross-app feedback inventory / alpha35 candidate status

This preserves the original alpha34 action audit rather than treating repaired Refresh buttons as complete application coverage. Canonical map IDs are unchanged; suffixes below identify subcases. Read alongside `feedback35-core.md` and the owner verification record.

## Candidate implemented status

- I01/P06, P05, T01: cached read recovery and explicit read receipt fixed in core candidate; typed-answer and table-row regressions tested.
- P02 PlanningInput autosave: acknowledged pending/saved/newer-unsaved/uncertain feedback added; later deliberate blur retry remains existing behavior.
- A01 Refresh assets, R01/R08 Refresh references, G03 bell Refresh: timestamped explicit success/error receipts added after the core; no background success announcements, no persisted notification entries. Existing pending, cache, pagination and mutation contracts retained.
- Everything else in the baseline table remains a source-confirmed gap, existing behavior to preserve, or separately scoped acceptance item. These rows are NOT blanket pass results.

## Follow-on evidence

`refresh-surfaces.test.tsx`: Assets/References actual userEvent double-click with deferred unchanged success then failure, cache retained and completion does not change the pending focus owner; Assets background/filter receipt behavior. `NotificationBell.test.tsx`: explicit pending/timestamp/error without read-watermark changes, background quiet and close/reopen suppression; all existing pagination, older/latest overlap, stale scope and navigation cases rerun. The References dblClick in Happy DOM naturally leaves focus on the canvas when the second click lands on a disabled button; completion preserves that focus, not a fabricated claim that the button always remains focused.

Empty live-region paragraphs keep margin zero before an action. References explicit receipt now lives inside the measured toolbar so completed Refresh → Add note placement accounts for it; cached/background read notices retain their existing separate area. Source/DOM checks are not native layout proof; visual/native verification remains NOT RUN here.

## Alpha34 baseline inventory (source-confirmed, not all runtime-tested)

Legend: P pending, C confirmed success/no-change, E read/write error, U ambiguous write outcome. Existing IDs retained; slash suffixes are proposed audit subcases, not replacement canonical IDs. “Partial” does not claim all state permutations tested.

| Action ID | Entry/action | Existing feedback | Missing / functional reproduction | Priority |
|---|---|---|---|---|
| I01/P06.refresh | Empty Questions → Refresh | Initial skeleton; error | P/C missing; repeats dispatch; cached error unmount loses answer draft. Reproduced above. `inbox/InboxPage.tsx:250–267` | P1 |
| P05.refresh | Journal empty → Refresh | Initial skeleton; error | P/C missing; repeats dispatch. Cached error replaces journal, filter-empty text indistinguishable from truly empty. `plan/Journal.tsx:153–161` | P1 |
| A01.refresh | Assets → Refresh assets | disabled, aria-busy, P status, retained cache/error | No explicit C for unchanged or changed result; button label static. `assets/AssetsPage.tsx:425–480` | P2 |
| R01/R08.refresh | References → Refresh references | disabled, aria-busy, P status, retained canvas/read warning | No explicit C. `references/ReferencesPage.tsx:1057–1068,1200–1207` | P2 |
| G03.refresh | Bell → Refresh | disabled while latest read; Loading notifications; error; preserved rows; scope fences | No C when nothing new; keep receipt local, never manufacture persisted notification. `notifications/NotificationBell.tsx:291–345` | P2 |
| T01.retry | Table cached error → Retry task list | disabled + Retrying; alert; inline create draft retained | rows intentionally replaced by [] on any tasks.error despite cached data. Failed cached read with visible rows reproduced in alpha34 DOM (synthetic viewport); candidate regression proves retained rows and read-only retry. `table/TaskTable.tsx:385–401` | P1 |
| B01.retry | Board cached error → Try again | QueryRefreshNotice retains subtree, busy status, disabled | No explicit successful check receipt; must treat tasks+members as one owned operation. `board/Board.tsx:441–447` | P2 |
| P01/P02.retry | Plan cached error → Try again | QueryRefreshNotice + preserved editors | No C; scope selected epic differs from list. `plan/PlanPage.tsx:251–263` | P2 |
| P04.retry | Story cached error → Try again / Read latest | cached content retained; QueryRefreshNotice | C not explicit; keep technical/human drafts. `plan/StoryDrawer.tsx:85–95,156` | P2 |
| G04/D01/A01/D10.retry | Shared QueryError → Try again | Alert + button | Alpha34 generic component had no busy prop, disabled state or pending announcement; core35 adds optional busy support. Many callers still need ownership/pending audit; component repair is not whole-app closure. `components/ui/AsyncState.tsx:11–21` | P2 |
| H01.older | Activity → Load earlier events | Loading earlier events text; read error | Loading text lacks live status; error can coexist with empty story/caught-up wording. Need deferred pagination + terminal-error probe. `activity/ActivityPage.tsx:242–269` | P2 |
| G01.reload | Failed command import → Reload app | Explicit failure, unsaved-data warning, reload affordance | Full document reload is terminal/navigation, not a normal read; do not fake Retry or success. `command/CommandLoadBoundary.tsx`, `components/ui/LazyBoundary.tsx` | preserve |
| P07.copy | Refine → Copy planning prompt | Copying, lock, local status, selectable fallback, captured scope | Strong existing pattern; no board write/launch. `plan/BrainHandoff.tsx:48–71,222–230` | preserve |
| I01.continue | Answered → Copy continuation prompt | Copying, receipt, selectable fallback + scope fencing | Strong existing pattern; copy is not send/wake/start. `inbox/AnswerContinuation.tsx` | preserve |
| S01.copy | Settings connection/config/token/path copy | Pending/lock vary by control; local Copied/error notice | Audit all callers before unifying; token secrecy unchanged; no secret reads in audit. `settings/SettingsPage.tsx:125–164,267,331–354,494` | P2 |
| D03.comment | Task comment → Add comment | Posting, Comment added, error/uncertainty, retained scoped draft | Strong reference for local P/C/U; don't add agent-history entry for UI receipt. `task/TaskComments.tsx` | preserve |
| P02.autosave | Epic fields / PlanningInput blur | draft/conflict/error | No P or saved C beside input; apparent preview/value change can precede persistence. `plan/PlanningInput.tsx:29–62` | P2 |
| P03.autosave | Epic Markdown → blur / Ctrl+S | retained draft; error; optional parent save-state | Standalone SavedMarkdown has no own P/C; editor closes immediately before save settles. `plan/PlanningControls.tsx:89–151` | P2 |
| P02/P04.status | Planning status dropdown | disabled pending; error | No text pending/success; ambiguous failure only generic error. `plan/PlanningControls.tsx:29–80` | P2 |
| M01.save | Save teammate | ProjectWriteFeedback + pending lock; explicit unconfirmed draft retention | Success is dialog closure + updated list; don't claim C if follow-up read fails. `team/TeamPage.tsx:100–123` | preserve/test |
| R04.create | Inline note Save / Refresh after uncertainty | scoped pending, retained uncertain draft; explicit checking references | Read is reconciliation, not replay or proof save failed; preserve no automatic retry. `references/DraftNote.tsx` | preserve/test |
| B01/T01/A01/R07.filter | Synchronous filters | selected state; some no-match text/reset | No artificial loading needed; distinguish filtered none from truly empty, no toast per keystroke. Journal currently violates distinction. | P2 |
| M02/activity | Agent status / heartbeat | Timestamp/freshness components and polling | Never equate refresh completion/heartbeat/Ready/answer with agent work or session launch. Source review only. | preserve |


Final candidate focused run:61/61 across eight files passed (`explicit-read-feedback`, `planning-input-feedback`, `planning-drafts`, `route-read-recovery`, `journal-prelude`, `refresh-surfaces`, `references/inline-note`, `notifications/NotificationBell`), serial workers. TypeScript, changed-file Biome and diff checks passed. Full suite, Cargo, browser/native layout and human acceptance remain owner gates, not run by this lane.

### Narrow review corrections

- Explicit References receipt moved into the measured toolbar; completed Refresh → Add note layout now includes its actual height. Added two light/dark800×600 browser scenarios asserting toolbar/receipt/draft bounds, title hit-testing/focus and unchanged persisted canvas after cancel. Prepared/typechecked only; browser/native execution remains NOT RUN. Background/cached error notice geometry and dynamic viewport changes remain separate acceptance.
- PlanningInput refuses dispatch without a real captured project ID, including blur after app cache removal; dedicated userEvent form test expects zero save calls and visible not-sent retained draft. An absent ID is not a valid project binding.
- T01 baseline row now records its actual executed alpha34 reproduction and candidate regression; shared QueryError's new optional busy support is distinguished from unclosed caller-level audit.

Review-correction checks:11/11 focused DOM cases passed; source and e2e TypeScript, changed-file Biome and diff checks passed. No browser/native execution.
