import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { BrainGlyph } from "./BrainGlyph";

it.each([16, 20, 24, 48] as const)(
  "H-BD04 shipped B keeps two hemispheres and two nodes at %i px",
  (size) => {
    const { container } = render(<BrainGlyph size={size} />);
    const glyph = container.querySelector("svg");
    expect(glyph).toHaveAttribute("width", String(size));
    expect(glyph).toHaveAttribute("height", String(size));
    const contour = glyph?.querySelector("path")?.getAttribute("d") ?? "";
    expect(contour).toContain("M12 5C11.4 3.4");
    expect(contour).toContain("M12 5C12.6 3.4");
    expect(glyph?.querySelectorAll("path")).toHaveLength(2);
    const nodes = glyph?.querySelectorAll("circle") ?? [];
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(Number(node.getAttribute("r"))).toBe(size < 24 ? 1.4 : 1.6);
      if (size < 24)
        for (const key of ["cx", "cy"]) {
          const pixel = (Number(node.getAttribute(key)) * size) / 24;
          expect(pixel).toBeCloseTo(Math.round(pixel));
        }
    }
  },
);
