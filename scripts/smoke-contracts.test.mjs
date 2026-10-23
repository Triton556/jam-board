import assert from "node:assert/strict";
import { test } from "node:test";
import {
	readFile,
	realpath,
	mkdtemp,
	mkdir,
	writeFile,
	rm,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertHistoricalCapture } from "./historical-capture-guard.mjs";
import {
	assertWindowsInstallEnvironment,
	assertInstalledReceipt,
	assertFreshInstalledTarget,
} from "./installed-smoke-preflight.mjs";
import {
	assertCurrentContract,
	taskContext,
	nativeTaskContext,
	reviewContext,
	taskFixture,
	storyFixture,
	fixtureDisclosure,
	runInstalledWorkflow,
} from "./smoke-contracts.mjs";

test("historical captures reject current contracts even with the historical flag", () => {
	for (const version of ["0.3.0-alpha.6", "0.3.0-alpha.7", "0.3.0"]) {
		assert.throws(
			() =>
				assertHistoricalCapture(import.meta.url, {
					version,
					argv: ["--historical-contract-revalidated"],
				}),
			/historical capture/,
		);
	}
	assert.throws(
		() =>
			assertHistoricalCapture(import.meta.url, { version: "0.2.0", argv: [] }),
		/revalidated/,
	);
	assert.doesNotThrow(() =>
		assertHistoricalCapture(import.meta.url, {
			version: "0.2.0",
			argv: ["--historical-contract-revalidated"],
		}),
	);
});

test("every historical executable capture guards before its original body", async () => {
	for (const name of [
		"capture-0.1.1",
		"m2-smoke",
		"m3-live-demo",
		"m4-live-demo",
		"m4.1-capture",
		"m5-live-demo",
		"m6-demo",
		"m61-demo",
		"m62-capture",
		"v21-live-demo",
		"v22-live-demo",
		"v23-live-demo",
		"v24b-live-demo",
		"v251-live-demo",
	]) {
		const source = await readFile(
			new URL(`./${name}.mjs`, import.meta.url),
			"utf8",
		);
		assert.ok(
			source.startsWith(
				'import { assertHistoricalCapture } from "./historical-capture-guard.mjs";\nassertHistoricalCapture(import.meta.url);',
			),
			name,
		);
	}
});

test("Windows lifecycle preflight requires explicit intent, paths and no overrides", () => {
	const options = {
		platform: "win32",
		env: { APPDATA: "C:\\qa\\Roaming", LOCALAPPDATA: "C:\\qa\\Local" },
		argv: ["--fresh-disposable-install"],
	};
	assert.doesNotThrow(() => assertWindowsInstallEnvironment(options));
	assert.throws(
		() => assertWindowsInstallEnvironment({ ...options, platform: "linux" }),
		/NOT_RUN/,
	);
	assert.throws(
		() => assertWindowsInstallEnvironment({ ...options, argv: [] }),
		/Explicit/,
	);
	assert.throws(
		() =>
			assertWindowsInstallEnvironment({
				...options,
				env: { ...options.env, APPDATA: "relative" },
			}),
		/absolute/,
	);
	for (const name of [
		"JAM_BOARD_DB",
		"JAM_BOARD_DATA_DIR",
		"JAM_BOARD_PROJECT",
	]) {
		assert.throws(
			() =>
				assertWindowsInstallEnvironment({
					...options,
					env: { ...options.env, [name]: "override" },
				}),
			/must be unset/,
		);
	}
});

test("installed child receipt is exact, fresh and bound to its owning parent", () => {
	const runId = "12345678-1234-1234-1234-123456789012";
	const receipt = {
		schemaVersion: 1,
		fixtureDataAbsentBeforeRun: true,
		parentPid: 123,
		version: "0.3.0-alpha.7",
		runId,
		startedAt: 1000,
		dataDir: "C:\\QA\\Roaming\\dev.triton556.jamboard",
		sidecar: "C:\\QA\\Local\\Jam Board\\jam-board-mcp.exe",
		sidecarSha256: "a".repeat(64),
		outputDir: `C:\\checkout\\.dev-data\\install-check-${runId}`,
	};
	const options = {
		expectedDataDir: receipt.dataDir,
		executable: receipt.sidecar,
		parentPid: 123,
		version: receipt.version,
		now: 1500,
		paths: path.win32,
	};
	assert.doesNotThrow(() => assertInstalledReceipt(receipt, options));
	for (const patch of [
		{ fixtureDataAbsentBeforeRun: false },
		{ parentPid: 124 },
		{ version: "0.2.0" },
		{ startedAt: -2000000 },
		{ startedAt: 2000 },
		{ dataDir: "C:\\another-user" },
		{ sidecar: "C:\\other.exe" },
		{ sidecarSha256: "bad" },
		{ outputDir: "C:\\other" },
	]) {
		assert.throws(() =>
			assertInstalledReceipt({ ...receipt, ...patch }, options),
		);
	}
});

test("fresh installed target refuses existing state, wrong identity/path, links and replaced binaries", async () => {
	// TEMP may itself use an alias (for example an 8.3 Windows ancestor).
	// The receipt must name our newly created fixture's canonical path; the
	// production guard deliberately continues to reject redirected input paths.
	const dir = await realpath(
		await mkdtemp(path.join(tmpdir(), "jam-smoke-preflight-")),
	);
	try {
		const dataDir = path.join(dir, "data"),
			sidecar = path.join(dir, "sidecar");
		await mkdir(dataDir);
		await writeFile(sidecar, "test fixture executable bytes");
		const receipt = {
			dataDir,
			sidecar,
			sidecarSha256: createHash("sha256")
				.update("test fixture executable bytes")
				.digest("hex"),
			startedAt: Date.now() - 1000,
		};
		const input = {
			receipt,
			runtime: { dataDir, sidecarPath: sidecar },
			state: { hasJam: false, currentMember: null },
			projects: [],
		};
		await assertFreshInstalledTarget(input);
		for (const patch of [
			{ state: { hasJam: true, currentMember: null } },
			{ state: { hasJam: false, currentMember: { name: "Existing person" } } },
			{ projects: [{ archivedAt: "yesterday" }] },
			{ runtime: { dataDir: dir, sidecarPath: sidecar } },
			{ runtime: { dataDir, sidecarPath: path.join(dir, "another") } },
			{ receipt: { ...receipt, startedAt: Date.now() + 1000 } },
			{ receipt: { ...receipt, sidecarSha256: "b".repeat(64) } },
		]) {
			await assert.rejects(() =>
				assertFreshInstalledTarget({ ...input, ...patch }),
			);
		}
		const link = path.join(dir, "link");
		await symlink(dataDir, link, "junction");
		await assert.rejects(
			() =>
				assertFreshInstalledTarget({
					...input,
					receipt: { ...receipt, dataDir: link },
					runtime: { dataDir: link, sidecarPath: sidecar },
				}),
			/reparse link/,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("fresh target rejects an aliased parent and accepts the canonical owned fixture", async () => {
	const outer = await realpath(
		await mkdtemp(path.join(tmpdir(), "jam-smoke-parent-")),
	);
	try {
		const actual = path.join(outer, "actual"),
			alias = path.join(outer, "alias");
		await mkdir(actual);
		await symlink(actual, alias, "junction");
		const fixture = await mkdtemp(path.join(alias, "fixture-"));
		await mkdir(path.join(fixture, "data"));
		await writeFile(path.join(fixture, "sidecar"), "fixture bytes");
		const input = (root) => ({
			receipt: {
				dataDir: path.join(root, "data"),
				sidecar: path.join(root, "sidecar"),
				startedAt: Date.now() - 1000,
				sidecarSha256: createHash("sha256")
					.update("fixture bytes")
					.digest("hex"),
			},
			runtime: {
				dataDir: path.join(root, "data"),
				sidecarPath: path.join(root, "sidecar"),
			},
			state: { hasJam: false, currentMember: null },
			projects: [],
		});
		await assert.rejects(
			() => assertFreshInstalledTarget(input(fixture)),
			/Fixture data path is redirected/,
		);
		await assertFreshInstalledTarget(input(await realpath(fixture)));
	} finally {
		await rm(outer, { recursive: true, force: true });
	}
});

test("fixture brief and story provide real required fields and disclose simulated approval", () => {
	const story = storyFixture("QA-E1"),
		task = taskFixture("QA-S1");
	assert.equal(task.storyKey, "QA-S1");
	for (const field of ["goalMd", "whereMd", "resultMd"]) assert.ok(task[field]);
	assert.ok(task.changes.every((change) => change.title && change.required));
	assert.ok(task.tests.every((entry) => entry.setup && entry.expected));
	assert.ok(
		story.outcomeMd &&
			story.acceptance.some(
				(entry) => entry.mandatory && entry.criterion && entry.check,
			),
	);
	assert.equal(task.contextMd, fixtureDisclosure);
	assert.match(fixtureDisclosure, /not a real user's approval/);
});

test("captured task/review contexts require the exact observed fields", () => {
	const task = {
		key: "QA-1",
		updatedAt: "version:1",
		claimGeneration: "claim:1",
		status: "review",
		reviewRound: 2,
		reports: [
			{ id: "old", round: 1 },
			{ id: "inspected", round: 2 },
		],
		reviewContextRevision: "context:2",
	};
	assert.deepEqual(taskContext(task), {
		key: "QA-1",
		expectedUpdatedAt: "version:1",
		expectedClaimGeneration: "claim:1",
	});
	assert.deepEqual(nativeTaskContext(task), {
		key: "QA-1",
		expectedUpdatedAt: "version:1",
	});
	assert.deepEqual(reviewContext(task), {
		key: "QA-1",
		expectedReportId: "inspected",
		expectedReviewContextRevision: "context:2",
	});
	assert.throws(() => taskContext({ ...task, claimGeneration: "" }));
	assert.throws(() => nativeTaskContext({ ...task, updatedAt: "" }));
	assert.throws(() => reviewContext({ ...task, reviewContextRevision: null }));
	assert.throws(() => reviewContext({ ...task, reports: [] }));
	assert.throws(() => reviewContext({ ...task, status: "done" }));
});

function schemas() {
	return {
		tools: [
			...[
				"claim_task",
				"move_task",
				"mark_ready",
				"archive_task",
				"update_task",
				"update_task_brief",
			].map((name) => ({
				name,
				inputSchema: {
					required: ["expectedClaimGeneration", "expectedUpdatedAt"],
				},
			})),
			...["submit_report", "release_task"].map((name) => ({
				name,
				inputSchema: { required: ["expectedClaimGeneration"] },
			})),
			{
				name: "review_task",
				inputSchema: {
					required: ["expectedReportId", "expectedReviewContextRevision"],
				},
			},
		],
	};
}

test("current contract preflight rejects old binaries, optional validators and MCP Start bypass", () => {
	const init = { serverInfo: { name: "jam-board", version: "0.3.0-alpha.7" } };
	assert.doesNotThrow(() =>
		assertCurrentContract(init, schemas(), init.serverInfo.version),
	);
	assert.throws(
		() => assertCurrentContract(init, schemas(), "0.3.0-alpha.6"),
		/version differs/,
	);
	const old = schemas();
	old.tools[0].inputSchema.required = [];
	assert.throws(
		() => assertCurrentContract(init, old, init.serverInfo.version),
		/must require/,
	);
	const bypass = schemas();
	bypass.tools.push({ name: "set_execution" });
	assert.throws(
		() => assertCurrentContract(init, bypass, init.serverInfo.version),
		/approval bypass/,
	);
});

function workflowFixture(failure) {
	const calls = [];
	let running = false,
		revision = 1;
	let task = {
		key: "QA-1",
		status: "backlog",
		updatedAt: "v1",
		claimGeneration: "g1",
		reviewRound: 1,
		reports: [],
		reviewContextRevision: null,
	};
	const fail = (code) => {
		const error = new Error(code);
		error.code = code;
		throw error;
	};
	const snapshot = () => structuredClone(task);
	const bump = () => {
		task.updatedAt = `v${++revision}`;
	};
	const tool = async (name, args = {}) => {
		calls.push({ channel: "mcp", name, args: structuredClone(args) });
		if (name === "create_epic") return { key: "QA-E1", id: "epic" };
		if (name === "create_story") return { key: "QA-S1", id: "story" };
		if (name === "create_task" || name === "get_task") return snapshot();
		if (name === "get_execution")
			return {
				effectiveState: running ? "running" : "paused",
				revision: "scope-observed",
			};
		if (name === "claim_task") {
			assert.deepEqual(args, taskContext(task));
			if (!running) fail("execution_required");
			if (failure === "claim_task") fail("stale_claim");
			task.status = "in_progress";
			task.claimGeneration = "live-claim";
			task.assigneeId = "scripted-worker";
			bump();
			return snapshot();
		}
		if (name === "submit_report") {
			assert.equal(args.expectedClaimGeneration, "live-claim");
			task.status = "review";
			task.reports = [{ id: "exact-report", round: 1 }];
			task.reviewContextRevision = "inspected-context";
			bump();
			return task.reports[0];
		}
		if (name === "add_comment") return {};
		throw new Error(`Unexpected tool ${name}`);
	};
	const invoke = async (name, { input }) => {
		calls.push({ channel: "native", name, args: structuredClone(input) });
		if (name === failure) fail("conflict");
		if (name === "move_task" || name === "mark_ready") {
			assert.equal(input.expectedUpdatedAt, task.updatedAt);
			if (name === "mark_ready") {
				task.status = "ready";
				task.claimGeneration = "ready-claim";
			}
			bump();
		} else if (name === "set_execution") {
			assert.deepEqual(input, {
				scope: { type: "story", id: "story" },
				action: "start",
				expectedRevision: "scope-observed",
			});
			running = true;
		} else if (name === "review_task") {
			assert.equal(input.expectedReportId, "exact-report");
			assert.equal(input.expectedReviewContextRevision, "inspected-context");
			task.status = "done";
			return { reviewerId: "simulated-human", verdict: "accept" };
		} else assert.ok(["set_epic_status", "set_story_status"].includes(name));
		return snapshot();
	};
	return { calls, tool, invoke, qaHumanId: "simulated-human" };
}

test("installed fixture uses complete native CAS, paused rejection, live claim and exact independent review", async () => {
	const fixture = workflowFixture();
	const result = await runInstalledWorkflow(fixture);
	assert.equal(result.independentReview, true);
	assert.equal(result.reportId, "exact-report");
	assert.equal(
		fixture.calls.filter((call) => call.name === "claim_task").length,
		2,
	);
	assert.equal(
		fixture.calls.filter((call) => call.name === "set_execution").length,
		1,
	);
	assert.equal(
		fixture.calls.find((call) => call.name === "review_task").channel,
		"native",
	);
});

for (const failure of [
	"move_task",
	"mark_ready",
	"set_execution",
	"claim_task",
	"review_task",
]) {
	test(`installed fixture stops on ${failure} conflict without refresh/replay`, async () => {
		const fixture = workflowFixture(failure);
		await assert.rejects(
			() => runInstalledWorkflow(fixture),
			(error) => ["conflict", "stale_claim"].includes(error.code),
		);
		assert.equal(fixture.calls.at(-1).name, failure);
		assert.equal(
			fixture.calls.filter((call) => call.name === failure).length,
			failure === "claim_task" ? 2 : 1,
		);
	});
}
