// Read metadata only for the exact artifacts already downloaded/verified by Tauri.
// No software payload is downloaded here.
import { readFile, writeFile } from "node:fs/promises";
const file = new URL("../docs/media/m6/bundler-tools.json", import.meta.url);
const report = JSON.parse(await readFile(file, "utf8"));
const allowed = new Set([
	"https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.13/nsis-3.13.zip",
	"https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll",
]);
const artifacts = [];
for (const url of report.downloadUrls) {
	if (!allowed.has(url)) throw new Error("Unexpected tool URL");
	const response = await fetch(url, { method: "HEAD", redirect: "follow" });
	if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`);
	const bytes = Number(response.headers.get("content-length"));
	if (!bytes) throw new Error("No artifact size header");
	artifacts.push({
		url,
		bytes,
		metadataMethod: "HEAD; binary body not requested",
	});
}
report.downloadArtifacts = artifacts;
report.downloadPayloadBytes = artifacts.reduce((n, a) => n + a.bytes, 0);
await writeFile(file, JSON.stringify(report, null, 2) + "\n");
console.log(
	JSON.stringify({ artifacts, totalBytes: report.downloadPayloadBytes }),
);
