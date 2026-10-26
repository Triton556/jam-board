# Release checklist

Use this checklist when preparing or publishing a release. Commit, push, tag and
publication each require the owner's authorization for the current task.

## Prepare the candidate

- Set the same release version in `Cargo.toml` (`workspace.package.version`),
  `apps/desktop/package.json`, `apps/desktop/package-lock.json` (top-level version
  and `packages[""].version`), and `apps/desktop/src-tauri/tauri.conf.json`.
  Workspace crates inherit their version; refresh `Cargo.lock` so **all** local
  workspace packages match, including newly added crates. Do not hand-edit
  unrelated dependency versions.
- Move the changes being released from `CHANGELOG.md`'s `[Unreleased]` section to
  `## [<version>] - YYYY-MM-DD`; retain an empty `[Unreleased]` heading for future
  work. Review any changes already filed under the candidate version so they are
  neither duplicated nor omitted.
- Create/update `docs/verification/<version>.md` with source identity, commands,
  outcomes, platform, artifact identity and remaining limitations. Distinguish
  DOM/mock, hosted browser, native package and human observations. Keep failures
  and blocked/unrun checks visible; do not inherit an earlier version's acceptance.
  Fold round/worker reports into this version record with their evidence boundaries.
- Run `node scripts/check-versions.mjs` and the version/contract/map tests listed
  in [CI](../.github/workflows/ci.yml). The version checker currently checks four
  Cargo lock entries (`jam-board`, `jam-core`, `jam-mcp`, `jam-mcp-cli`), the npm
  versions, Tauri version and changelog heading. It does not check every workspace
  crate, verification contents or the tag name; inspect those separately.
- Before pushing a release commit, run **`pwsh -File scripts/ci-local.ps1`** and
  require all executable gates to pass. Use installed stable Rust with rustfmt/
  Clippy and Node 22. The runner mirrors every Windows CI command in workflow
  order, including `npm ci`, all script tests, isolated `stdio-smoke`, both
  frontend typechecks, Vitest and `tauri build --debug --no-bundle`. It also
  installs Chromium and runs Playwright `--project=functional` on Windows as an
  additional gate; this does not check Linux behavior. Hosted setup/cache/upload
  actions and Linux-only/manual steps have explicit local mappings or skips in
  its pass/fail table. A failed gate exits nonzero and leaves later gates unrun.
- The runner rejects any change to its reviewed `ci.yml` fingerprint before
  executing gates. When CI changes, review/update its complete step mapping,
  commands, conditions, working directories, environment and setup requirements
  before updating that fingerprint. Do not simply repin it to bypass drift.
- Linux behavior is only checked on GitHub. `scripts/check-linux.ps1` remains an
  optional diagnostic; a partial cross-target check cannot replace Ubuntu CI.

## Push first, wait for CI, then tag

1. Freeze the candidate, record its full commit SHA and push the **branch first**
   when authorized. Do not push a release tag with the branch.
2. Wait for the `CI` workflow to finish successfully on **both `windows-latest`
   and `ubuntu-latest` for that exact release commit**. Verify the run's head SHA,
   rather than trusting a green badge or an older run. Any subsequent commit,
   including a verification edit, needs green CI for its new SHA before tagging.
3. CI runs version/contract/map checks, sidecar preparation, isolated MCP smoke,
   workspace fmt, all-targets Clippy with `-D warnings`, workspace tests, frontend
   lint/typechecks/e2e typecheck and Vitest on both OSes. Ubuntu additionally runs
   functional Chromium scenarios; Windows builds the debug desktop without a
   bundle. The hardware benchmark runs only through a manual dispatch with
   `perf` enabled; it is not a normal CI result.
4. Only after both jobs are green, create and push `v<version>` pointing to that
   exact commit when authorized. Check the tag resolves to the recorded SHA and
   agrees with the version files. A local Windows pass alone is insufficient.

## Inspect the draft, then publish alphas as prereleases

The [release workflow](../.github/workflows/release.yml) starts on pushed `v*`
tags. It does **not** depend on CI success: it installs npm dependencies and uses
Tauri to build/upload the Windows NSIS installer into a **draft** release, with
`prerelease: false`. It then checks the GUI executable and compares local/uploaded
installer checksums before uploading `SHA256SUMS.txt`. A draft can therefore exist
even if a later release step or the separate CI workflow fails.

- Wait for the entire `Draft Windows release` workflow and tag CI to succeed.
  Inspect the tag/commit, installer assets, checksum file and release notes.
  Record package/native checks actually performed, plus any remaining unrun cases.
- When publication is authorized, edit the draft: for `-alpha.*` versions set
  **prerelease = true**, then publish (**draft = false**). This is the publication
  mode used for alpha.41; the workflow's false default must be overridden.
  Do not mark an alpha as the stable/latest release.
- Verify the published prerelease flag, downloads and checksums. The installer is
  unsigned; preserve the README's SmartScreen and local-data instructions.
  Release/build success alone does not establish install/upgrade or UI acceptance.

## If CI fails after a tag

Stop publication and retain the draft. Record the exact SHA, failed job/step and
diagnostics in the version record; a successful installer build does not waive
the Windows/Ubuntu CI gate. For an infrastructure-only failure, rerun the same
commit and require both OSes green. For a source fix, prepare a **new version and
tag**, push its branch commit first and repeat the gates. Do not move/reuse the
failed tag or silently replace assets. If already published, notify the owner and
record the failure; any withdrawal or release change needs explicit authorization.
