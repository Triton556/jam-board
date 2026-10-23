import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync("src/styles/tokens.css", "utf8");
const app = readFileSync("src/styles/app.css", "utf8");

// Source-token regression, not a substitute for rendered/a11y acceptance.
// WCAG 2.2 relative luminance: https://www.w3.org/WAI/WCAG22/Understanding/relative-luminance.html
type RGB = [number, number, number];
function tokens(source: string): Record<string, RGB> {
  return Object.fromEntries(
    [...source.matchAll(/--([\w-]+): (#[0-9a-f]{6});/g)].map((match) => [
      match[1],
      (match[2] ?? "")
        .slice(1)
        .match(/../g)
        ?.map((channel) => Number.parseInt(channel, 16)) as RGB,
    ]),
  );
}
const light = tokens(css.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? "");
const dark = {
  ...light,
  ...tokens(css.match(/\[data-theme="dark"\] \{([\s\S]*?)\n\}/)?.[1] ?? ""),
};
function color(colors: Record<string, RGB>, name: string): RGB {
  const value = colors[name];
  if (!value) throw new Error(`Missing theme token: ${name}`);
  return value;
}
function luminance(rgb: RGB) {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(a: RGB, b: RGB) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
it.each(["light", "dark"] as const)(
  "%s normal-size text tokens meet 4.5:1 on base surfaces",
  (theme) => {
    const colors = theme === "light" ? light : dark;
    for (const ink of ["ink", "ink-2", "ink-3", "coral-ink", "danger-ink"])
      for (const background of ["paper", "paper-2", "card", "card-hover"])
        expect(
          contrast(color(colors, ink), color(colors, background)),
          `${theme} ${ink} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
  },
);
it.each(["light", "dark"] as const)(
  "%s small card metadata remains legible on every palette tint",
  (theme) => {
    const colors = theme === "light" ? light : dark;
    const mixes = [...app.matchAll(/--card-mix: (\d+)%;/g)].map(
      (match) => Number(match[1]) / 100,
    );
    expect(mixes).toHaveLength(2);
    const mix = mixes[theme === "light" ? 0 : 1];
    if (mix === undefined) throw new Error("Missing card mix");
    for (const palette of ["m1", "m2", "m3", "m4", "m5", "m6"]) {
      const background = color(colors, palette).map(
        (channel, i) =>
          channel * mix + (color(colors, "card")[i] ?? 0) * (1 - mix),
      ) as RGB;
      expect(
        contrast(color(colors, "ink-2"), background),
        `${theme} muted card metadata on ${palette}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  },
);
it.each(["light", "dark"] as const)(
  "%s action text meets 4.5:1 for primary and destructive buttons",
  (theme) => {
    const colors = theme === "light" ? light : dark;
    for (const background of ["primary", "primary-hover"])
      expect(
        contrast(color(colors, "on-primary"), color(colors, background)),
      ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast([255, 255, 255], color(colors, "danger")),
    ).toBeGreaterThanOrEqual(4.5);
  },
);

it.each(["light", "dark"] as const)(
  "%s semantic report success and ending countdown text meet 4.5:1 on their actual base surfaces",
  (theme) => {
    const colors = theme === "light" ? light : dark;
    for (const background of ["paper", "paper-2", "card", "card-hover"])
      expect(
        contrast(color(colors, "success-ink"), color(colors, background)),
        `${theme} success-ink on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(color(colors, "coral-ink"), color(colors, "paper")),
    ).toBeGreaterThanOrEqual(4.5);
    const reports = readFileSync("src/styles/v22.css", "utf8");
    expect(reports).toMatch(
      /\.test-pass,\s*\.recommendation\s*\{\s*color: var\(--success-ink\)/,
    );
    expect(app).toMatch(/\.countdown\.ending\s*\{\s*color: var\(--coral-ink\)/);
  },
);

it.each(["light", "dark"] as const)(
  "%s enabled table filters and archived text retain normal-text contrast",
  (theme) => {
    const colors = theme === "light" ? light : dark;
    const rules =
      app.match(/\.status-filters button \{([\s\S]*?)\}/)?.[1] ?? "";
    const opacity = Number(rules.match(/opacity:\s*([.\d]+)/)?.[1] ?? "1");
    const archived = Number(
      app.match(/\.archived\s*\{[^}]*opacity:\s*([.\d]+)/)?.[1] ?? "1",
    );
    const over = (foreground: RGB, background: RGB, alpha: number) =>
      foreground.map(
        (channel, i) => channel * alpha + (background[i] ?? 0) * (1 - alpha),
      ) as RGB;
    for (const palette of ["lilac", "butter", "sky", "rose", "mint"]) {
      const base = color(colors, "paper"),
        background = over(color(colors, palette), base, opacity),
        ink = over(color(colors, "ink"), base, opacity);
      expect(
        contrast(ink, background),
        `${theme} ${palette} enabled filter`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const base of ["paper", "card"])
      expect(
        contrast(
          over(color(colors, "ink-2"), color(colors, base), archived),
          color(colors, base),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    expect(app).toMatch(
      /\.status-filters button\[aria-pressed="true"\][\s\S]*?box-shadow:/,
    );
    expect(readFileSync("src/features/table/TableRow.tsx", "utf8")).toContain(
      'className="table-stamp">archived',
    );
    expect(`${css}\n${app}`).toMatch(/--st-ready:\s*var\(--st-todo\)/);
    expect(css).toMatch(/--st-todo:\s*var\(--butter\)/);
  },
);
