// Encode the native frames recorded by m6-demo.mjs, without requiring a global encoder.
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const require = createRequire(
	new URL("../apps/desktop/package.json", import.meta.url),
);
const sharp = require("sharp");
const directory = new URL("../.dev-data/m6-demo-frames/", import.meta.url);
const capture = JSON.parse(
	await readFile(new URL("capture.json", directory), "utf8"),
);
const raw = [];
let height;
for (let index = 0; index < capture.frames; index++) {
	const frame = await readFile(
		new URL(String(index).padStart(3, "0") + ".jpg", directory),
	);
	const input = sharp(frame);
	if (!capture.contentOnly)
		input.extract({ left: 1, top: 31, width: 1360, height: 860 });
	const scaled = await input.resize({ width: 960 }).toBuffer();
	const meta = await sharp(scaled).metadata();
	height = meta.height + 48;
	const text = capture.captions[index]
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
	const caption = Buffer.from(
		`<svg width="960" height="48"><rect width="960" height="48" fill="#2B2622"/><text x="18" y="29" font-family="Consolas,monospace" font-size="15" fill="#F7F1E6">${text}</text></svg>`,
	);
	raw.push(
		await sharp(scaled)
			.extend({ top: 0, bottom: 48, left: 0, right: 0, background: "#2B2622" })
			.composite([{ input: caption, top: meta.height, left: 0 }])
			.ensureAlpha()
			.raw()
			.toBuffer(),
	);
}
const gif = await sharp(Buffer.concat(raw), {
	raw: {
		width: 960,
		height: height * raw.length,
		channels: 4,
		pageHeight: height,
	},
})
	.gif({
		loop: 0,
		delay: Array(raw.length).fill(capture.delay),
		keepDuplicateFrames: true,
		colours: 128,
		effort: 3,
		dither: 0.5,
	})
	.toBuffer();
const encoded = await sharp(gif, { animated: true }).metadata();
const durationSeconds =
	encoded.delay.reduce((sum, delay) => sum + delay, 0) / 1000;
if (durationSeconds < 12 || durationSeconds > 20)
	throw new Error(`Encoded GIF duration is ${durationSeconds}s`);
if (gif.length > 6 * 1024 * 1024) throw new Error("GIF exceeds 6 MiB");
await mkdir(new URL("../docs/media/m6/", import.meta.url), { recursive: true });
await writeFile(new URL("../docs/media/demo.gif", import.meta.url), gif);
const report = {
	source:
		"real release WebView2, CDP content capture without cursor overlay, resize and caption only",
	width: 960,
	frames: encoded.pages,
	durationSeconds,
	bytes: gif.length,
	transcript: capture.transcript,
};
await writeFile(
	new URL("../docs/media/m6/demo-recording.json", import.meta.url),
	JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
