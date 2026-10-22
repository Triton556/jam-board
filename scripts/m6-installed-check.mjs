// Supported current-contract scenario. Parent-owned, fresh installed QA data ONLY.
// This does not represent real user approval or an AI worker session.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertFreshInstalledTarget,
	assertInstalledReceipt,
	assertInstalledRuntime,
} from "./installed-smoke-preflight.mjs";
import {
	assertCurrentContract,
	fixtureDisclosure,
	qaAgentName,
	qaHumanName,
	runInstalledWorkflow,
} from "./smoke-contracts.mjs";
import { openStdio } from "./smoke-stdio.mjs";

assert.equal(
	process.platform,
	"win32",
	"Installed WebView lifecycle is NOT_RUN on this platform",
);
const [executable, receiptPath] = process.argv.slice(2);
assert.ok(
	executable && receiptPath,
	"Run only through m6-install-check.mjs --fresh-disposable-install; a parent-owned receipt is required",
);
const root = fileURLToPath(new URL("../", import.meta.url));
const version = JSON.parse(
	await readFile(
		new URL("../apps/desktop/package.json", import.meta.url),
		"utf8",
	),
).version;
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
assertInstalledReceipt(receipt, {
	expectedDataDir: path.join(process.env.APPDATA, "dev.triton556.jamboard"),
	executable,
	parentPid: process.ppid,
	version,
});
assert.equal(
	path.resolve(receipt.outputDir),
	path.join(root, ".dev-data", `install-check-${receipt.runId}`),
);
for (const name of ["JAM_BOARD_DB", "JAM_BOARD_DATA_DIR", "JAM_BOARD_PROJECT"])
	assert.ok(!process.env[name], `${name} must be unset`);
const require = createRequire(
	new URL("../apps/desktop/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
let browser;
let client;
try {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	assert.ok(browser, "Installed WebView diagnostics did not start");
	let page;
	for (let attempt = 0; attempt < 150; attempt++) {
		page = browser
			.contexts()
			.flatMap((context) => context.pages())
			.find((candidate) => /tauri\.localhost/.test(candidate.url()));
		if (page) break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.ok(page, "No installed Jam Board page");
	await page.waitForFunction(
		() => document.documentElement.dataset.ready === "true",
	);
	const invoke = (command, args = {}) =>
		page.evaluate(
			({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
			{ command, args },
		);
	// All target/context checks precede ANY native or MCP domain mutation.
	assert.equal(
		await invoke("plugin:app|version"),
		version,
		"Installed native binary differs from checkout",
	);
	const runtime = await invoke("runtime_info");
	assertInstalledRuntime(receipt, runtime);
	await assertFreshInstalledTarget({
		receipt,
		runtime,
		state: await invoke("app_state"),
		projects: await invoke("list_projects", { includeArchived: true }),
	});
	const state = await invoke("create_jam", {
		input: {
			name: "Disposable installed smoke QA",
			yourName: qaHumanName,
			theme: null,
			startsAt: "",
			endsAt: "",
			timezone: "UTC",
			template: "custom",
			milestoneAt: null,
		},
	});
	assert.equal(state.currentMember.name, qaHumanName);
	assert.equal(state.currentMember.kind, "human");
	await page.goto(new URL("/board", page.url()).href);
	await page.waitForFunction(
		() => document.documentElement.dataset.ready === "true",
	);
	const env = { ...process.env, JAM_AGENT_NAME: qaAgentName, RUST_LOG: "warn" };
	delete env.JAM_BOARD_DB;
	delete env.JAM_BOARD_DATA_DIR;
	delete env.JAM_BOARD_PROJECT;
	client = openStdio(executable, { env });
	assertCurrentContract(
		await client.initialize(),
		await client.request("tools/list", {}),
		version,
	);
	const session = await client.tool("get_session_context");
	assert.equal(
		session.projectId,
		state.jam.id,
		"Sidecar did not bind the exact fresh project",
	);
	let deliveryMs;
	let highlighted;
	const workflow = await runInstalledWorkflow({
		tool: client.tool,
		invoke,
		qaHumanId: state.currentMember.id,
		async onCreated(task, started) {
			const card = page.locator(`[data-key="${task.key}"]`);
			await card.waitFor();
			deliveryMs = Date.now() - started;
			highlighted = (await card.getAttribute("data-highlighted")) === "true";
			assert.ok(
				highlighted && deliveryMs <= 1000,
				"Installed create delivery/highlight check failed",
			);
		},
		async onClaimed(task) {
			await page.waitForFunction(
				(key) =>
					document.querySelector(
						`[data-column="in_progress"] [data-key="${key}"]`,
					),
				task.key,
			);
			await page.locator(`[data-key="${task.key}"]`).scrollIntoViewIfNeeded();
			await page.screenshot({
				path: path.join(receipt.outputDir, "installed-agent-card.png"),
			});
		},
	});
	const members = await invoke("list_members");
	const worker = members.find(
		(member) => member.id === workflow.claimed.assigneeId,
	);
	assert.equal(worker?.name, qaAgentName);
	assert.equal(worker?.kind, "agent");
	assert.equal(worker?.online, true);
	const status = await invoke("mcp_status");
	const check = {
		installed: true,
		version,
		fixture: fixtureDisclosure,
		onboarding: "native create_jam QA fixture; Welcome form UI NOT_RUN",
		defaultDatabase: true,
		exactFreshTargetVerified: true,
		sidecarWithoutOverrides: true,
		projectId: session.projectId,
		key: workflow.key,
		deliveryMs,
		highlighted,
		claimed: true,
		pausedClaimRejected: true,
		independentReview: workflow.independentReview,
		reportId: workflow.reportId,
		workerOnline: true,
		recentTools: status.recentCalls.map((call) => call.tool),
		captureSource:
			"installed release WebView2 CDP content, without cursor overlay",
		windowsInstallLifecycle:
			"Checked separately by parent; not asserted by this child",
	};
	await writeFile(
		path.join(receipt.outputDir, "installed-live.json"),
		JSON.stringify(check, null, 2) + "\n",
	);
	console.log(JSON.stringify(check));
} finally {
	await client?.close();
	await browser?.close();
}
