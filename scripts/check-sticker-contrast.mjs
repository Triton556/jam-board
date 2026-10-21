import { readFile, mkdir, writeFile } from "node:fs/promises";
const tokens = await readFile(new URL("../apps/desktop/src/styles/tokens.css", import.meta.url), "utf8");
const css = await readFile(new URL("../apps/desktop/src/styles/app.css", import.meta.url), "utf8");
const blocks = tokens.split('[data-theme="dark"]');
const rgb = (hex) => hex.match(/[\da-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
const lum = (color) => color.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const statuses = { backlog: "lilac", todo: "butter", in_progress: "sky", review: "rose", done: "mint" };
const output = [];
for (const [i, theme] of ["light", "dark"].entries()) {
  const values = Object.fromEntries([...blocks[0].matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map((m) => [m[1], m[2]]));
  if (i) for (const m of blocks[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)) values[m[1]] = m[2];
  for (const [status, token] of Object.entries(statuses)) {
    for (const hover of [false, true]) {
      const selector = i ? (hover ? '[data-theme="dark"] .card-button:hover .task-card' : '[data-theme="dark"] .task-card') : hover ? '.card-button:hover .task-card' : '.task-card';
      const rule = css.slice(css.indexOf(`${selector} {`) + selector.length + 2).split("}")[0];
      const percent = Number(rule.match(/background:\s*color-mix\(in srgb, var\(--status-color\)\s+(\d+)%/)[1]);
      const a = rgb(values[token]), b = rgb(values[hover ? "card-hover" : "card"]);
      const background = a.map((v, j) => v * percent / 100 + b[j] * (1 - percent / 100));
      const ink = ratio(rgb(values.ink), background), secondary = ratio(rgb(values["ink-2"]), background);
      output.push({ theme, status, hover, mixPercent: percent, background: `#${background.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`, ink, ink2: secondary });
      if (ink < 4.5 || secondary < 4.5) throw new Error(`AA contrast failed: ${theme}/${status}/${hover}`);
    }
  }
}
const directory = new URL("../docs/media/m4.1/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL("sticker-contrast.json", directory), JSON.stringify({ method: "WCAG 2 relative luminance; sRGB CSS color-mix; full precision before display rounding", results: output }, null, 2));
console.log(JSON.stringify(output.filter((entry) => !entry.hover), null, 2));
