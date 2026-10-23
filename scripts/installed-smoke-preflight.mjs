import assert from "node:assert/strict";
import { lstat, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export function assertWindowsInstallEnvironment({
	platform = process.platform,
	env = process.env,
	argv = process.argv,
} = {}) {
	assert.equal(
		platform,
		"win32",
		"Windows install lifecycle is NOT_RUN on this platform",
	);
	assert.ok(
		argv.includes("--fresh-disposable-install"),
		"Explicit --fresh-disposable-install is required; this installs and uninstalls an isolated QA fixture",
	);
	for (const name of ["APPDATA", "LOCALAPPDATA"])
		assert.ok(
			env[name] && path.win32.isAbsolute(env[name]),
			`${name} must be an absolute Windows path`,
		);
	for (const name of [
		"JAM_BOARD_DB",
		"JAM_BOARD_DATA_DIR",
		"JAM_BOARD_PROJECT",
	])
		assert.ok(
			!env[name],
			`${name} must be unset for the default-path install check`,
		);
}

export function assertInstalledReceipt(
	receipt,
	{
		expectedDataDir,
		executable,
		parentPid,
		version,
		now = Date.now(),
		paths = path,
	} = {},
) {
	const same = (a, b) =>
		paths.resolve(a).toLowerCase() === paths.resolve(b).toLowerCase();
	assert.equal(receipt.schemaVersion, 1);
	assert.equal(
		receipt.fixtureDataAbsentBeforeRun,
		true,
		"Parent must have refused pre-existing data",
	);
	assert.equal(
		receipt.parentPid,
		parentPid,
		"Only the owning install-check parent may run this fixture",
	);
	assert.equal(
		receipt.version,
		version,
		"Install receipt version differs from checkout",
	);
	assert.ok(
		/^[0-9a-f-]{36}$/i.test(receipt.runId),
		"Missing unique install run ID",
	);
	assert.ok(
		Number.isFinite(receipt.startedAt) &&
			receipt.startedAt <= now &&
			now - receipt.startedAt < 30 * 60 * 1000,
		"Install receipt is stale",
	);
	assert.ok(
		same(receipt.dataDir, expectedDataDir),
		"Receipt must name the exact default data directory",
	);
	assert.ok(
		same(receipt.sidecar, executable),
		"Receipt must name the exact installed sidecar",
	);
	assert.ok(
		/^[0-9a-f]{64}$/.test(receipt.sidecarSha256),
		"Missing installed sidecar hash",
	);
	assert.equal(
		paths.basename(receipt.outputDir),
		`install-check-${receipt.runId}`,
		"Output must belong to this exact run",
	);
}

export function assertInstalledRuntime(receipt, runtime) {
	const same = (a, b) =>
		path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
	assert.ok(
		same(runtime.dataDir, receipt.dataDir),
		"WebView is connected to a different data directory",
	);
	assert.ok(
		same(runtime.sidecarPath, receipt.sidecar),
		"WebView belongs to a different installation",
	);
}

export async function assertFreshInstalledTarget({
	receipt,
	runtime,
	state,
	projects,
}) {
	assertInstalledRuntime(receipt, runtime);
	const same = (a, b) =>
		path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
	const data = await lstat(receipt.dataDir);
	assert.ok(
		data.isDirectory() && !data.isSymbolicLink(),
		"Fixture data directory must not be a reparse link",
	);
	assert.ok(
		same(await realpath(receipt.dataDir), receipt.dataDir),
		"Fixture data path is redirected",
	);
	assert.ok(
		data.birthtimeMs >= receipt.startedAt,
		"Fixture data predates this install run",
	);
	assert.equal(
		state.hasJam,
		false,
		"Refusing a WebView with an existing project",
	);
	assert.equal(
		state.currentMember,
		null,
		"Refusing an existing human identity",
	);
	assert.deepEqual(
		projects,
		[],
		"Refusing any pre-existing or archived project",
	);
	const hash = createHash("sha256")
		.update(await readFile(receipt.sidecar))
		.digest("hex");
	assert.equal(
		hash,
		receipt.sidecarSha256,
		"Installed sidecar changed after parent verification",
	);
}
