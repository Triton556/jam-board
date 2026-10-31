# UX evidence → concrete decisions

[Index](README.md). Web research accessed **2026-10-22**. Sources below inform design; none independently tested Jam Board. “Application” is our inference, not a quoted requirement. Keep the paper/handwritten/chibi identity while improving task clarity and manipulation. No new UI library is implied.

| ID / authoritative source | Supported principle | Application and acceptance |
|---|---|---|
| UX01 — Jakob Nielsen, [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/), published 2006-12-03 | Prioritize frequent actions; reveal advanced options when needed. | Task Description/Comments primary, structured Agent plan secondary. Do not delete hidden data or hide urgent readiness errors. HF01–HF04. |
| UX02 — W3C APG, [Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), living guidance | Focus enters/loops within dialog; Escape dismisses; return to opener or logical replacement; long content may need initial static heading focus. | Test every nested depth and disappearing opener, not only the first modal. Report reading should not start scrolled past its evidence. KB01–KB03, H-D09/D11. Pending writes need explicit status and honest inability to cancel, not silent Escape failure. |
| UX03 — GOV.UK Design System, [Fieldset](https://design-system.service.gov.uk/components/fieldset/), living guidance | Related inputs need meaningful grouping and labels. | Group title/content, technical lists, evidence and actions using consistent form spacing. Preserve this app's typography rather than copying GOV.UK visual style. VS01, H-R01/R03. |
| UX04 — GOV.UK Design System, [Error message](https://design-system.service.gov.uk/components/error-message/), living guidance | Explain correction near invalid input, retain entered values; distinguish invalid input from service/permission problems. | A failed reference save keeps the draft and explains recovery inside its dialog; do not show only a disappearing global toast. AS01/AS02, VS01. |
| UX05 — IBM Carbon, [Notifications](https://www.carbondesignsystem.com/building-blocks/core/patterns/notifications), updated 2026-08-12 | Feedback should be relevant and contextual; panels allow later reading without a screen full of persistent toasts; actionable notifications need time to act. Carbon explicitly notes panel guidance still needs iteration. | Proposed bell complements rather than replaces transient notices and Activity. Define scope/retention, chronological records, deduplication and exact View destination. NT01; do not claim Carbon proves this particular implementation usable. |
| UX06 — React Flow, [Utility Classes](https://reactflow.dev/learn/customization/utility-classes), updated 2026-10-11 | `nodrag`, `nopan`, `nowheel` separate embedded controls/scrolling from canvas gestures. | Explicit generous frame grip; inline note typing must not drag, pan, zoom or delete surrounding nodes. RF02/RF03. Validate against installed library version; docs do not establish actual native hit geometry. |
| UX07 — React Flow, [NodeResizer](https://reactflow.dev/api-reference/components/node-resizer), living API docs | Resize visibility, minimum dimensions, handle styles and zoom-related scaling are configurable. | Inspect usable grip/resize controls at low and high zoom; preserve image aspect ratio where appropriate. RF02, VS03. Documentation alone cannot prove touch/keyboard/pointer usability. |
| UX08 — W3C, [Understanding Target Size (Minimum), WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | 24×24 CSS-pixel minimum or specified exceptions; larger targets can still be more usable. | Measure frame action targets/grips in rendered CSS pixels with spacing, not just source width. A formal exception is not evidence the control feels easy. RF02, VS03. No blanket conformance claim. |
| UX09 — W3C, [Understanding Reflow, WCAG 2.2 SC 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Enlarged text should remain readable without unnecessary two-axis scrolling; essential two-dimensional content has a limited exception. | Canvas may pan in two dimensions; its ordinary dialog text/forms still need usable wrapping. 200% smoke is not full reflow conformance; add 320-CSS-pixel equivalent checks for ordinary content. VS02. |

## Product decisions, not imported rules

- **Direct manipulation:** Add note should reveal editable content at the canvas location rather than force a separate composition dialog. User goal and existing canvas architecture motivate this proposal; RF03 must validate creation/cancel/failure semantics before acceptance.
- **Visible result:** successful frame creation must remove the truly-empty illustration; filter-no-match and read failure must not look like an untouched board.
- **Human-readable safety:** show captured project/scope and concrete consequence in Start/Release/Review. Advanced plan details may collapse, but authorization and evidence needed for a consequential decision must stay discoverable.
- **Minimal interruption:** ordinary updates should not steal editing focus; errors belong near attempted action; notification history provides a later-reading path.
- **Honest activity:** status/heartbeat/report events are distinct from live session output. Do not animate nonexistent work or label a Ready brief as a claimed task.

## Research maintenance

For future design changes add source URL, publication/update date if available, access date, a short supported principle, the actual Jam Board decision and stable test IDs. Do not send private task text, account details or repository secrets to web search. If a source changes, evaluate the relevant behavior rather than mechanically updating styles. Accessibility and usability require testing the implementation, not citing guidance.

## Frame grouping and state distinction (alpha32 candidate)

[Figma frames](https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design)
clarify the container role; [Atlassian border guidance](https://atlassian.design/foundations/border)
distinguishes ordinary boundaries from interaction/state emphasis. Applied here:
a restrained single frame outline and paper title, with stronger selected/focus
cues and unchanged child/canvas gestures. These sources justify hierarchy, not a
claim that our actual rendered frame is visually accepted. Native light/dark and
low-zoom title/control overlap remain explicit acceptance checks.

## Round 11 product decisions and observed evidence (2026-10-30)

No new web research in G2. The [design](../../test-visuals/round11/design.md), [common overrides](../../test-visuals/round11/common.md) and reports are product/test evidence, not external standards.

- H-PF01–PF05: one merged list, real display names, quiet storage paths; native duplicate-ID radios and one matching primary action. Remove only registry, Locate validates identity first. U reports 36 inspected mock PNGs; G1 persisted missing-folder names are subsequently exercised by G3.
- H-PF06–PF10: preview, human-unit inventory/steps; receipts/revisions in Details, urgent errors visible. Rules use short help/conflict-only Reload. Recovery explains compare/keep/restore and safety backup. G3 verifies integrated recovery and the final Polish 1 stepper/status behavior below.
- H-TF01–TF08: explicit copy/link ownership, per-task roles, compact singular role/Open/More, no healthy OK clutter; amber Missing/red Unreadable explanations; URL badge/host tooltip/no Reveal. T reports 20 inspected mock PNGs; warning contrast 6.68:1/5.96:1 Light and 8.42:1/6.09:1 Dark, not whole-app WCAG conformance.
- H-TV01–TV03: one mounted editor preserves intent/history; nested Escape/Tab/origin return tested. M reports 16 inspected mock PNGs, 1440 Light/Dark, 1000, 375. Subsequent G3 screenshots verify the corrected mouse/keyboard focus and shared 375 header.

### Final G3 and Polish 1 evidence (2026-10-31)

These are reported G3 observations; G2 read the reports/logs without re-inspecting PNGs. No new web research or external-standard claim.

- H-PF07/PF08, FQ07/FQ08: running shows one step-specific line (for example **Copying files…**) and no footer actions. Interrupted heading is **Move interrupted while copying files**; body **Your board is still safe in its old place. Resume to continue, or roll back to undo.** Close / Roll back / Resume appear only after interruption; complete/rolled back shows Done. No live file counts or Cancel invented. Raw diagnostic remains in Details after the response. [Move tests](../../apps/desktop/src/features/projects/ProjectFolderDialog.test.tsx), [browser spec](../../apps/desktop/e2e/round11-recovery.spec.ts), [running Light](../../test-visuals/round11/R11-G3/polish/move-progress-1440-light.png), [interrupted Dark](../../test-visuals/round11/R11-G3/polish/move-interrupted-1440-dark.png).
- Stepper: completed checks, coral current dot/weight with aria-current, outlined future circles; thin decorative connectors have equal margins and are hidden from screen readers. Labels stay single-line at 1000/1440; 375 uses a vertical list without connectors. Undefined color-token failure was found by G3's image inspection, repaired and all 13 final PNGs re-shot. [Narrow running](../../test-visuals/round11/R11-G3/polish/move-progress-375-light.png), [1000 interrupted](../../test-visuals/round11/R11-G3/polish/move-interrupted-1000-light.png).
- H-G01/G04, FQ30/FQ32: More board actions at 375 has labeled New task, Inbox/count, Search/Ctrl K, real agent names/status. Arrows wrap, Home/End jump, Tab exits, outside click dismisses, Escape restores More focus; agent detail consumes the first Escape. Project controls wait for initial selection acceptance. [Six menu tests](../../apps/desktop/src/features/board/TopbarActions.test.tsx), [labeled menu PNG](../../test-visuals/round11/R11-G3/polish/topbar-actions-375-light.png), [shared integration](../../apps/desktop/src/features/round11-integration.test.tsx).
- H-S01/A01/TF08, FQ24/FQ19: connection prompt uses saved workingDirectory with legacy-hint fallback, not a retargeted board anchor. Assets explicit Refresh reports either read failure; asset alert precedence avoids duplicate diagnostics while standalone file-role failures stay visible. [Connection tests](../../apps/desktop/src/features/board-connect.test.tsx), [Assets implementation](../../apps/desktop/src/features/assets/AssetsPage.tsx), [G3 routing notes](../../test-visuals/round11/R11-G3/report.md#documentation-routing-and-remaining-boundaries).
- H-TV02/PF04, FQ21/FQ04: mouse-open task has no container outline, Tab rings Copy task key; missing folders show their retained real name, not UUID. [Mouse PNG](../../test-visuals/round11/R11-G3/modal-mouse-1440-light.png), [Tab PNG](../../test-visuals/round11/R11-G3/modal-tab-1440-dark.png), [missing-folder PNG](../../test-visuals/round11/R11-G3/projects-missing-375-light.png), [browser assertions](../../apps/desktop/e2e/round11-recovery.spec.ts).

G3 reports 29 initial and 13 final polish PNGs inspected. Final whole DOM log is **175 files / 1,365 tests passed**, superseding the stale POLISH PENDING line. Pre-polish full browser 156/156 is distinct from polish's 47 unique affected cases and nine repeated executions after the connector fix. [Polish log](../../test-visuals/round11/R11-G3/polish/vitest-full.log), [verification boundaries](../verification/round11.md). Native pickers/DPI, packaging, Linux clippy and real agents remain NOT RUN.

[Package logs/boundaries](../verification/round11.md) distinguish reported Rust/DOM/Chromium/mock from unrun native/package/real-agent acceptance. Historical external guidance above was not revalidated; no new current-specification claim.
