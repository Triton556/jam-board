import { expect, it } from "vitest";
import { placedNoteLayout } from "./note-draft-layout";

it("places the real paper around the clicked world point, independently of camera scale", () => {
  const result = placedNoteLayout(
    { x: 800, y: 900 },
    { x: 300, y: 450 },
    { width: 800, height: 600, toolsBottom: 112 },
  );
  expect(result).toEqual({
    x: 680,
    y: 810,
    maxHeight: 224,
    viewport: { x: -500, y: -450, zoom: 1 },
  });
  expect(result.x + 120).toBe(800);
  expect(result.y + 90).toBe(900);
});
it("only shifts the camera when a click would place the paper under wrapping controls", () => {
  const result = placedNoteLayout(
    { x: 50, y: 60 },
    { x: 40, y: 20 },
    { width: 800, height: 600, toolsBottom: 130 },
  );
  expect(result.x).toBe(-70);
  expect(result.y).toBe(-30);
  expect(result.x + result.viewport.x).toBe(16);
  expect(result.y + result.viewport.y).toBe(146);
});
it("keeps a lower-right paper inside the actual narrow canvas without changing its world point", () => {
  const result = placedNoteLayout(
    { x: 600, y: 700 },
    { x: 790, y: 590 },
    { width: 800, height: 600, toolsBottom: 120 },
  );
  expect(result.x + result.viewport.x + 240).toBe(784);
  expect(result.y + result.viewport.y + 180).toBe(584);
  expect(result.x + 120).toBe(600);
  expect(result.y + 90).toBe(700);
});
it("uses the freshly measured whole controls stack after a long receipt wraps", () => {
  const result = placedNoteLayout(
    { x: 0, y: 0 },
    { x: 400, y: 300 },
    { width: 800, height: 600, toolsBottom: 250 },
  );
  expect(result.y + result.viewport.y).toBe(266);
  expect(result.y + result.viewport.y + 180).toBeLessThan(600);
});
