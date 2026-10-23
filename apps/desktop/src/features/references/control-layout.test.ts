import { expect, it, vi } from "vitest";
import { referenceControlsBottom } from "./control-layout";
import { placedNoteLayout } from "./note-draft-layout";

// Synthetic DOM rectangles establish shared measurement, not native CSS layout.
it("RF03/VS01 measures the complete current overlay, including wrapped feedback", () => {
  const container = document.createElement("section");
  const stack = document.createElement("div");
  stack.className = "reference-control-stack";
  container.append(stack);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
    new DOMRect(80, 120, 700, 500),
  );
  const bounds = vi
    .spyOn(stack, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(96, 136, 668, 90));
  expect(referenceControlsBottom(container)).toBe(106);
  bounds.mockReturnValue(new DOMRect(96, 136, 668, 210));
  const toolsBottom = referenceControlsBottom(container);
  expect(toolsBottom).toBe(226);
  const note = placedNoteLayout(
    { x: 350, y: 250 },
    { x: 350, y: 250 },
    { width: 700, height: 500, toolsBottom },
  );
  expect(note.y + note.viewport.y).toBeGreaterThan(toolsBottom);
  expect(note.y + note.viewport.y + 180).toBeLessThanOrEqual(500);
  // No stale cached measurement after a successful retry removes the notice.
  bounds.mockReturnValue(new DOMRect(96, 136, 668, 90));
  expect(referenceControlsBottom(container)).toBe(106);
});

it("RF03/VS01 tolerates unavailable or clipped control geometry without negative clearance", () => {
  expect(referenceControlsBottom(null)).toBe(0);
  const container = document.createElement("section");
  expect(referenceControlsBottom(container)).toBe(0);
  const stack = document.createElement("div");
  stack.className = "reference-control-stack";
  container.append(stack);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 100, 700, 500),
  );
  vi.spyOn(stack, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, -100, 700, 80),
  );
  expect(referenceControlsBottom(container)).toBe(0);
});
