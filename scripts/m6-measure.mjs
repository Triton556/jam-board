// Native process measurement without changing PowerShell's script-signing policy.
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const executable = path.resolve("target/release/jam-board.exe");
const data = path.resolve(
	process.env.JAM_MEASURE_DATA_DIR ?? ".dev-data/measure-m6",
);
if (
	!data
		.toLowerCase()
		.startsWith(path.resolve(".dev-data").toLowerCase() + path.sep)
)
	throw new Error("Measurements require workspace development data");
const powershell = (command) =>
	execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
		encoding: "utf8",
		windowsHide: true,
	})
		.replace(/^\uFEFF/, "")
		.trim();
const json = (command) => JSON.parse(powershell(command));
const env = { ...process.env, JAM_BOARD_DATA_DIR: data };
delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
const runs = [];
for (let run = 1; run <= 5; run++) {
	const child = spawn(executable, [], {
		env,
		windowsHide: false,
		stdio: "ignore",
	});
	const pid = child.pid;
	if (!Number.isInteger(pid)) throw new Error("Application did not launch");
	const started = Number(
		powershell(
			`[DateTimeOffset]::new((Get-Process -Id ${pid}).StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()`,
		),
	);
	let ready;
	const deadline = Date.now() + 30000;
	while (!ready && Date.now() < deadline) {
		const candidate = await readFile(
			path.join(data, "logs/app-ready.json"),
			"utf8",
		)
			.then(JSON.parse)
			.catch(() => null);
		if (candidate?.pid === pid) ready = candidate;
		else await delay(20);
	}
	if (!ready) throw new Error("No first-content-frame receipt");
	await delay(30000);
	const all = json(
		"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
	);
	const ids = new Set([pid]);
	let added;
	do {
		added = false;
		for (const item of all)
			if (ids.has(item.ParentProcessId) && !ids.has(item.ProcessId)) {
				ids.add(item.ProcessId);
				added = true;
			}
	} while (added);
	const filter = [...ids].map((id) => `IDProcess = ${id}`).join(" OR ");
	const counters = [
		json(
			`Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter '${filter}' | Select-Object IDProcess,Name,WorkingSetPrivate | ConvertTo-Json -Compress`,
		),
	].flat();
	const nativeFilter = [...ids].map((id) => `ProcessId = ${id}`).join(" OR ");
	const native = [
		json(
			`Get-CimInstance Win32_Process -Filter '${nativeFilter}' | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`,
		),
	].flat();
	const processes = counters.map((item) => ({
		pid: Number(item.IDProcess),
		name: item.Name,
		role:
			native
				.find((p) => p.ProcessId === item.IDProcess)
				?.CommandLine?.match(/--type=([a-z-]+)/)?.[1] ??
			(item.Name.includes("msedgewebview2") ? "browser" : "application"),
		privateWorkingSetBytes: Number(item.WorkingSetPrivate),
	}));
	if (!processes.some((item) => item.name.includes("msedgewebview2")))
		throw new Error("WebView2 counters missing");
	const entry = {
		run,
		startupMs: ready.readyAtUnixMs - started,
		privateWorkingSetBytes: processes.reduce(
			(sum, item) => sum + item.privateWorkingSetBytes,
			0,
		),
		processes,
	};
	runs.push(entry);
	console.log(
		JSON.stringify({
			run,
			startupMs: entry.startupMs,
			privateWorkingSetMiB: entry.privateWorkingSetBytes / 1024 / 1024,
		}),
	);
	if (
		powershell(`(Get-Process -Id ${pid}).CloseMainWindow()`).toLowerCase() !==
		"true"
	)
		throw new Error("Normal close request failed");
	await Promise.race([
		new Promise((resolve) => child.once("exit", resolve)),
		delay(10000).then(() => {
			throw new Error("Normal close timed out");
		}),
	]);
	await delay(1000);
}
const median = (key) => runs.map((run) => run[key]).sort((a, b) => a - b)[2];
const report = {
	releaseSha256: createHash("sha256")
		.update(await readFile(executable))
		.digest("hex"),
	build: "release",
	installed: false,
	measurementDriver:
		"Node; read-only inline Windows CIM queries; no execution-policy changes",
	debugger: false,
	osFileCacheFlushed: false,
	idleSeconds: 30,
	seedTasks: 32,
	medianStartupMs: median("startupMs"),
	medianPrivateWorkingSetBytes: median("privateWorkingSetBytes"),
	runs,
};
await writeFile(
	process.env.JAM_MEASURE_OUTPUT ?? "docs/media/m6/release-measurements.json",
	JSON.stringify(report, null, 2) + "\n",
);
console.log(
	JSON.stringify({
		medianStartupMs: report.medianStartupMs,
		medianPrivateWorkingSetMiB:
			report.medianPrivateWorkingSetBytes / 1024 / 1024,
	}),
);
