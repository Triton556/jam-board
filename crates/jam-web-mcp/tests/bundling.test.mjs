import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

test("W7 prepares both real sidecar names in debug and release bundles", async () => {
  const originals = {
    execFileSync: childProcess.execFileSync,
    copyFileSync: fs.copyFileSync,
    mkdirSync: fs.mkdirSync,
    argv: process.argv,
  };
  const target = process.platform === "win32" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu";
  const extension = process.platform === "win32" ? ".exe" : "";
  try {
    for (const profile of ["debug", "release"]) {
      const calls = [];
      const copies = [];
      childProcess.execFileSync = (command, args) => {
        calls.push([command, args]);
        if (command === "rustc") return `host: ${target}\n`;
      };
      fs.copyFileSync = (from, to) => copies.push([from, to]);
      fs.mkdirSync = () => {};
      process.argv = ["node", "prepare-sidecar.mjs", ...(profile === "release" ? ["--release"] : [])];
      syncBuiltinESMExports();
      await import(new URL(`../../../apps/desktop/scripts/prepare-sidecar.mjs?case=${profile}`, import.meta.url));
      assert.deepEqual(calls[0], ["cargo", ["build", "-p", "jam-mcp-cli", "-p", "jam-web-mcp", ...(profile === "release" ? ["--release"] : [])]]);
      assert.equal(copies.length, 2);
      for (const [index, name] of ["jam-board-mcp", "jam-web-mcp"].entries()) {
        assert.ok(copies[index][0].endsWith(`target/${profile}/${name}${extension}`));
        assert.ok(copies[index][1].pathname.endsWith(`/binaries/${name}-${target}${extension}`));
      }
    }
    const config = JSON.parse(fs.readFileSync(new URL("../../../apps/desktop/src-tauri/tauri.conf.json", import.meta.url)));
    assert.ok(config.bundle.externalBin.includes("binaries/jam-board-mcp"));
    assert.ok(config.bundle.externalBin.includes("binaries/jam-web-mcp"));
  } finally {
    childProcess.execFileSync = originals.execFileSync;
    fs.copyFileSync = originals.copyFileSync;
    fs.mkdirSync = originals.mkdirSync;
    process.argv = originals.argv;
    syncBuiltinESMExports();
  }
});
