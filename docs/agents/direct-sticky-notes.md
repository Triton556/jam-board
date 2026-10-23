# Direct sticky notes (alpha38 candidate)

This replaces the alpha30–36 local **creation form** on References with an actual
editable paper. It is a human interaction, not a new agent tool or agent launcher.
Shared interaction IDs: **H-R01**, **H-R04**, **H-R07**; acceptance **RF03**, **VS01**,
**VS03**, project/draft failure matrix. The release owner maintains the canonical
maps and exact version/checkpoint attribution.

## Human path

1. **Add → Note** arms placement. Click the canvas, or press Enter to place in view;
   Escape cancels placement without writing anything. The camera may move to 100%
   to keep the real 240×180 paper readable below the measured controls stack.
2. The paper's body is immediately focused. Write directly; **Add heading** is
   optional. There is no Title/Note/Save form. A new body-only paper stores an explicit empty title, which stays empty after
   reload. Literal `Note` headings remain exact and editable. Existing legacy Note
   titles are not rewritten or guessed away. Quiet Note kind labels are display
   fallbacks only, never persisted in place of an intentional empty title. Body/heading text is not
   translated or rewritten. New notes remain unframed, even if placed over a frame.
3. Nonblank heading or body saves after 800ms idle, or on leaving editing/Escape. Pending
   creation has one identity-less request: newer typing remains in the same focused
   editor, then updates only the ID returned by the confirmed create. No duplicate
   create is inferred from matching text. A heading alone saves with an empty caption, never copied into body. Empty/whitespace
   heading AND body disappear on
   Escape or leaving; no database row is created.
4. Open a saved note with its Edit note button (keyboard/assistive activation),
   Actions → Edit note, or double-click its ordinary body. Edit the same
   note directly, with the same guarded autosave. Existing Markdown links keep
   their own action. Non-note media and agent result cards are unchanged. Clearing
   an existing body intentionally saves an empty caption, not an archive, delete
   or new note. Clearing heading as well preserves the same intentionally blank
   saved paper. Identity and geometry remain.
5. The small state says Unsaved, Saving, Saved, changed elsewhere, or unconfirmed.
   It is not proof of model execution. Body selection/caret do not drag the canvas;
   ordinary paper/header dragging resumes after editing. A new local paper can be
   repositioned before dispatch; its grip is locked during first create and until
   the confirmed editor ends, so the submitted position cannot silently diverge.

## Ownership and recovery

- One synchronous flight per paper. Blur, debounce, shortcut and route navigation
  share it. A deliberate navigation waits for the same save, including newer text;
  a failed/unconfirmed flush keeps the paper instead of discarding its draft.
- Current project identity, selection epoch (including A→B→A), mounted lifetime and
  note identity gate dispatch and acknowledgement. A departed result cannot close
  a replacement paper, steal focus, queue another save or publish into a new scope.
- A missing project before dispatch is **not sent**, distinct from an API call
  whose response is missing. A synchronous transport throw releases the flight
  lock, but does not authorize replay.
- Observed remote title/body change pauses autosave and retains human text. Reads
  are safe recovery: **Check latest** never writes. If a known-ID read exactly
  confirms retained text, it can acknowledge Saved. Otherwise show both versions;
  **Save my retained text** is a fresh intentional guarded write, **Use latest text**
  explicitly discards the local draft after confirmation.
- An unknown create result has no reliable ID. No text matching, guessed dedupe,
  automatic retry or automatic deletion is performed. Keep/copy the text, inspect
  the board, and deliberately discard only the local paper if appropriate. A
  server event may render the created note before its command reply; the local
  paper is not merged until its returned ID is known. A transient duplicate visual
  is preferable to editing an unrelated note with coincidentally identical text.
- Once a confirmed ID is known, the local editor temporarily suppresses that exact
  board node until it finishes. The textarea and newer typing survive that handoff.
- Confirmed save and failed subsequent read are separate. A returned error can
  follow a server commit; nothing here promises cancellation, rollback or idempotency.

- Active persisted editors survive overview zoom, remote frame collapse, and a
  missing note in a later read. A missing row is a retained local snapshot, not a
  restored record; its text is copyable and saves pause. Snapshot retention is
  project-bound. Same-note and containing-frame destructive actions wait until
  editing is finished or explicitly abandoned; unrelated media is unchanged.
- If reads keep failing, **Discard my edits** warns to keep a copy, discards only
  local text and releases navigation without retry, rollback, archive or recreate.
  Reopening and typing a new draft re-arms the route guard.
- Viewport virtualization is temporarily disabled while a persisted editor is
  active, so panning offscreen cannot unmount its draft. It resumes on Finish or
  discard. This may render more cards during editing; large-board/native
  performance is not established by the source tests.
- Note Tags Undo restores tags only, never an older title/body. Untitled content
  cannot be replaced accidentally by that metadata history action.

## Atomic boundary, not a historical revision system

Native `add_reference` has an optional untitled mode, restricted to notes, that
preserves an explicit empty title. Old/native callers without it and MCP still
receive default Note. SQLite already permits empty strings; no migration is needed.
The guarded native update permits clearing a note heading; unguarded/MCP title
validation is unchanged. A saved paper may be cleared entirely without deleting it.
Snapshot import preserves such intentionally blank records; create still rejects
brand-new blank-both. Older app versions may reject these newly supported heading-only
or blank-note exports.

The native `update_reference` command accepts an optional **separate** expected
`{title, caption}`. `Store::write` compares both current values inside its existing
Immediate SQLite transaction, before patch/event. Conflict does not overwrite the
row or emit an update. Metadata/geometry changes are preserved by the text patch.
Archive/current-member checks remain. No database migration, new table, Ready gate,
MCP tool argument change or new execution authority is introduced. The note create
validation now accepts a nonblank explicit heading OR body, rejecting both blank.

This protects current-content equality, not historical A→B→A or exactly-once
processing. Existing MCP and other callers without the optional expectation retain
their unguarded update semantics. Create validation is intentionally broadened
for all callers to accept heading-only notes; input schemas and prior successful
calls/default Note remain compatible. An agent can still publish a later edit; this feature is
not global all-writer revision safety. Undo/redo for these human content changes
also uses the expected content it actually observed.

## Evidence and remaining limits

- The release owner executed **15 real core tests**: nine in
  `reference_content_guard.rs` and six in `sticky_note_snapshot.rs`, including two
  independent Store writers, native-only empty-title compatibility, persistent
  database reopen, export/import with remapped IDs and exact retained strings.
  This is data/transaction evidence, not visual acceptance. Binding export uses
  the repository's existing Rust example, not a hand-edited final signature.
- DOM/userEvent tests cover direct text, optional heading, same focused textarea
  across create, newer typing, lost response/no replay, conflicts, explicit recovery,
  actual router navigation, unmount/project ABA, read errors preserving cached paper,
  sync throw, heading-only persistence, literal Note on fresh reopen and clearing existing content. Exact aggregate
  counts belong in the release verification after final gates.
- This lane's final References + native-drop + clipboard DOM gate passed **121/121
  in 18 files** (single worker). Frontend lint (290 files), frontend/E2E strict
  typechecks and production web build also passed. The earlier 110/116 gate and
  later 120/121 markup-selector failure are retained in local logs; the final
  pass is not a native/browser pass. The release owner will run the integrated
  full suite after adding release metadata and other accepted checkpoints.
- `sticky-note.spec.ts` prepares actual rendered body-only, heading and reopened-note
  screenshots in light/dark. Only synthetic PNGs go to `test-visuals/sticky-note-*.png`.
  Placement/caret/pan/persistence/expected-content assertions accompany them.
  Browser execution and visual inspection are **NOT RUN at this source checkpoint**.
- Native 36 images are the rejected form, not acceptance of this replacement.
  Local native input/transport restrictions remain; no fallback browser/security
  workaround is part of this change. Native gesture/spacing and large-text overflow
  still need actual visual evidence. Browser 800px is not native minimum-width proof.

Official interaction reference: [Miro sticky notes](https://help.miro.com/hc/en-us/articles/360017572054-Sticky-notes)
describes placing a sticky from the toolbar and typing directly. This informs the
interaction model; it is neither a Miro integration nor proof of this app's usability.

## Integration delta for canonical maps

- H-R01 / RF03: Add→Note is placement then direct autosaved paper, optional heading
  or body, blank-new no record, deliberate saved blank preserved. Task-drawer
  reference attachment creation remains its separate existing flow.
- H-R04: body double-click, native Edit note button and note Actions→Edit note share one guarded inline
  editor. Media caption, tags and link dialogs are unchanged.
- H-R07 / VS03: screenshot and actual gesture evidence must be current; persisted
  small cards scroll their editor/recovery instead of clipping it. Body/caret input
  does not own canvas pan. First-create grip pause is explicit.
- AG12: native optional empty-title mode and native expected-content updates do
  not add MCP arguments, authority or launches. Current-content equality is not
  revision history; unguarded updates retain prior semantics, while shared create
  validation additively accepts heading-only notes.
- Reference task-picker labels use saved title, otherwise a short first body line,
  otherwise Empty note; note searches include real body. Those display fallbacks
  never rewrite storage. Non-note search/title behavior remains unchanged.
