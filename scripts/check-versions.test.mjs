import assert from "node:assert/strict";
import { test } from "node:test";
import { validateVersions } from "./check-versions.mjs";

function fixture(version = "0.3.0-alpha.1") {
  return {
    cargo: `[workspace.package]\nversion = "${version}"`,
    lock: ["jam-board", "jam-core", "jam-mcp", "jam-mcp-cli"].map((name) => `[[package]]\nname = "${name}"\nversion = "${version}"`).join("\n\n"),
    package: JSON.stringify({ version }),
    npmLock: JSON.stringify({ version, packages: { "": { version } } }),
    tauri: JSON.stringify({ version }),
    changelog: `# Changelog\n\n## [${version}] - 2026-10-21\n`,
  };
}

test("accepts synchronized release and prerelease versions", () => {
  assert.equal(validateVersions(fixture()), "0.3.0-alpha.1");
  assert.equal(validateVersions(fixture("0.3.0")), "0.3.0");
});
test("rejects mismatched app or lock metadata", () => {
  const data = fixture();
  data.tauri = JSON.stringify({ version: "0.2.0" });
  assert.throws(() => validateVersions(data), /tauri.conf.json has 0.2.0/);
  const missing = fixture();
  missing.lock = missing.lock.replace('name = "jam-mcp-cli"', 'name = "other-crate"');
  assert.throws(() => validateVersions(missing), /jam-mcp-cli has no version/);
});
test("requires the version's release-style changelog entry", () => {
  const data = fixture();
  data.changelog = "## [Unreleased]";
  assert.throws(() => validateVersions(data), /needs a \[0.3.0-alpha.1\] release section/);
});
