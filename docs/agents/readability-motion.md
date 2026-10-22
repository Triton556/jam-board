# Readability and restrained motion — alpha40

[Index](README.md) · [Human action map](human-interactions.md) · [Version evidence](../verification/0.3.0-alpha.40.md)

## Scope and method

The source-level pass starts from alpha39 `72f2278c`, not from the user's live
Windows session. It follows all **46 mapped action families**, including hidden
controls, error/retry and nested confirmation copy. The ledger below records a
source disposition, **not46 manually executed or visually passed flows**.

An AST-assisted index found **935 static JSX text/label/hint/title/placeholder
entries in 68 components (789 distinct strings)** at the baseline. The same
bounded index on the candidate finds **948 entries /802 distinct strings**; short
labelled points create more text fragments. Static paragraphs of 30 or more words
change 7 → 6. These are reproducible inventory counts, not a readability score:
expression-built text, Markdown/prompts, backend/native errors and all content
permutations are not covered by that count. Relevant dynamic authority/recovery
instructions were inspected separately. No automatic translation or rewriting
of existing human text was introduced.

## What changed, and what deliberately did not

- Operation names say what happens: loading the board, creating a project,
  exporting/importing project data. Import still creates another project.
- Ready, Start, Pause and inherited agent identity use short labelled points.
  Technical schemas and full planning prompts remain available and unchanged.
- An unconfirmed write is not labelled failure-before-send or safe-to-retry.
  Draft retention, explicit inspection and no automatic resend stay explicit.
- Activity now distinguishes loading/error/empty/end of loaded history, and a
  failed older page owns its retry. Empty table copy distinguishes filters.
- Shared explanatory text/settings hints and sticky secondary controls become
 13px with comfortable line height. Note body remains 16px. Saved-paper editing gains 12px horizontal / 8px vertical
  padding while keeping compact recovery scrollable. This is not a global
  WCAG/font-size claim; actual wrapping/contrast still needs rendered inspection.
- Pointer pickup lifts only the real Kanban drag overlay (2px,1.015scale,
 0.65°tilt). Creation settles from 6px/0.98 instead of 12px/0.94; the spring is
  more damped. Reduced-motion disables these nonessential transforms and layout
  animation. No fake work pulse, optimistic permission, new mutation, canvas
  transform animation or agent/reviewer activity was added.

No stored content, agent-plan field, MCP tool, schema, execution check or report
was removed. The removed claims are premature history completion, unjustified
agent availability, and misleading operation metaphors—not safety guidance.

## Action-family ledger (source review, not manual acceptance)

| Existing ID | Surface | Disposition |
|---|---|---|
| H-G01 | App rail → Search & commands dialog | Keep clear search/no-match and cold-load/reload-loss warnings; no new command behavior. |
| H-G02 | App → Keyboard shortcuts dialog | Keep actual shortcut names and text-input exclusions; no replacement keyboard-drag claim. |
| H-G03 | App → transient toast or Project notifications bell | Mark these and older as read states the real watermark scope. Keep View, session-only read metadata and partial-history explanation. |
| H-G04 | App → project-name control → Your projects | Keep separate-project and pinned-agent explanation; opening another board is not Pause. |
| H-O01 | `/welcome` → project setup steps | Creating project replaces metaphorical pending copy; name question uses ordinary language. Existing step labels remain. |
| H-P01 | `/plan` → epic rail filter / selected epic | Keep goal → story → task hierarchy; task creation says saved in Backlog rather than the ambiguous Start in Backlog. |
| H-P02 | `/plan/$epicKey` → Overview | Keep visible planning status, appointed Brain and separate reviewer labels. Technical policy remains distinct from execution. |
| H-P03 | Epic → Overview Markdown edit | Keep Write/Preview and saved-versus-draft distinction; secondary guidance grows with shared typography. |
| H-P04 | Epic → Stories tab → story drawer | Human Description stays first; Agent plan guidance explains optional inspection and possibly disabled editing. |
| H-P05 | Epic → Journal tab | Keep Journal read receipt, cached-read warning and filter semantics; no invented caught-up state. |
| H-P06 | Epic → Questions tab | Keep question/answer pending, retained draft, read receipt and no-Start boundary. |
| H-P07 | Epic/story/task → Prepare planning prompt | Workflow instructions explain a task as a piece of work and Start as permission, not waking a chat. Full technical prompt contract remains unchanged. |
| H-P08 | Epic/story → Start action | Replace dense execution paragraph with Ready / Start / Pause / project-switch points, preserving all authority distinctions. |
| H-B01 | `/board` → filter/color controls / columns | Loading board is explicit; quiet motion only on actual pointer pickup or confirmed creation. Existing concise empty columns remain. |
| H-B02 | Board → task card drawer | Keep ordinary keyboard activation, Status/Save and identity-aware return focus. No drag or mutation semantics changed. |
| H-T01 | `/table` → filters / sort / working layer | No tasks to show differs from no filter matches; Clear filters appears only for filters. Cached-error retention remains. |
| H-D01 | Any task entry → task drawer | Keep named Description/Status/Assignee/Priority controls, explicit Save and archived read-only behavior. |
| H-D02 | Task drawer → technical brief | Agent plan remains collapsible; its explanation no longer suggests every human must fill all technical fields. |
| H-D03 | Task drawer → Notes / Comments / History | Keep real Comments, saved Description preview and historical evidence; no translation or rewriting of user text. |
| H-D04 | Task drawer → actions menu | Plain could-not-confirm wording retains reason, inspect-before-retry and no automatic resend; known-not-sent remains separate. |
| H-D05 | Dirty task drawer → navigation/close | Keep Keep editing / Discard and exact draft ownership; no cosmetic deletion of the interruption warning. |
| H-D06 | Concurrent task edit → Review changes dialog | Saved version replaces abstract snapshot in comparison copy; exact fields and conflict choices remain. |
| H-D07 | Task/Board move → readiness dialog | Ready describes the task plan. Details and permission are separate; missing-detail override and captured evidence remain. |
| H-D08 | In-progress task → Release claim / Return to Backlog | Keep Release claim terminology where it names the real operation; nearby text explains assignment clearing and no process stop. |
| H-D09 | Task → report rounds → Request changes dialog | Keep explicit report/criteria/review language and retained choices; historical report is not live chat. |
| H-D10 | Task → linked assets | Keep Link existing/New asset and file picker labels; native OS surfaces remain outside browser styling. |
| H-D11 | Task/story/epic → References → Add reference dialog | Keep source picker / New link / New note nested flow; this linked-reference form is distinct from canvas sticky placement. |
| H-I01 | `/inbox` → question card | Keep answer persistence, retained-draft errors and copy-only continuation explanation; no automatic wake claim. |
| H-I02 | Inbox → execution request → Approve | Keep ordinary answer versus Start approval distinction; execution guidance uses the same clearer permission vocabulary. |
| H-A01 | `/assets` → add/edit asset dialog | Keep File/URL, path and description labels; cached list/read receipt does not imply a successful write. |
| H-R01 | `/references` → Add menu | Placed paper stays a paper; optional heading/body and save state remain. Secondary note controls/state grow from11 to 13px. |
| H-R02 | References → frame selection | Keep visible frame title/grip and descriptive controls; no new canvas transform/compositing animation. |
| H-R03 | References → reference Actions details | Keep exact Actions/Tags/Link targets and opener focus; note editing is direct, non-note caption editing remains a dialog. |
| H-R04 | References → existing note | Keep no-heading persistence, literal Note heading and guarded reopening. Shared body text remains 16px; no Save-form regression. |
| H-R05 | References → image / audio / video / link | Keep actual media retry/fetch/remove labels and missing-file/error feedback; no download or streaming implication. |
| H-R06 | References → Connect mode → edge | Canvas help says card/connection instead of node/edge. Failed label save explains what is retained and what to inspect. |
| H-R07 | References → filter / minimap / zoom / fit | Keep Fit/zoom/filter controls and overview distinction; whole-board native raster clarity is not certified here. |
| H-R08 | References → paste/drop batch | Keep per-file confirmed/unconfirmed/not-attempted receipts and no replay; no broad simplification of safety-critical outcomes. |
| H-M01 | `/team` → Add human / Edit teammate dialog | Plain teammate save uncertainty explains retained text and checking before resubmission; pending locks unchanged. |
| H-M02 | Team → agent task/status / Connect | No activity message reported replaces unsupported Online and ready to help; heartbeat still does not prove work. |
| H-H01 | `/activity` → filters | Never show empty/completed during pending/error. Retry failed older page at its cursor; keep loaded rows and stop automatic error retries. |
| H-S01 | `/settings` → Agents / connection tabs | Labelled identity points explain same-name/inherited connections, separate review and project pinning. Secret masking/tool contract unchanged. |
| H-S02 | Settings → optional workflow guidance | Keep advanced install/preview/private receipt warnings and files-verified versus connected distinction; no new installation. |
| H-S03 | Settings → Your local sketchbook | Project data / Export or import a project / Demo project replace operation metaphors. Import creates a separate project, not a rollback. |
| H-S04 | Settings → Your project | Keep field-save timing, template consequences and immutable-key explanation. |
| H-S05 | Settings → Your board / Paper | In progress limit matches the column. Shared helper text/settings hints grow12to13px with line height; compact metadata is not indiscriminately enlarged. |

## Behavioral and rendered evidence

New actual QueryClient/userEvent probes first reproduced premature Activity
completion/false empty state and an older-page retry silently reading page one.
The corrected tests exercise retained rows, exact cursor, pending retry and
read-only behavior. Additional checks cover genuine/filtered table emptiness and
an agent with no activity message. Pure motion tests check only policy values;
they do not prove pixels. Existing mutation/focus/draft tests remain intact;
text-only expectations now name their intended, plainer messages.

Prepared hosted scenarios hold a real pointer drag, inspect its computed transform
with/without reduced motion, cancel and assert zero task moves. Existing actual
CAS move tests remain. Light/dark narrow-view instructions and failed Activity
read recovery are also exercised. Synthetic PNGs are captured only after those
real states, using exact `sticky-note-*.png` / `readability-*.png` allowlists and
7-day retention; no DB, clipboard, log or private fixture upload is added.
Execution/inspection results belong in the version record, not inferred here.

At freeze, 805 DOM tests and 26 Node tests pass; 103 browser scenarios are listed
but not yet run. The later exact public runtime `e7c37260` completed 103/103
hosted browser cases and both CI jobs successfully; all 12 synthetic PNGs were
inspected. See the [terminal result](../verification/0.3.0-alpha.40.md#terminal-hosted-and-rendered-result--2026-10-22).
These aggregate counts do not mean every family was exercised visually.

Native GUI transport remains unavailable. Browser800px tests are not native
minimum-width1100px evidence. Native/Windows text entry, full nested visual
coverage and fractional-DPI clarity remain explicitly unverified where unrun.

## Primary rationale, not product certification

- [GOV.UK button guidance](https://design-system.service.gov.uk/components/button/):
  name the action in sentence case rather than an unclear metaphor.
- [GOV.UK error messages](https://design-system.service.gov.uk/components/error-message/):
  explain what went wrong and the next useful action; in this app, also preserve
  the distinction between not sent and outcome not yet confirmed.
- [W3C Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
  and [CSS C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39):
  make nonessential movement suppressible through the user's motion preference.

These sources guide design choices; citing them does not establish conformance.
