import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync("src/styles/fonts.css", "utf8");
const tokens = readFileSync("src/styles/tokens.css", "utf8");
const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(
  (match) => match[1] ?? "",
);
it("UI alias uses Caption regular/italic and real PT Serif bold across Latin and Cyrillic", () => {
  expect(faces).toHaveLength(16);
  for (const style of ["normal", "italic"]) {
    for (const subset of ["latin", "latin-ext", "cyrillic", "cyrillic-ext"]) {
      const caption = faces.find((face) =>
        face.includes(`pt-serif-caption-${subset}-400-${style}.woff2`),
      );
      const bold = faces.find((face) =>
        face.includes(`/pt-serif/files/pt-serif-${subset}-700-${style}.woff2`),
      );
      expect(caption).toContain("font-weight: 400 599;");
      expect(bold).toContain("font-weight: 600 900;");
      expect(caption).toContain('font-family: "Jam Text";');
      expect(bold).toContain(`font-style: ${style};`);
    }
  }
  for (const face of faces) {
    const url = face.match(/url\("([^"]+)"\)/)?.[1];
    if (!url) throw new Error("Missing self-hosted font source");
    expect(existsSync(resolve("src/styles", url)), url).toBe(true);
    expect(face).toContain("unicode-range:");
  }
  expect(tokens).toContain("font-synthesis: none;");
  expect(tokens).toContain('--font-sans: "Jam Text", serif;');
  expect(tokens).toContain('--font-display: "PT Serif", serif;');
  expect(tokens).toContain('--font-hand: "Shantell Sans Variable", cursive;');
});
it("new font packages retain their complete original OFL notices", () => {
  for (const [pkg, name] of [
    ["@fontsource/pt-serif", "pt-serif"],
    ["@fontsource/pt-serif-caption", "pt-serif-caption"],
    ["@fontsource-variable/shantell-sans", "shantell-sans"],
  ]) {
    expect(readFileSync(`src/assets/licenses/${name}.txt`, "utf8")).toBe(
      readFileSync(`node_modules/${pkg}/LICENSE`, "utf8"),
    );
  }
});
