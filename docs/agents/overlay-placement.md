# Shared select placement and disclosure ink — alpha31 candidate

**H-D01, H-P02, KB03, VS01/VS02.** Native alpha29 showed a Status menu opened
near the lower edge of a long task drawer with later options clipped. The same
read-only pass showed an emoji-like collapsed Agent plan marker in WebKitGTK.
Those observations remain attributed to alpha29; this candidate needs its own
native confirmation.

CustomSelect keeps its existing in-tree DOM/modal scope (no body portal or new
focus layer). Its popup measures the trigger, intersects viewport and scroll/
overflow ancestor bounds, chooses above when below cannot fit and above has more
room, and bounds width/height with scrolling. Nested scrolling, window/visual
viewport resize and element resize recompute placement. Scrolling the trigger wholly outside the visible clip closes
the popup without selecting or scrolling focus back. No selection is made by
positioning; active and selected options remain separate. Search, empty results,
Escape-to-trigger then parent Escape, Tab and disabled controls retain their
contracts. Geometry is in CSS pixels; it does not multiply device pixel ratio.

The Agent plan marker uses the existing monochrome CSS chevron rather than
platform glyph presentation. Archived help no longer promises available editing,
and task change/check counts use singular when appropriate. Stored data and
permission/readiness semantics are untouched.

Pure synthetic rectangles and DOM keyboard tests cover lower-edge/ancestor clips,
narrow widths, resize/scroll, search and Escape depth. Hosted browser scenarios
check real popup bounds, Done visibility, unchanged task state and computed marker
styles in both themes at800×600; they are added/typechecked but NOT RUN locally.
Final native checks should repeat the observed lower-edge case and inspect narrow/
scaled windows and long/searchable options. Source tests do not prove final pixels.

Geometry rationale: element rectangles are viewport-relative and reflect scrolling;
visual-viewport offsets are CSS pixels. The implementation observes/recomputes
these values rather than assuming the layout viewport or multiplying DPR.
[MDN getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect),
[MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport).
These API facts support the mechanism, not a claim that every native placement
has been visually accepted.
