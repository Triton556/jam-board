import { describe, expect, it } from "vitest";
import { overviewRasterScale } from "./overview-resolution";

describe("overview raster pixel budget", () => {
  it.each([1, 2])(
    "covers the maximum overview zoom in physical pixels at DPR %s",
    (dpr) => {
      const scale = overviewRasterScale(1024, 768, dpr);
      expect(scale).toBe(0.65 * dpr);
      expect(scale).toBeGreaterThanOrEqual(0.4 * dpr);
      expect(Math.ceil(1024 * scale)).toBeLessThanOrEqual(4096);
    },
  );
  it("keeps the 4096px cap on large boards and handles invalid DPR", () => {
    expect(overviewRasterScale(16000, 8000, 2)).toBe(4096 / 16000);
    expect(overviewRasterScale(800, 600, Number.NaN)).toBe(0.65);
  });
});
