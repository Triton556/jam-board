import { readFile, writeFile, mkdir } from "node:fs/promises";
const css = await readFile(
	new URL("../apps/desktop/src/styles/tokens.css", import.meta.url),
	"utf8",
);
const [light, dark] = css.split('[data-theme="dark"]');
const hex = (source, key) => {
	const m = source.match(new RegExp(`--${key}:\\s*(#[0-9A-Fa-f]{6})`));
	if (!m) throw new Error(`Missing ${key}`);
	return m[1];
};
const rgb = (value) =>
	[1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
const luminance = (channels) =>
	channels
		.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
		.reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
	const x = luminance(a),
		y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const results = [];
for (const [theme, source, mix] of [
	["light", light, 0.14],
	["dark", dark, 0.22],
])
	for (let n = 1; n <= 6; n++) {
		const color = hex(light, `m${n}`),
			card = rgb(hex(source, "card"));
		const fill = rgb(color).map((c, i) => c * mix + card[i] * (1 - mix));
		const ink = ratio(rgb(hex(source, "ink")), fill),
			originalSecondary = ratio(rgb(hex(source, "ink-2")), fill),
			secondary = theme === "dark" ? ink : originalSecondary;
		results.push({
			theme,
			member: color,
			mix,
			inkContrast: Number(ink.toFixed(2)),
			originalSecondaryContrast: Number(originalSecondary.toFixed(2)),
			secondaryToken: theme === "dark" ? "ink" : "ink-2",
			secondaryContrast: Number(secondary.toFixed(2)),
			AA: ink >= 4.5 && secondary >= 4.5,
		});
	}
if (results.some((r) => !r.AA)) throw new Error("Card text contrast failed AA");
await mkdir(new URL("../docs/media/m6.2/", import.meta.url), {
	recursive: true,
});
await writeFile(
	new URL("../docs/media/m6.2/card-contrast.json", import.meta.url),
	JSON.stringify(
		{
			method:
				"WCAG sRGB relative luminance; exact 14% / 22% member blend over card, ink and ink-2",
			results,
		},
		null,
		2,
	) + "\n",
);
console.log(
	JSON.stringify({
		checks: results.length * 2,
		minimum: Math.min(...results.map((r) => r.secondaryContrast)),
		AA: true,
	}),
);
