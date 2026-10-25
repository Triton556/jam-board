import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Source-token check, following styles/contrast.test.ts; not rendered acceptance.
const tokens = readFileSync("src/styles/tokens.css", "utf8");
const rules = readFileSync("src/features/task/task-status.css", "utf8");
function palette(source: string): Record<string, string> {
  return Object.fromEntries(
    [...source.matchAll(/--([\w-]+): (#[0-9a-f]{6});/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}
function luminance(hex: string) {
  const [r = 0, g = 0, b = 0] = (hex.slice(1).match(/../g) ?? []).map(
    (channel) => {
      const value = Number.parseInt(channel, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    },
  );
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
it.each(["light", "dark"] as const)(
  "H-D01 %s work-permission pill text meets 4.5:1",
  (theme) => {
    const light = palette(tokens.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? "");
    const colors =
      theme === "light"
        ? light
        : {
            ...light,
            ...palette(
              tokens.match(/\[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1] ?? "",
            ),
          };
    const pill =
      rules.match(/\.task-permission-pill \{([\s\S]*?)\}/)?.[1] ?? "";
    const foreground = pill.match(/\n\s*color: var\(--([\w-]+)\)/)?.[1];
    const background = pill.match(/background: var\(--([\w-]+)\)/)?.[1];
    const ink = foreground && colors[foreground],
      paper = background && colors[background];
    if (!ink || !paper)
      throw new Error("Missing work-permission pill theme tokens");
    const a = luminance(ink),
      b = luminance(paper);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  },
);
