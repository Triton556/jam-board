// Current MCP planning/gate smoke. Every run creates its own empty QA directory.
// No native human approval is fabricated; execution deliberately remains paused.
import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
	realpath,
	stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertCurrentContract,
	epicFixture,
	storyFixture,
	taskFixture,
	taskContext,
	expectToolFailure,
	qaAgentName,
} from "./smoke-contracts.mjs";
import { openStdio } from "./smoke-stdio.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const expectedVersion = JSON.parse(
	await readFile(
		new URL("../apps/desktop/package.json", import.meta.url),
		"utf8",
	),
).version;
const binary = path.resolve(
	process.argv[2] ??
		path.join(
			root,
			`target/debug/jam-board-mcp${process.platform === "win32" ? ".exe" : ""}`,
		),
);
assert.ok(
	(await stat(binary)).isFile(),
	"Build the current jam-mcp-cli sidecar first",
);
const base = path.join(root, ".dev-data");
await mkdir(base, { recursive: true });
assert.equal(
	await realpath(base),
	base,
	"QA directory must not redirect outside this checkout",
);
const data = await mkdtemp(path.join(base, "stdio-smoke-"));
const database = path.join(data, "jam.db");
// --db is explicit; inherited project/default-data settings cannot retarget it.
const env = {
	...process.env,
	JAM_BOARD_DATA_DIR: data,
	JAM_AGENT_NAME: qaAgentName,
	RUST_LOG: "warn",
};
delete env.JAM_BOARD_DB;
delete env.JAM_BOARD_PROJECT;
const client = openStdio(binary, {
	args: ["--db", database, "--seed-demo"],
	env,
});
const checks = {};
let observedVersion;
try {
	const initialized = await client.initialize();
	observedVersion = initialized.serverInfo?.version;
	assertCurrentContract(
		initialized,
		await client.request("tools/list", {}),
		expectedVersion,
	);
	checks.exactVersionAndRequiredSchemas = true;
	const session = await client.tool("get_session_context");
	const epic = await client.tool("create_epic", epicFixture());
	await client.tool("become_brain", { epicKey: epic.key });
	await client.tool("set_epic_status", { key: epic.key, status: "active" });
	const story = await client.tool("create_story", storyFixture(epic.key));
	await client.tool("set_story_status", { key: story.key, status: "active" });
	const created = await client.tool("create_task", taskFixture(story.key));
	assert.equal(
		(await client.tool("check_ready", { key: created.key })).ready,
		true,
	);
	const readyDecision = await client.tool("get_task", { key: created.key });
	await client.tool("mark_ready", taskContext(readyDecision));
	checks.completeHierarchyAndBrief = true;
	const claimDecision = await client.tool("get_task", { key: created.key });
	await expectToolFailure(
		client.tool,
		"claim_task",
		{ key: created.key },
		"validation",
	);
	const scope = { type: "story", id: story.id };
	assert.equal(
		(await client.tool("get_execution", { scope })).effectiveState,
		"paused",
	);
	await expectToolFailure(
		client.tool,
		"claim_task",
		taskContext(claimDecision),
		"execution_required",
	);
	checks.missingContextAndPausedClaimRejected = true;
	const unchanged = await client.tool("get_task", { key: created.key });
	assert.equal(unchanged.claimGeneration, claimDecision.claimGeneration);
	assert.equal(unchanged.updatedAt, claimDecision.updatedAt);
	assert.equal(unchanged.status, "ready");
	// Deliberate edit followed by a NEGATIVE old-payload test, never an auto-retry.
	await client.tool("update_task", {
		...taskContext(unchanged),
		description:
			"Deliberate fresh QA edit to invalidate the previously captured overwrite decision.",
	});
	await expectToolFailure(
		client.tool,
		"update_task",
		{
			...taskContext(unchanged),
			description: "This stale payload must not be applied.",
		},
		"conflict",
	);
	const afterConflict = await client.tool("get_task", { key: created.key });
	assert.equal(
		afterConflict.descriptionMd,
		"Deliberate fresh QA edit to invalidate the previously captured overwrite decision.",
	);
	checks.staleOverwriteRejectedWithoutReplay = true;
	assert.equal(
		(await client.tool("get_execution", { scope })).effectiveState,
		"paused",
	);
	checks.noExecutionGrantCreated = true;
	const result = {
		ok: true,
		version: initialized.serverInfo.version,
		database: path.relative(root, database),
		projectId: session.projectId,
		key: created.key,
		fixture:
			"Scripted disposable MCP fixture; seeded sample project, no human Start, no real user approval or AI worker session.",
		checks,
		nativeStartReportReview:
			"NOT_RUN: requires the separately simulated native fixture",
		windowsInstallLifecycle: "NOT_RUN",
	};
	await writeFile(
		path.join(data, "result.json"),
		JSON.stringify(result, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(JSON.stringify(result, null, 2));
} catch (error) {
	await writeFile(
		path.join(data, "result.json"),
		JSON.stringify(
			{
				ok: false,
				expectedVersion,
				observedVersion,
				checks,
				error: error.message,
				database: path.relative(root, database),
				windowsInstallLifecycle: "NOT_RUN",
			},
			null,
			2,
		) + "\n",
		{ flag: "wx" },
	);
	throw error;
} finally {
	await client.close();
}
