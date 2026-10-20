// Per-user NSIS round-trip. Never changes script execution policy or existing user data.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	readdir,
	stat,
	lstat,
	realpath,
	readFile,
	writeFile,
	mkdir,
	rm,
	copyFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = path.join(root, ".dev-data/install-temp");
await mkdir(temporary, { recursive: true });
const toolEnv = { ...process.env, TEMP: temporary, TMP: temporary };
const started = Date.now();
const installDir = path.join(process.env.LOCALAPPDATA, "Jam Board");
const dataDir = path.join(process.env.APPDATA, "dev.triton556.jamboard");
const database = path.join(dataDir, "jam.db");
const output = path.join(root, "docs/media/m6/install-check.json");
const exists = async (p) =>
	stat(p).then(
		() => true,
		(error) => {
			if (error.code === "ENOENT") return false;
			throw error;
		},
	);
const run = (file, args, options = {}) =>
	new Promise((resolve, reject) => {
		const p = spawn(file, args, {
			windowsHide: true,
			env: toolEnv,
			stdio: "inherit",
			...options,
		});
		p.on("error", reject);
		p.on("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${path.basename(file)} exited ${code}`)),
		);
	});
const sha = async (p) =>
	createHash("sha256")
		.update(await readFile(p))
		.digest("hex");
const ps = (command) =>
	execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
		encoding: "utf8",
		windowsHide: true,
	})
		.replace(/^\uFEFF/, "")
		.trim();
const shortcuts = async () => {
	const roots = [
		path.join(
			process.env.APPDATA,
			"Microsoft",
			"Windows",
			"Start Menu",
			"Programs",
		),
		ps("[Environment]::GetFolderPath('Desktop')"),
	];
	const found = [];
	const walk = async (dir, depth = 0) => {
		for (const e of await readdir(dir, { withFileTypes: true }).catch(
			() => [],
		)) {
			const p = path.join(dir, e.name);
			if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
			else if (/jam.?board.*\.lnk$/i.test(e.name)) found.push(p);
		}
	};
	for (const r of roots) if (r) await walk(r);
	return found.sort();
};
const result = {
	startedAt: new Date(started).toISOString(),
	perUser: true,
	executionPolicyChanged: false,
	steps: {},
};
let app;
try {
	if (
		path.resolve(installDir).toLowerCase() !==
		path.resolve(process.env.LOCALAPPDATA, "Jam Board").toLowerCase()
	)
		throw new Error("Unsafe install target");
	if (await exists(installDir))
		throw new Error(
			"Test install directory already exists; it will not be overwritten",
		);
	const dataExisted = await exists(dataDir);
	result.dataDirectoryExistedBefore = dataExisted;
	if (dataExisted)
		throw new Error(
			"Default data directory existed before this scenario; preserving it without modifying the jam",
		);
	const beforeShortcuts = await shortcuts();
	if (beforeShortcuts.length)
		throw new Error(
			"Existing Jam Board shortcuts are preserved; installation check refused",
		);
	const bundles = path.join(root, "target/release/bundle/nsis");
	const candidates = (await readdir(bundles)).filter((n) =>
		n.endsWith("-setup.exe"),
	);
	if (candidates.length !== 1)
		throw new Error("Expected one built NSIS installer");
	const installer = path.join(bundles, candidates[0]);
	result.installer = {
		path: path.relative(root, installer).replaceAll("\\", "/"),
		bytes: (await stat(installer)).size,
		sha256: await sha(installer),
	};
	result.steps.install = { ok: false, attempted: true, silent: true };
	await run(installer, ["/S"]);
	result.steps.install.exitCode = 0;
	const executable = path.join(installDir, "jam-board.exe"),
		sidecar = path.join(installDir, "jam-board-mcp.exe");
	result.steps.install.application = await exists(executable);
	result.steps.install.sidecar = await exists(sidecar);
	if (!result.steps.install.application || !result.steps.install.sidecar)
		throw new Error("Installed application or bundled sidecar is missing");
	const applicationHashMatches =
		(await sha(executable)) ===
		(await sha(path.join(root, "target/release/jam-board.exe")));
	const sidecarHashMatches =
		(await sha(sidecar)) ===
		(await sha(path.join(root, "target/release/jam-board-mcp.exe")));
	if (!applicationHashMatches || !sidecarHashMatches)
		throw new Error("Installed binaries differ from the packaged release");
	const installedShortcuts = (await shortcuts()).filter(
		(p) => !beforeShortcuts.includes(p),
	);
	if (!installedShortcuts.length)
		throw new Error("No new per-user Jam Board shortcut");
	result.steps.install = {
		ok: true,
		application: true,
		sidecar: true,
		applicationHashMatches,
		sidecarHashMatches,
		shortcuts: installedShortcuts.map((p) => path.basename(p)),
	};
	const env = {
		...toolEnv,
		WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223",
	};
	delete env.JAM_BOARD_DATA_DIR;
	delete env.JAM_BOARD_DB;
	app = spawn(executable, [], { env, windowsHide: false, stdio: "ignore" });
	if (!Number.isInteger(app.pid))
		throw new Error("Installed application did not start");
	await run(
		process.execPath,
		[path.join(root, "scripts/m6-installed-check.mjs"), sidecar],
		{ env },
	);
	result.steps.live = JSON.parse(
		await readFile(path.join(root, ".dev-data/m6-installed-live.json"), "utf8"),
	);
	ps(`(Get-Process -Id ${app.pid}).CloseMainWindow()`);
	for (let i = 0; i < 100 && app.exitCode === null; i++) await delay(100);
	if (app.exitCode === null)
		throw new Error("Installed window did not close normally");
	app = null;
	const dbHash = await sha(database);
	const dataInfo = await lstat(dataDir);
	result.steps.close = { ok: true };
	// Preserve the generated test token only in ignored local data for the final secret audit.
	await mkdir(path.join(root, ".dev-data/m6-installed-audit"), {
		recursive: true,
	});
	await copyFile(
		path.join(dataDir, "mcp-token"),
		path.join(root, ".dev-data/m6-installed-audit/mcp-token"),
	);
	await run(path.join(installDir, "uninstall.exe"), ["/S"]);
	for (
		let i = 0;
		i < 150 &&
		((await exists(executable)) ||
			(await exists(path.join(installDir, "uninstall.exe"))));
		i++
	)
		await delay(100);
	const remainingShortcuts = (await shortcuts()).filter((p) =>
		installedShortcuts.includes(p),
	);
	const programFilesRemoved =
		!(await exists(executable)) &&
		!(await exists(sidecar)) &&
		!(await exists(path.join(installDir, "uninstall.exe")));
	const retained = (await exists(database)) && (await sha(database)) === dbHash;
	result.steps.uninstall = {
		ok: programFilesRemoved && retained && !remainingShortcuts.length,
		programFilesRemoved,
		shortcutsRemoved: remainingShortcuts.length === 0,
		databaseRetained: retained,
		databaseUnchanged: retained,
	};
	if (!result.steps.uninstall.ok)
		throw new Error("Uninstall/retention verification failed");
	// A fixed, non-reparse target created during this exact run is the only recursive cleanup allowed here.
	const expected = path.resolve(process.env.APPDATA, "dev.triton556.jamboard");
	const actual = await realpath(dataDir);
	const owned =
		!dataExisted &&
		dataInfo.birthtimeMs >= started &&
		!dataInfo.isSymbolicLink() &&
		actual.toLowerCase() === expected.toLowerCase();
	if (!owned)
		throw new Error(
			"Data directory creation/ownership could not be verified; cleanup refused",
		);
	await rm(actual, { recursive: true });
	result.steps.cleanup = {
		ok: !(await exists(dataDir)),
		creationTimeVerified: true,
		onlyScenarioDataRemoved: true,
	};
	result.ok = true;
} catch (error) {
	result.ok = false;
	result.error = String(error);
	process.exitCode = 1;
} finally {
	if (app?.exitCode === null) {
		try {
			ps(`(Get-Process -Id ${app.pid}).CloseMainWindow()`);
		} catch {}
	}
	result.finishedAt = new Date().toISOString();
	for (const step of ["live", "close", "uninstall", "cleanup"]) {
		result.steps[step] ??= {
			status: "not_run",
			reason: "An earlier required step did not complete",
		};
	}
	await mkdir(path.dirname(output), { recursive: true });
	await writeFile(output, JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify(result, null, 2));
}
