import { describe, expect, it } from "vitest";
import {
  type FitReference,
  frameHeaderLayout,
  referenceFitBounds,
  referenceFitViewport,
} from "./frame-layout";

// Deterministic geometry only. Browser/native typography and hit testing are separate gates.
describe("RF02 title-priority frame header", () => {
  it("reserves a separate linked-target row at compact and full zoom", () => {
    expect(frameHeaderLayout(800, 1, true).height).toBe(86);
    expect(frameHeaderLayout(280, 0.4, true).height).toBe(124);
    const bounds = referenceFitBounds(
      [
        {
          x: 0,
          y: 0,
          width: 280,
          height: 40,
          frame: { collapsed: true, linked: true },
        },
      ],
      0.4,
    );
    expect(bounds.height).toBe(124 * (0.75 / 0.4));
  });
  it.each([0.39, 0.4, 0.49, 0.75, 1, 2, 4])(
    "keeps a 320px frame's title out of the controls row at narrow zoom %s",
    (zoom) => {
      const header = frameHeaderLayout(320, zoom);
      expect(header.scale * zoom).toBeGreaterThanOrEqual(0.75);
      expect(header.cssWidth).toBeGreaterThanOrEqual(200);
      expect(header.compact).toBe(zoom < 0.75);
      if (header.compact) {
        // Header padding24 + border2 + grip20 + gap8 leaves meaningful title room.
        expect((header.cssWidth - 54) * header.scale * zoom).toBeGreaterThan(
          100,
        );
        expect(header.height).toBe(84);
      }
    },
  );
  it("retains a compact row for narrow280px frames and one row for wide800px frames", () => {
    expect(frameHeaderLayout(280, 1).compact).toBe(true);
    expect(frameHeaderLayout(800, 0.39).compact).toBe(false);
  });
});

const tallFrame: FitReference = {
  x: 0,
  y: 0,
  width: 320,
  height: 1200,
  frame: { collapsed: false },
};
describe("RF02 explicit Fit includes header and tool occlusion", () => {
  it.each([
    { width: 1096, height: 756, toolsBottom: 112 },
    { width: 716, height: 480, toolsBottom: 146 },
    { width: 500, height: 360, toolsBottom: 112 },
  ])("fits the native tall-frame case within %j", (canvas) => {
    const viewport = referenceFitViewport([tallFrame], canvas);
    if (!viewport) throw Error("Missing viewport");
    const bounds = referenceFitBounds([tallFrame], viewport.zoom);
    expect(bounds.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(23.99);
    expect(bounds.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(
      canvas.toolsBottom + 23.99,
    );
    expect(
      (bounds.x + bounds.width) * viewport.zoom + viewport.x,
    ).toBeLessThanOrEqual(canvas.width - 23.99);
    expect(
      (bounds.y + bounds.height) * viewport.zoom + viewport.y,
    ).toBeLessThanOrEqual(canvas.height - 23.99);
  });
  it("includes collapsed two-row header, not a hidden1200px body or hidden children", () => {
    const node = { ...tallFrame, height: 40, frame: { collapsed: true } };
    const bounds = referenceFitBounds([node], 0.49);
    expect(bounds.y).toBe(0);
    expect(bounds.height).toBeCloseTo(84 * (0.75 / 0.49));
    expect(bounds.height).toBeLessThan(200);
  });
  it("includes negative-position items and wide overview headers without mutating geometry", () => {
    const nodes = [tallFrame, { x: -240, y: -100, width: 180, height: 100 }];
    const before = JSON.stringify(nodes);
    const viewport = referenceFitViewport(nodes, {
      width: 800,
      height: 600,
      toolsBottom: 130,
    });
    if (!viewport) throw Error("Missing viewport");
    const bounds = referenceFitBounds(nodes, viewport.zoom);
    expect(bounds.x).toBe(-240);
    expect(bounds.y).toBeLessThanOrEqual(-100);
    expect(JSON.stringify(nodes)).toBe(before);
  });
  it("keeps the header clear when minimum zoom prevents fitting all content", () => {
    const canvas = { width: 500, height: 200, toolsBottom: 112 };
    const viewport = referenceFitViewport([tallFrame], canvas);
    if (!viewport) throw Error("Missing viewport");
    const bounds = referenceFitBounds([tallFrame], viewport.zoom);
    expect(viewport.zoom).toBe(0.1);
    expect(bounds.y * viewport.zoom + viewport.y).toBeCloseTo(136);
    expect(
      (bounds.y + bounds.height) * viewport.zoom + viewport.y,
    ).toBeGreaterThan(canvas.height);
  });
  it("does not invent a camera for an empty or unmeasured canvas", () => {
    expect(
      referenceFitViewport([], { width: 800, height: 600, toolsBottom: 0 }),
    ).toBeNull();
    expect(
      referenceFitViewport([tallFrame], {
        width: 0,
        height: 0,
        toolsBottom: 0,
      }),
    ).toBeNull();
  });
});
