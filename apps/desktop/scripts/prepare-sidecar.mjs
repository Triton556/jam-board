import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const profile = process.argv.includes("--release") ? "release" : "debug";
execFileSync(
  "cargo",
  [
    "build",
    "-p",
    "jam-mcp-cli",
    ...(profile === "release" ? ["--release"] : []),
  ],
  { cwd: root, stdio: "inherit" },
);
const target = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
  /^host: (.+)$/m,
)?.[1];
if (!target) throw new Error("Cannot identify the Rust host target");
const ext = process.platform === "win32" ? ".exe" : "";
const binDir = new URL("../src-tauri/binaries/", import.meta.url);
mkdirSync(binDir, { recursive: true });
copyFileSync(
  `${root}target/${profile}/jam-board-mcp${ext}`,
  new URL(`jam-board-mcp-${target}${ext}`, binDir),
);
