// Record the actual release WebView. captureFrame returns a CDP content JPEG without a cursor overlay.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
export async function recordDemo({ page, captureFrame }) {
	const invoke = (command, args = {}) =>
		page.evaluate(
			({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
			{ command, args },
		);
	const runtime = await invoke("runtime_info");
	const state = await invoke("app_state");
	if (
		!/[\\/]\.dev-data[\\/]capture-/.test(runtime.dataDir) ||
		state.jam?.keyPrefix !== "JB"
	)
		throw new Error("Use fresh isolated JB-* capture data.");
	const board = await invoke("list_board_tasks");
	const target = board.in_progress.find((task) => !task.assigneeId);
	if (!target) throw new Error("Need an unassigned in-progress demo task.");
	const server = spawn(runtime.sidecarPath, [], {
		windowsHide: true,
		env: {
			JAM_BOARD_DATA_DIR: runtime.dataDir,
			JAM_AGENT_NAME: "Codex",
			RUST_LOG: "warn",
		},
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
			const id = ++sequence,
				timer = setTimeout(
					() => reject(new Error(method + " timed out")),
					10000,
				);
			pending.set(id, { resolve, reject, timer });
			server.stdin.write(
				JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
			);
		});
	const call = async (name, args) => {
		const result = await request("tools/call", { name, arguments: args });
		if (result.isError) throw new Error(JSON.stringify(result.content));
		return result.structuredContent;
	};
	const frames = [];
	const captions = [];
	const transcript = [];
	try {
		await request("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "codex-m6-demo", version: "1" },
		});
		server.stdin.write(
			JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
				"\n",
		);
		await page.getByRole("link", { name: "Board", exact: true }).click();
		await page.getByTestId("task-card").first().waitFor();
		// Arrange the real demo beforehand so an appended To do card stays above the fold.
		for (const task of board.todo.slice(2))
			await invoke("move_task", {
				input: {
					key: task.key,
					status: "backlog",
					beforeKey: null,
					afterKey: null,
				},
			});
		await page.waitForTimeout(5200);
		await page.mouse.move(65, 90);
		let caption = "Humans and AI teammates, sharing one local board.";
		let created;
		const started = Date.now();
		for (let index = 0; index < 90; index++) {
			if (index === 12) {
				const at = Date.now();
				created = await call("create_task", {
					title: "Lantern glow: softer light",
					tags: ["polish"],
					priority: "high",
				});
				caption = `Codex > create_task("Lantern glow: softer light")  ->  ${created.key}`;
				await page.locator(`[data-key="${created.key}"]`).waitFor();
				transcript.push({
					tool: "create_task",
					key: created.key,
					visibleAfterMs: Date.now() - at,
				});
			}
			if (index === 38) {
				await call("claim_task", { key: target.key });
				caption = `Codex > claim_task("${target.key}")  ->  assigned to Codex`;
				transcript.push({ tool: "claim_task", key: target.key });
			}
			if (index === 62) {
				await call("move_task", {
					key: target.key,
					status: "review",
					beforeKey: board.review[0]?.key,
				});
				caption = `Codex > move_task("${target.key}", "review")  ->  ready for a human`;
				await page
					.locator(`[data-column="review"] [data-key="${target.key}"]`)
					.waitFor();
				transcript.push({
					tool: "move_task",
					key: target.key,
					status: "review",
				});
			}
			frames.push(await captureFrame());
			captions.push(caption);
			await new Promise((resolve) =>
				setTimeout(
					resolve,
					Math.max(0, started + (index + 1) * 167 - Date.now()),
				),
			);
		}
		const frameDir = new URL("../.dev-data/m6-demo-frames/", import.meta.url);
		await mkdir(frameDir, { recursive: true });
		for (let i = 0; i < frames.length; i++)
			await writeFile(
				new URL(String(i).padStart(3, "0") + ".jpg", frameDir),
				frames[i],
			);
		await writeFile(
			new URL("capture.json", frameDir),
			JSON.stringify(
				{
					captions,
					transcript,
					frames: frames.length,
					delay: 167,
					contentOnly: true,
				},
				null,
				2,
			),
		);
		return { frames: frames.length, transcript, captured: true };
	} finally {
		server.stdin.end();
		lines.close();
		setTimeout(() => server.kill(), 500).unref();
	}
}
