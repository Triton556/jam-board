// Run the regular Tauri bundler; it owns download URLs and SHA verification.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, ".dev-data"), { recursive: true });
const temporary = path.join(root, ".dev-data/nsis-temp");
await mkdir(temporary, { recursive: true });
const previous = await readFile(
	path.join(root, "docs/media/m6/bundler-tools.json"),
	"utf8",
)
	.then(JSON.parse)
	.catch(() => null);
const cache = path.join(root, "target/.tauri");
async function inventory(dir) {
	const files = [];
	async function walk(p) {
		for (const e of await readdir(p, { withFileTypes: true }).catch(() => [])) {
			const file = path.join(p, e.name);
			if (e.isDirectory()) await walk(file);
			else if (e.isFile())
				files.push({
					path: path.relative(cache, file).replaceAll("\\", "/"),
					bytes: (await stat(file)).size,
				});
		}
	}
	await walk(dir);
	return files;
}
const before = await inventory(cache),
	started = Date.now();
const log = createWriteStream(path.join(root, ".dev-data/m61-bundle.log"));
let output = "";
const p = spawn("cmd.exe", ["/d", "/c", "npm run tauri build"], {
	cwd: path.join(root, "apps/desktop"),
	env: {
		...process.env,
		TEMP: temporary,
		TMP: temporary,
		RUST_LOG: "tauri_bundler=debug",
	},
	windowsHide: true,
	stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [p.stdout, p.stderr])
	stream.on("data", (data) => {
		const text = data.toString();
		output += text;
		log.write(data);
		process.stdout.write(data);
	});
const exitCode = await new Promise((resolve, reject) => {
	p.on("error", reject);
	p.on("exit", resolve);
});
log.end();
const after = await inventory(cache),
	added = after.filter((f) => !before.some((b) => b.path === f.path));
const urls = [
	...new Set(
		output.match(
			/https:\/\/github\.com\/tauri-apps\/[A-Za-z0-9_./-]+\.(?:zip|dll)/g,
		) ?? [],
	),
];
const report = {
	command: "npm run tauri build",
	startedAt: new Date(started).toISOString(),
	finishedAt: new Date().toISOString(),
	exitCode,
	cache: "target/.tauri",
	downloadUrls: urls,
	newCachedFiles: added,
	newCachedBytes: added.reduce((n, f) => n + f.bytes, 0),
	hashVerification:
		"performed by the installed Tauri bundler; no manual downloads",
};
if (previous) {
	if (previous.downloadArtifacts) {
		report.downloadArtifacts = previous.downloadArtifacts;
		report.downloadPayloadBytes = previous.downloadPayloadBytes;
	}
	report.attempts = [...(previous.attempts ?? [previous]), { ...report }];
	report.attempts = report.attempts.map((attempt) => ({
		command: attempt.command,
		startedAt: attempt.startedAt,
		finishedAt: attempt.finishedAt,
		exitCode: attempt.exitCode,
		downloadUrls: attempt.downloadUrls,
		newCachedBytes: attempt.newCachedBytes,
		hashVerification: attempt.hashVerification,
	}));
	report.downloadUrls = [
		...new Set([...previous.downloadUrls, ...report.downloadUrls]),
	];
	report.newCachedFiles = [
		...previous.newCachedFiles,
		...report.newCachedFiles.filter(
			(f) => !previous.newCachedFiles.some((p) => p.path === f.path),
		),
	];
	report.newCachedBytes = report.newCachedFiles.reduce(
		(n, f) => n + f.bytes,
		0,
	);
}
await mkdir(path.join(root, "docs/media/m6"), { recursive: true });
await writeFile(
	path.join(root, "docs/media/m6/bundler-tools.json"),
	JSON.stringify(report, null, 2) + "\n",
);
process.exitCode = exitCode ?? 1;
