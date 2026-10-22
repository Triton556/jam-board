import assert from "node:assert/strict";
import { test } from "node:test";
import { openStdio } from "./smoke-stdio.mjs";

test("stdio client preserves structured tool error codes rather than retrying", async () => {
	const client = openStdio(process.execPath, {
		args: [
			"--input-type=module",
			"--eval",
			`
    import { createInterface } from 'node:readline';
    createInterface({ input: process.stdin }).on('line', line => {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
        isError: true, structuredContent: { code: 'stale_claim', message: 'Observed claim changed' }
      } }) + '\\n');
    });
  `,
		],
		timeoutMs: 1000,
	});
	try {
		await assert.rejects(
			() => client.tool("claim_task", {}),
			(error) =>
				error.code === "stale_claim" &&
				error.message === "Observed claim changed",
		);
	} finally {
		await client.close();
	}
});

test("stdio client fails outstanding requests promptly when the child exits", async () => {
	const client = openStdio(process.execPath, {
		args: ["--eval", "process.exit(7)"],
		timeoutMs: 1000,
	});
	try {
		await assert.rejects(
			() => client.request("initialize", {}),
			/MCP exited \(7\)/,
		);
	} finally {
		await client.close();
	}
});

test("stdio client rejects malformed frames and does not continue a protocol session", async () => {
	const client = openStdio(process.execPath, {
		args: [
			"--eval",
			"process.stdout.write('not JSON\\n'); process.stdin.resume()",
		],
		timeoutMs: 1000,
	});
	try {
		await assert.rejects(
			() => client.request("initialize", {}),
			/invalid JSON/,
		);
		await assert.rejects(
			() => client.request("tools/list", {}),
			/invalid JSON/,
		);
	} finally {
		await client.close();
	}
});

test("stdio timeout is reported without resending the request", async () => {
	const client = openStdio(process.execPath, {
		args: ["--eval", "process.stdin.resume()"],
		timeoutMs: 30,
	});
	try {
		await assert.rejects(
			() => client.request("initialize", {}),
			/MCP timeout: initialize/,
		);
	} finally {
		await client.close();
	}
});
