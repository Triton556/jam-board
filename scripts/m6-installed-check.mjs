// Drive only the installed Jam Board WebView and its installed stdio sidecar.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(
	new URL("../apps/desktop/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const executable = process.argv[2];
if (!executable) throw new Error("Pass the installed sidecar path.");
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
	try {
		browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
		break;
	} catch {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
if (!browser) throw new Error("Installed WebView diagnostics did not start.");
let page;
for (let attempt = 0; attempt < 150; attempt++) {
	page = browser
		.contexts()
		.flatMap((context) => context.pages())
		.find((page) => /tauri\.localhost/.test(page.url()));
	if (page) break;
	await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!page) throw new Error("No installed Jam Board page.");
await page.waitForFunction(
	() => document.documentElement.dataset.ready === "true",
);
const invoke = (command, args = {}) =>
	page.evaluate(
		({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
		{ command, args },
	);
let state = await invoke("app_state");
const onboarding = !state.hasJam;
if (onboarding)
	await page
		.getByRole("button", { name: "Load demo jam", exact: true })
		.click();
await page.getByTestId("task-card").first().waitFor();
state = await invoke("app_state");
const runtime = await invoke("runtime_info");
if (
	!/[\\/]AppData[\\/]Roaming[\\/]dev\.triton556\.jamboard$/i.test(
		runtime.dataDir,
	)
)
	throw new Error(
		"Installed app did not use its default roaming data directory.",
	);
const env = { ...process.env, JAM_AGENT_NAME: "Codex", RUST_LOG: "warn" };
delete env.JAM_BOARD_DATA_DIR;
delete env.JAM_BOARD_DB;
const server = spawn(executable, [], {
	env,
	windowsHide: true,
	stdio: ["pipe", "pipe", "inherit"],
});
const pending = new Map();
let sequence = 0;
const lines = createInterface({ input: server.stdout });
lines.on("line", (line) => {
	const result = JSON.parse(line),
		entry = pending.get(result.id);
	if (entry) {
		clearTimeout(entry.timer);
		pending.delete(result.id);
		result.error
			? entry.reject(new Error(JSON.stringify(result.error)))
			: entry.resolve(result.result);
	}
});
const request = (method, params) =>
	new Promise((resolve, reject) => {
		const id = ++sequence;
		const timer = setTimeout(
			() => reject(new Error(`Timeout: ${method}`)),
			10000,
		);
		pending.set(id, { resolve, reject, timer });
		server.stdin.write(
			JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
		);
	});
try {
	await request("initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "codex-installed-m6", version: "1" },
	});
	server.stdin.write(
		JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
			"\n",
	);
	const started = Date.now();
	const result = await request("tools/call", {
		name: "create_task",
		arguments: {
			title: "Installed Codex: tune the lantern glow",
			tags: ["polish"],
			idempotencyKey: "m6-installed-check",
		},
	});
	if (result.isError) throw new Error(JSON.stringify(result.content));
	const key = result.structuredContent.key;
	const card = page.locator(`[data-key="${key}"]`);
	await card.waitFor();
	const deliveryMs = Date.now() - started;
	const highlighted = (await card.getAttribute("data-highlighted")) === "true";
	const claimed = await request("tools/call", {
		name: "claim_task",
		arguments: { key },
	});
	if (claimed.isError) throw new Error("Installed claim failed");
	await page.waitForFunction(
		(key) =>
			document.querySelector(`[data-column="in_progress"] [data-key="${key}"]`),
		key,
	);
	await card.scrollIntoViewIfNeeded();
	await page.waitForTimeout(150);
	await mkdir(new URL("../docs/media/m6/", import.meta.url), {
		recursive: true,
	});
	await page.screenshot({
		path: fileURLToPath(
			new URL("../docs/media/m6/installed-agent-card.png", import.meta.url),
		),
	});
	await request("tools/call", {
		name: "add_comment",
		arguments: {
			key,
			body: "Verified the installed sidecar and default local database.",
		},
	});
	await page.waitForFunction(async () =>
		(await window.__TAURI_INTERNALS__.invoke("mcp_status")).recentCalls.some(
			(call) => call.tool === "add_comment",
		),
	);
	const status = await invoke("mcp_status");
	const members = await invoke("list_members");
	const check = {
		installed: true,
		onboarding,
		defaultDatabase: true,
		sidecarWithoutOverrides: true,
		key,
		deliveryMs,
		highlighted,
		claimed: claimed.structuredContent.status === "in_progress",
		assignedToCodex: members.some(
			(member) =>
				member.handle === "codex" &&
				member.id === claimed.structuredContent.assigneeId,
		),
		captureSource:
			"installed release WebView2 CDP content, without cursor overlay",
		codexOnline: members.some(
			(member) => member.handle === "codex" && member.online,
		),
		recentTools: status.recentCalls.map((call) => call.tool),
		jam: state.jam.name,
	};
	if (
		!check.codexOnline ||
		!check.claimed ||
		!check.assignedToCodex ||
		!highlighted ||
		deliveryMs > 1000
	)
		throw new Error("Installed live delivery/presence check failed.");
	await mkdir(new URL("../.dev-data/", import.meta.url), { recursive: true });
	await writeFile(
		new URL("../.dev-data/m6-installed-live.json", import.meta.url),
		JSON.stringify(check, null, 2) + "\n",
	);
	console.log(JSON.stringify(check));
} finally {
	server.stdin.end();
	lines.close();
	setTimeout(() => server.kill(), 500).unref();
	await browser.close();
}
