import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const files = {
  cargo: "Cargo.toml",
  lock: "Cargo.lock",
  package: "apps/desktop/package.json",
  npmLock: "apps/desktop/package-lock.json",
  tauri: "apps/desktop/src-tauri/tauri.conf.json",
  changelog: "CHANGELOG.md",
};
const crates = ["jam-board", "jam-core", "jam-mcp", "jam-mcp-cli"];

export function validateVersions(contents) {
  const version = contents.cargo.match(/\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("Cargo workspace version is missing or invalid");
  const pkg = JSON.parse(contents.package);
  const lock = JSON.parse(contents.npmLock);
  const versions = {
    "package.json": pkg.version,
    "package-lock.json": lock.version,
    "package-lock.json root package": lock.packages?.[""]?.version,
    "tauri.conf.json": JSON.parse(contents.tauri).version,
  };
  for (const name of crates) {
    const entry = contents.lock.split("[[package]]").find((part) => new RegExp(`^name = "${name}"$`, "m").test(part));
    versions[`Cargo.lock ${name}`] = entry?.match(/^version = "([^"]+)"/m)?.[1];
  }
  const mismatches = Object.entries(versions).filter(([, value]) => value !== version);
  if (mismatches.length)
    throw new Error(`Expected ${version}: ${mismatches.map(([name, value]) => `${name} has ${value ?? "no version"}`).join("; ")}`);
  if (!contents.changelog.split("\n").some((line) => line.startsWith(`## [${version}]`)))
    throw new Error(`CHANGELOG.md needs a [${version}] release section`);
  return version;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const contents = Object.fromEntries(Object.entries(files).map(([name, path]) => [name, readFileSync(new URL(path, root), "utf8")]));
    console.log(`Version ${validateVersions(contents)} matches app, native workspace, locks and changelog.`);
  } catch (error) {
    console.error(`${fileURLToPath(root)}: ${error.message}`);
    process.exitCode = 1;
  }
}
