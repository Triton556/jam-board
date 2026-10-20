import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { recordDemo } from "./m6-demo.mjs";
const require = createRequire(
	new URL("../apps/desktop/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
const data = path.join(
	root,
	".dev-data",
	`capture-20261020-m61-demo-${Date.now()}`,
);
const app = spawn(path.join(root, "target/release/jam-board.exe"), [], {
	windowsHide: false,
	stdio: "ignore",
	env: {
		...process.env,
		JAM_BOARD_DATA_DIR: data,
		WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223",
	},
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
	if (!browser) throw new Error("Release diagnostics did not start");
	let page;
	for (let i = 0; i < 150; i++) {
		page = browser
			.contexts()
			.flatMap((c) => c.pages())
			.find((p) => p.url().includes("tauri.localhost"));
		if (page) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	if (!page) throw new Error("Release page did not load");
	await page.waitForFunction(
		() => document.documentElement.dataset.ready === "true",
	);
	await page
		.getByRole("button", { name: "Load demo jam", exact: true })
		.click();
	await page.getByTestId("task-card").first().waitFor();
	await page.getByLabel("Theme", { exact: true }).selectOption("light");
	await page
		.getByRole("group", { name: "Color by", exact: true })
		.getByRole("button", { name: "Assignee", exact: true })
		.click();
	console.log(
		JSON.stringify(
			await recordDemo({
				page,
				captureFrame: () => page.screenshot({ type: "jpeg", quality: 90 }),
			}),
		),
	);
} finally {
	await browser?.close();
	if (app.exitCode === null)
		execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-Command",
				`(Get-Process -Id ${app.pid}).CloseMainWindow()`,
			],
			{ windowsHide: true },
		);
}
