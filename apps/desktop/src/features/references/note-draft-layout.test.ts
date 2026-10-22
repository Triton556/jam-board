import { expect, it } from "vitest";
import { noteDraftLayout, noteDraftWidth } from "./note-draft-layout";

it.each([
  { width: 540, height: 450, toolsBottom: 104 },
  { width: 920, height: 570, toolsBottom: 96 },
  { width: 1180, height: 750, toolsBottom: 96 },
  { width: 310, height: 350, toolsBottom: 110 },
])(
  "RF03 initial paper fits actual canvas bounds %o at readable editing zoom",
  (canvas) => {
    const center = { x: 1234, y: -456 };
    const layout = noteDraftLayout(center, canvas);
    const left = canvas.width / 2 + (layout.x - center.x) * layout.zoom;
    const top = canvas.height / 2 + (layout.y - center.y) * layout.zoom;
    expect(left).toBeGreaterThanOrEqual(15.99);
    expect(left + noteDraftWidth * layout.zoom).toBeLessThanOrEqual(
      canvas.width - 15.99,
    );
    expect(top).toBeGreaterThanOrEqual(canvas.toolsBottom + 15.99);
    expect(top + layout.maxHeight * layout.zoom).toBeLessThanOrEqual(
      canvas.height - 15.99,
    );
    expect(layout.zoom).toBeLessThanOrEqual(1);
  },
);
