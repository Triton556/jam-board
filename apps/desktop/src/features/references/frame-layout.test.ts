import { describe, expect, it } from "vitest";
import {
  type FitReference,
  frameHeaderLayout,
  referenceFitBounds,
  referenceFitViewport,
} from "./frame-layout";

// Deterministic geometry only. Browser/native typography and hit testing are separate gates.
describe("RF02 title-priority frame header", () => {
  it.each(
    [280, 320, 880].flatMap((width) =>
      [0.2, 0.4, 1].map((zoom) => [width, zoom]),
    ),
  )(
    "keeps 24px screen controls within a %spx frame at zoom %s",
    (width, zoom) => {
      const header = frameHeaderLayout(width, zoom);
      expect(header.controlSize * header.scale * zoom).toBeGreaterThanOrEqual(
        24,
      );
      expect(header.cssWidth * header.scale).toBeLessThanOrEqual(width + 0.001);
      const controls = header.overflow ? 1 : 4;
      // Header padding/borders and inter-control gaps must fit too.
      expect(
        26 + controls * header.controlSize + (controls - 1) * 4,
      ).toBeLessThanOrEqual(header.cssWidth + 0.001);
      expect(header.overflow).toBe(width * zoom < 120);
    },
  );
  it("RC04 20% -> 19.9% keeps header width inside the frame and changes scale continuously", () => {
    for (const width of [280, 320, 880]) {
      const before = frameHeaderLayout(width, 0.2, true);
      const after = frameHeaderLayout(width, 0.199, true);
      expect(after.cssWidth * after.scale).toBeLessThanOrEqual(width + 0.001);
      expect(Math.abs(after.scale - before.scale) / before.scale).toBeLessThan(
        0.01,
      );
      expect(
        Math.abs(
          after.height * after.scale * 0.199 -
            before.height * before.scale * 0.2,
        ),
      ).toBeLessThan(1);
    }
  });
  it("reserves linked-target rows when inline and moves links into an overflowing frame menu", () => {
    expect(frameHeaderLayout(800, 1, true).height).toBe(86);
    expect(frameHeaderLayout(320, 0.4, true).height).toBe(135);
    expect(frameHeaderLayout(280, 0.4, true).overflow).toBe(true);
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
    expect(bounds.height).toBeCloseTo(132.8);
  });
  it.each([0.39, 0.4, 0.49, 0.75, 1, 2, 4])(
    "keeps a 320px frame's title out of the controls row at narrow zoom %s",
    (zoom) => {
      const header = frameHeaderLayout(320, zoom);
      expect(header.scale * zoom).toBeGreaterThanOrEqual(
        Math.min(0.75, (zoom * 320) / 200),
      );
      expect(header.cssWidth).toBeGreaterThanOrEqual(200);
      expect(header.compact).toBe(zoom < 0.75);
      if (header.compact) {
        // Header padding24 + border2 + grip20 + gap8 leaves meaningful title room.
        expect((header.cssWidth - 54) * header.scale * zoom).toBeGreaterThan(
          Math.min(100, (320 * zoom) / 2),
        );
        expect(header.height).toBe(52 + header.controlSize);
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
