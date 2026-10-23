import { assertHistoricalCapture } from "./historical-capture-guard.mjs";
assertHistoricalCapture(import.meta.url);

// Capture the actual release WebView; CDP excludes system cursor overlays.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, stat, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(
	new URL("../apps/desktop/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test"),
	sharp = require("sharp");
const root = fileURLToPath(new URL("../", import.meta.url));
const data = path.join(root, ".dev-data", `capture-20261020-m62-${Date.now()}`);
const media = path.join(root, "docs/media/m6.2");
await mkdir(media, { recursive: true });
const child = spawn(path.join(root, "target/release/jam-board.exe"), [], {
	env: {
		...process.env,
		JAM_BOARD_DATA_DIR: data,
		WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223",
	},
	windowsHide: false,
	stdio: "ignore",
});
let browser;
try {
	for (let i = 0; i < 150; i++) {
		try {
			browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	if (!browser) throw new Error("Release WebView did not start");
	let page;
	for (let i = 0; i < 150; i++) {
		page = browser
			.contexts()
			.flatMap((c) => c.pages())
			.find((p) => p.url().includes("tauri.localhost"));
		if (page) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	if (!page) throw new Error("No release page");
	const capture = async (options) => {
		await page.mouse.move(600, 55);
		return page.screenshot(options);
	};
	await page.waitForFunction(
		() => document.documentElement.dataset.ready === "true",
	);
	const invoke = (command, args = {}) =>
		page.evaluate(
			({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
			{ command, args },
		);
	const state = await invoke("app_state");
	if (state.hasJam) throw new Error("Capture requires a fresh database");
	await page.screenshot({ path: path.join(media, "onboarding.png") });
	await page
		.getByRole("button", { name: "Load demo jam", exact: true })
		.click();
	await page.getByTestId("task-card").first().waitFor();
	await page.waitForTimeout(5200);
	const theme = async (value) => {
		await page.getByLabel("Theme", { exact: true }).selectOption(value);
		await page.waitForTimeout(300);
	};
	for (const t of ["light", "dark"]) {
		await theme(t);
		for (const mode of ["None", "Assignee"]) {
			await page
				.getByRole("group", { name: "Color by", exact: true })
				.getByRole("button", { name: mode, exact: true })
				.click();
			await page.waitForTimeout(350);
			await page.screenshot({
				path: path.join(media, `board-${t}-${mode.toLowerCase()}.png`),
			});
		}
	}
	await theme("light");
	await page
		.getByRole("group", { name: "Color by", exact: true })
		.getByRole("button", { name: "None", exact: true })
		.click();
	const card = page.locator('[data-key="JB-7"]');
	await card.screenshot({ path: path.join(media, "card-sharpness.png") });
	const crisp = await page
		.locator(".board-columns,.board-column,[data-testid=task-card]")
		.evaluateAll((es) =>
			es.map((e) => ({
				kind: e.className,
				transform: getComputedStyle(e).transform,
				filter: getComputedStyle(e).filter,
				backdropFilter: getComputedStyle(e).backdropFilter,
				willChange: getComputedStyle(e).willChange,
			})),
		);
	if (
		crisp.some(
			(e) =>
				e.transform !== "none" ||
				e.filter !== "none" ||
				e.backdropFilter !== "none" ||
				e.willChange.includes("transform"),
		)
	)
		throw new Error("Persistent board raster transform/filter");
	await page.goto("http://tauri.localhost/board?task=JB-7");
	await page
		.getByRole("textbox", { name: "Task title" })
		.fill("Player movement: crisp controls and jump buffer");
	await page.screenshot({ path: path.join(media, "task-panel.png") });
	await page
		.getByRole("button", { name: /^Save/ })
		.screenshot({ path: path.join(media, "save-button.png") });
	await page
		.getByRole("textbox", { name: "Write a comment" })
		.fill("A clear note for the team.");
	const comment = page.getByRole("button", { name: /Add comment/ });
	await comment.scrollIntoViewIfNeeded();
	await comment.screenshot({ path: path.join(media, "comment-button.png") });
	await page.keyboard.press("Control+s");
	await page.waitForTimeout(300);
	await page.getByRole("button", { name: "Close task", exact: true }).click();
	await page.getByRole("link", { name: "Table", exact: true }).click();
	await page
		.getByRole("group", { name: "Filter statuses" })
		.getByRole("button", { name: "In progress", exact: true })
		.click();
	await page.getByRole("combobox", { name: "Filter assignee" }).click();
	await page.getByRole("option", { name: "Agents", exact: true }).click();
	await page.waitForTimeout(300);
	await page.screenshot({ path: path.join(media, "table-filters.png") });
	await page
		.getByRole("button", { name: "+ New task", exact: true })
		.first()
		.click();
	await page
		.getByRole("textbox", { name: "New task title" })
		.fill("Polish lantern falloff");
	await page.screenshot({ path: path.join(media, "table-inline.png") });
	await page.keyboard.press("Escape");
	await invoke("create_asset", {
		input: {
			kind: "sprite",
			name: "Danil laptop preview",
			location: path.join(
				root,
				"apps/desktop/src/assets/chibi/danil-laptop.png",
			),
			notes: "A registered local image preview.",
		},
	});
	await page.getByRole("link", { name: "Assets", exact: true }).click();
	await page.locator(".asset-preview").waitFor();
	await page.screenshot({ path: path.join(media, "assets-grid.png") });
	await page.getByRole("button", { name: "List view" }).click();
	await page.getByTestId("asset-list").waitFor();
	await page.screenshot({ path: path.join(media, "assets-list.png") });
	// Public README shots use the current UI and contain no cursor overlay.
	for (const t of ["light", "dark"]) {
		await theme(t);
		await page.getByRole("link", { name: "Board", exact: true }).click();
		await page.waitForTimeout(300);
		await page.screenshot({
			path: path.join(root, `docs/media/readme-board-${t}.jpg`),
			type: "jpeg",
			quality: 90,
		});
	}
	await theme("light");
	await page.goto("http://tauri.localhost/table?status=todo,review");
	await page.getByTestId("table-row").first().waitFor();
	await page.screenshot({
		path: path.join(root, "docs/media/readme-table.jpg"),
		type: "jpeg",
		quality: 90,
	});
	await page.getByRole("link", { name: "Settings", exact: true }).click();
	await page.getByText("Your AI teammates", { exact: true }).waitFor();
	await page.waitForTimeout(200);
	// Exclude the private machine path below the token controls, without altering UI text.
	const tokenRow = await page
		.locator(".settings-card .setting-row")
		.nth(1)
		.boundingBox();
	await page.mouse.move(600, 55);
	await page.screenshot({
		path: path.join(root, "docs/media/readme-settings-mcp.jpg"),
		type: "jpeg",
		quality: 90,
		clip: {
			x: 0,
			y: 0,
			width: 1360,
			height: Math.ceil(tokenRow.y + tokenRow.height + 12),
		},
	});
	await writeFile(
		path.join(media, "capture-check.json"),
		JSON.stringify(
			{
				source: "real release WebView2 via CDP",
				freshKeys: "JB-*",
				cursorOverlay: false,
				viewport: await page.evaluate(() => ({
					width: innerWidth,
					height: innerHeight,
				})),
				crisp,
				systemScaleChanged: false,
				scaleFactor: await invoke("plugin:window|scale_factor", {
					label: "main",
				}),
				releaseSha256: createHash("sha256")
					.update(
						await readFile(path.join(root, "target/release/jam-board.exe")),
					)
					.digest("hex"),
				scaleVerification:
					"Current native display scale and enlarged before/after crop; no OS display settings changed; a separate Windows 125% run was not performed",
			},
			null,
			2,
		) + "\n",
	);
	// Retain the original full-size screenshots; enlarged comparison is a nearest-neighbor inspection aid.
	await sharp(path.join(media, "card-sharpness.png"))
		.resize({ width: 600, kernel: "nearest" })
		.png()
		.toFile(path.join(media, "card-sharpness-zoom.png"));
	const beforeFile = path.join(root, "docs/media/m4.1/content-board-light.png");
	if (await stat(beforeFile).catch(() => null)) {
		const before = await sharp(beforeFile)
			.extract({ left: 338, top: 222, width: 238, height: 176 })
			.resize({ width: 476, kernel: "nearest" })
			.toBuffer();
		const after = await sharp(path.join(media, "card-sharpness.png"))
			.extend({ top: 0, bottom: 11, left: 0, right: 12, background: "#F7F1E6" })
			.resize({ width: 476, kernel: "nearest" })
			.toBuffer();
		const label = Buffer.from(
			'<svg width="980" height="40"><text x="10" y="25" font-size="16" font-family="sans-serif" fill="#2B2622">Before · M4.1 · 2×</text><text x="500" y="25" font-size="16" font-family="sans-serif" fill="#2B2622">After · M6.2 · 2×</text></svg>',
		);
		await sharp({
			create: { width: 980, height: 400, channels: 4, background: "#F7F1E6" },
		})
			.composite([
				{ input: label, top: 0, left: 0 },
				{ input: before, top: 40, left: 0 },
				{ input: after, top: 40, left: 490 },
			])
			.png()
			.toFile(path.join(media, "card-sharpness-comparison.png"));
	}
	for (const t of ["light", "dark"]) {
		await theme(t);
		for (const [route, title] of [
			["team", "The team"],
			["activity", "Activity"],
			["settings", "Settings"],
		]) {
			await page
				.getByRole("link", {
					name: route[0].toUpperCase() + route.slice(1),
					exact: true,
				})
				.click();
			await page.getByRole("heading", { name: title, exact: true }).waitFor();
			await capture({
				path: path.join(media, `screen-${route}-${t}.jpg`),
				type: "jpeg",
				quality: 88,
			});
		}
	}
	await page.getByRole("button", { name: "Board", exact: true }).click();
	await capture({ path: path.join(media, "settings-board.png") });
	const fonts = await page.evaluate(async () => {
		const families = ["Manrope Variable", "JetBrains Mono Variable"];
		for (const family of families)
			await document.fonts.load(`12px "${family}"`);
		const panel = document.createElement("div");
		panel.id = "estimate-font-check";
		panel.style.cssText =
			"position:fixed;left:100px;top:100px;z-index:100000;padding:24px;background:var(--card);color:var(--ink);width:500px";
		const heading = document.createElement("p");
		heading.textContent = "Typography test panel (not a product screen)";
		panel.append(heading);
		const values = [];
		for (const family of families) {
			const row = document.createElement("div");
			row.style.cssText =
				"display:flex;align-items:center;gap:12px;margin:20px 0";
			const label = document.createElement("span");
			label.textContent = family;
			label.style.width = "200px";
			row.append(label);
			for (const n of [1, 2, 3, 5, 8]) {
				const badge = document.createElement("span");
				badge.className = "estimate";
				badge.style.fontFamily = `"${family}"`;
				badge.textContent = String(n);
				row.append(badge);
			}
			panel.append(row);
			const context = document.createElement("canvas").getContext("2d");
			context.font = `12px "${family}"`;
			const m = context.measureText("12358");
			values.push({
				family,
				ascent: m.actualBoundingBoxAscent,
				descent: m.actualBoundingBoxDescent,
			});
		}
		document.body.append(panel);
		return values;
	});
	await page
		.locator("#estimate-font-check")
		.screenshot({ path: path.join(root, ".dev-data/estimate-font-check.png") });
	await page.evaluate(() =>
		document.getElementById("estimate-font-check").remove(),
	);
	await writeFile(
		path.join(media, "font-check.json"),
		JSON.stringify(
			{
				chosen: "Manrope Variable",
				reason:
					"Centered 20px inline-grid and line-height:1, consistent UI numerals; both local font candidates rendered and compared",
				fonts,
			},
			null,
			2,
		) + "\n",
	);
	console.log(
		JSON.stringify({
			captured: true,
			directory: "docs/media/m6.2",
			dataDirectory: path.relative(root, data),
		}),
	);
} finally {
	await browser?.close();
	if (child.exitCode === null)
		execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-Command",
				`(Get-Process -Id ${child.pid}).CloseMainWindow()`,
			],
			{ windowsHide: true },
		);
}
