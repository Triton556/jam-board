# Canvas references — direct manipulation, linking and feedback

Status: design contract for the `feature/brain-dock` increment (round 5).
Implementation evidence belongs in the version's verification record.

## Why

The References canvas is the ideas board. Three things made it feel unlike
Miro and hard to use with the brain:

1. Items move only by their header strip; image, link and file bodies ignore
   drags.
2. Adding references to a task, story or epic offers only file upload. A frame
   that already collects the right material cannot be linked to work.
3. When the brain builds a moodboard, the person's reaction (removing items,
   sticking notes on them) is not visible to the agent as feedback.

## 1. Direct manipulation (Miro parity)

- **Items** (image, video, audio, link, file, note) move by dragging anywhere
  on their body. A press and release without moving more than 4 px selects.
  Double-click performs the item's main action: image/video → lightbox, link →
  open, file → open, note → edit text.
- Only real inner controls stay non-draggable: buttons, menus, inputs while
  editing, media player controls, chips with their own click action.
- **Frames** move by the title tab or by dragging empty frame background.
  Dragging a child moves only the child. Shift+drag anywhere (including on frame
  background) draws a marquee; Shift+click adds to the selection.
- Cursor: `grab` over draggable bodies, `grabbing` while dragging. Esc during a
  drag returns the item and does not open anything.

## 2. Feedback on items (verdicts)

- Hovering or selecting an item shows two small toggles in its toolbar:
  **Keep** (thumbs up) and **Not this** (thumbs down). Choosing one clears the
  other; choosing it again clears it.
- **Not this** dims the item to 45 % with a small "Not this" tag; **Keep** adds a
  small check badge. Both stay visible so the person can see what the brain
  will read.
- Deleting an item on the canvas archives it (undoable). Agents can see archived
  items and who archived them.
- A sticky note placed over an item counts as feedback on that item when the
  note's centre lies inside the item or they overlap by at least 30 % of the
  note's area. No extra UI; the relation is computed.

## 3. Linking references to work

Items **and frames** can be linked to an epic, story or task. A linked frame
means all its current and future items are references of that target ("via
frame"), the same way an epic frame already works for its epic.

### From the canvas

- Select items or a frame → selection toolbar **Link to…** → target picker
  (search by key or title, recent targets first, grouped Epics / Stories /
  Tasks) → link.
- A frame's title tab shows its linked targets as chips (up to 2, then "+N").
  Clicking a chip opens that item's drawer.
- Dragging an item or frame onto the open drawer's References section links it
  (drop highlight on the section).

### From the drawer (task, story, epic — same component)

- The References section header has **Add ▾** with:
  - **From canvas…** — dialog with tabs Frames / Items, search, thumbnails
    (frames show a 2×2 mosaic of their first images), multi-select, "Link N".
  - **Pick on canvas** — opens the canvas in pick mode with a banner "Select
    items or a frame to link to JB-12 · Link N · Cancel", then returns to the
    drawer.
  - **Upload file**, **Add link**, **New note** — create a reference and link it.
- The list shows linked frames first as cards (mosaic, title, item count,
  "Open on canvas"), then items (thumbnail, title, "via frame" or direct).
- **Remove link** unlinks; it never deletes the reference.

## 4. Agent contract (MCP)

- Linking accepts frames as well as items, with an unlink counterpart; exact
  tool shape is recorded in `docs/mcp.md`. `get_task` and `list_references`
  report frame links with `via: "frame"`, the frame ID and title.
- `add_reference` with `kind: "asset"` gains `copy?: boolean`. When true, the
  file is copied into the data directory's references folder (like clipboard
  images), up to 50 MB, so the reference survives cleanup of temp or agent
  workspace folders. Recommended for files an agent downloaded.
- `get_canvas` items gain `verdict: "keep" | "reject" | null`; notes gain
  `attachedTo: string[]` (rule in section 2); with `includeArchived`, archived
  items include `archivedAt` and `archivedBy` (`"human"` or the agent name).
- MCP tools still never fetch the network. Agents find and download images with
  their own tools under their own permissions, then add the local file with
  `copy: true`. Remote previews remain an explicit human action.

## 5. Desktop contract (Tauri, shared by UI and backend)

Names are exact `invoke` names; arguments camelCase; existing `Result<T, ApiError>`.

| Command | Args | Returns |
|---|---|---|
| `set_reference_verdict` | `input: { itemId, verdict?: "keep" \| "reject" \| null, verdictNote?: string \| null }` | `RefItem` |
| `link_ref_frame` | `input: { frameId, targetKey }` | `RefFrame` |
| `unlink_ref_frame` | `input: { frameId, targetKey }` | `RefFrame` |

- `RefItem` gains `verdict: "keep" | "reject" | null` and `archivedBy: string | null`.
- `RefFrame` gains `links: { targetKey: string; kind: "epic" | "story" | "task"; title: string }[]`.
- Existing item link/unlink commands are reused for items. Reference lists for a
  target include items reached through a linked frame with `via: "frame"` and
  the frame ID/title, exactly like the epic-frame inheritance.
- The mock bridge implements the same commands and fields.


## 8. Moodboard review (round 12)

Use one frame per section and link it to the relevant work. Agents obtain candidate images with their own authorized tools and add up to 50 at a time with add_references, copy:true, sourceUrl and origin. Partial failures preserve valid items; retry only failed items with a new requestId. Generated variations name derivedFrom (an existing original or an earlier successful #index). Variations have a dashed arrow; they are a field, not a deletable edge.

Humans choose Keep / Not this and **Add a reason** on each non-note item. Reasons are plain text, at most 500 characters; Enter saves, Shift+Enter inserts a newline, Escape cancels. Empty Save clears the reason. A bounded reason chip stays visible on rejected items. Source URL and Found/Generated/Own attribution remain separate from captions.

Frame **Review** or **Review items** starts keyboard review, defaulting to Unrated if any remain. All / Unrated / Keep / Not this filter the frame; the bar shows N of M rated. Arrows/J/K navigate, 1 toggles Keep, 2 toggles Not this, C opens the reason, Enter opens the current image, Escape closes the reason before exiting review. Input typing never triggers canvas shortcuts; arrows never nudge while reviewing. Setting a rating advances to the next matching item; clearing does not. Exit restores the prior viewport. Controls wrap on narrow screens; the hint hides below 1000px.

**Done, send to brain** stores the human review hash and appends reference.review_sent. The tab shows Sent time, then Changed since sent after an edit; Send again produces another event. Sending exits review. It is feedback, not execution permission. Agents wait_for_changes with the saved cursor/actions filter, read get_canvas verdict filters and inspect verdictNote/attachedTo/archivedBy rather than polling. Never re-add a rejected sourceUrl; derive new variants from Keep.

**Collect Keep into new frame…** supports 1–20 ordered source frames, title and optional work link. It creates one section per nonempty source, copies in rows of four, shares existing assets and records copiedFrom. Copied ratings/reasons start clear. Archiving a copy leaves the original and asset intact. Zero Keep items disables Create. Single-frame menus expose review/send/collect in the existing one actions menu.

Desktop commands: set_reference_verdict {input:{itemId,verdict?,verdictNote?}}, send_reference_review {input:{frameId}}, collect_kept_references {input:{requestId,sourceFrameIds,title?,linkTo?}}; generated DTOs are authoritative. Review is human-only, collection is available to both actors. Agent download/network authority is unchanged. See [round-12 verification](verification/round12.md) for fixture, browser and NOT RUN boundaries.
