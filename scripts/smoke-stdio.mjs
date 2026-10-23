import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function openStdio(
	executable,
	{ args = [], env, timeoutMs = 15000 } = {},
) {
	const server = spawn(executable, args, {
		env,
		windowsHide: true,
		stdio: ["pipe", "pipe", "inherit"],
	});
	const pending = new Map();
	const lines = createInterface({ input: server.stdout });
	let sequence = 0;
	let terminalError;
	const fail = (error) => {
		terminalError = error;
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
		pending.clear();
	};
	server.on("error", fail);
	server.stdin.on("error", fail);
	server.on("exit", (code, signal) =>
		fail(new Error(`MCP exited (${code ?? signal})`)),
	);
	lines.on("line", (line) => {
		let response;
		try {
			response = JSON.parse(line);
		} catch {
			fail(new Error("MCP emitted invalid JSON"));
			return;
		}
		const entry = pending.get(response.id);
		if (!entry) return;
		clearTimeout(entry.timer);
		pending.delete(response.id);
		if (response.error) entry.reject(new Error(JSON.stringify(response.error)));
		else entry.resolve(response.result);
	});
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			if (terminalError) {
				reject(terminalError);
				return;
			}
			const id = ++sequence;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`MCP timeout: ${method}`));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer });
			server.stdin.write(
				`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
			);
		});
	return {
		request,
		async initialize() {
			const result = await request("initialize", {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "jam-board-scripted-qa", version: "1" },
			});
			server.stdin.write(
				`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
			);
			return result;
		},
		async tool(name, args = {}) {
			const result = await request("tools/call", { name, arguments: args });
			if (result.isError) {
				const error = new Error(
					result.structuredContent?.message ?? JSON.stringify(result.content),
				);
				error.code = result.structuredContent?.code;
				throw error;
			}
			return result.structuredContent;
		},
		async close() {
			if (server.exitCode === null && server.signalCode === null) {
				server.stdin.end();
				await new Promise((resolve) => {
					const timer = setTimeout(() => {
						server.kill();
						resolve();
					}, 1000);
					server.once("exit", () => {
						clearTimeout(timer);
						resolve();
					});
				});
			}
			lines.close();
			fail(new Error("MCP client closed"));
		},
	};
}
