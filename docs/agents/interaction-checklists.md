# Interaction tree and per-type checklists

[Index](README.md) · [Human action map](human-interactions.md)

Round-5 QA method: one agent builds a tree of every human interaction in the
app; other agents walk every node and leaf against the checklist for that
node's type. The tree is an inventory, not a result; the walk is the result.

## Tree format

Stored under `test-visuals/qa/interaction-tree/` (git-ignored) as `tree.json`
plus a readable `tree.md`.

```ts
type Node = {
  id: string;            // stable, path-like: "board/task-drawer/references/add-menu"
  label: string;         // what a person sees ("Add ▾")
  type: NodeType;        // see checklists below
  reach: string[];       // click-by-click steps from a fresh mock app at /welcome
  states: string[];      // states the walker must see: default, hover, focus, disabled, loading, empty, error, open…
  source: string[];      // file:line of the component(s)
  shortcut?: string;
  children: Node[];
  planned?: boolean;     // specified in a design contract but not yet in the build
};
```

Every screen, region, control, menu item, gesture, shortcut and
empty/loading/error state is a node. Leaves are individual controls or
gestures. Hidden controls (hover toolbars, context menus, keyboard-only paths)
count.

## Shared rules (every interactive node)

- Visible label, or a tooltip when icon-only (name + shortcut, appears on hover
  and on keyboard focus after ~500 ms, does not cover the trigger).
- Reachable by keyboard in a logical order; visible focus ring.
- Hover, active, focus and disabled states are distinct; disabled controls say
  why (tooltip).
- Hit target ≥ 28 × 28 px (32 preferred).
- Text uses the type scale and `Jam Text` / display / hand / mono families;
  colours come from tokens; no clipped text without a tooltip.
- No layout shift on hover, focus or async load.
- Spacing on the 4 px grid (4, 8, 12, 16, 24, 32). A section header's actions
  sit ≥ 12 px above the first card; sibling buttons gap 8 px; card padding 16 px.
- Copy: English, sentence case, plain words, no defensive disclaimers.

## Checklists by type

| Type | Must hold |
|---|---|
| `button` | One primary per region; consistent height with siblings (28 / 32 / 40); icon–label gap 6 px; async actions show progress and cannot double-fire. |
| `icon-button` | Tooltip with name and shortcut; same size as sibling icon buttons; optical centring. |
| `link` | Looks like a link; opens where expected (in-app route vs external browser). |
| `select` / `combobox` | Shared `CustomSelect`, never native; arrows / Enter / Esc / type-ahead; selected value visible; menu stays inside the viewport and aligns to the trigger. |
| `form` (field group) | Labels above controls; columns top-aligned; equal control heights; full column width unless deliberately short; helper text 13 px directly under its control; errors under the control; 16 px between fields, 24 px between groups. |
| `text-input` / `textarea` | Readable placeholder contrast; autosize where intended; Enter / Shift+Enter semantics match the hint; paste works. |
| `switch` / `checkbox` / `segmented` | State readable without colour alone; label clickable; keyboard toggles. |
| `tabs` | Arrow-key navigation; selected tab visible; panel does not jump in height when switching unless content differs. |
| `drawer` / `panel` | Opens and closes with transform + opacity only, 180–240 ms, no dropped frames (no frame > 32 ms in a performance trace during the transition); content does not reflow after opening (skeleton reserves space); Esc closes; focus moves in and returns to the trigger; never overlaps the top bar. |
| `dialog` | Focus trap; initial focus on the first field; Enter submits; Esc / outside click close unless destructive; primary action on the right. |
| `popover` / `menu` | Anchored to its trigger; flips at viewport edges; closes on outside click and Esc; arrow-key navigation; destructive items separated. |
| `tooltip` | No flicker when moving between adjacent triggers; max width ~280 px; never the only place for essential information. |
| `toast` / `inline-status` | Says what happened and offers the next action; does not cover primary controls; dismissible. |
| `canvas-node` | Drags from any non-interactive part of its body; `grab` / `grabbing` cursors; < 4 px press selects; double-click runs the main action; Esc cancels a drag; no accidental text selection. |
| `canvas-gesture` | Pan, zoom, marquee (Shift+drag), multi-select (Shift+click), delete with undo — all as documented in `docs/canvas-references.md`. |
| `drag-source` / `drop-target` | Drop target highlights on drag-over and clears on leave/drop; invalid targets show not-allowed; result is visible immediately. |
| `shortcut` | Works where documented, not inside text inputs unless intended; appears in the tooltip or help. |
| `composer` | Brain dock rules in `docs/brain-dock.md` (Enter sends, attachments, chips, voice states). |
| `empty-state` / `loading-state` / `error-state` | Present, styled, actionable; loading reserves final size; error offers recovery. |
| `screen` / `region` | Header alignment, consistent gutters, scroll containers scroll the right region only, sticky elements do not cover content. |

## Motion tokens

Defined in `apps/desktop/src/styles/tokens.css` and used everywhere:

```css
--motion-fast: 120ms;   /* hover, press, small fades */
--motion-base: 180ms;   /* popovers, menus, chips */
--motion-slow: 240ms;   /* drawers, docks, dialogs */
--ease-out: cubic-bezier(0.2, 0, 0, 1);  /* entering */
--ease-in: cubic-bezier(0.4, 0, 1, 1);   /* leaving */
```

Only `transform` and `opacity` animate. Panels that change layout width (the
brain dock pushing the workspace) switch width instantly and animate their own
content with transform/opacity. `prefers-reduced-motion: reduce` turns
non-essential motion off.

## Walk output

Per node: `PASS` / `FAIL` per checklist line, with steps, a screenshot path and,
for failures, severity (blocker / major / minor / polish) and the expected
result. Findings go to `test-visuals/qa/interaction-walk/<subtree>/report.md`.
