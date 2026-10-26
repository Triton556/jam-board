# Windows pre-tag gates, in .github/workflows/ci.yml order (PowerShell 5.1+).
# Run from any directory: pwsh -File scripts/ci-local.ps1
# Does not commit, push, tag, switch checkout, or change the global toolchain.
# Setup actions require installed stable Rust (rustfmt/clippy) and Node 22.
# npm ci and Chromium installation DO download/install their CI dependencies.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$desktop = Join-Path $repo 'apps/desktop'
$results = [Collections.Generic.List[object]]::new()
$failed = $false
$oldToolchain = $env:RUSTUP_TOOLCHAIN
$oldCI = $env:CI

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program $($Arguments -join ' ') exited $LASTEXITCODE" }
}

function Add-Result {
    param([string]$Step, [string]$Status, [string]$Detail)
    $results.Add([pscustomobject]@{ Step=$Step; Status=$Status; Detail=$Detail })
}

# One entry per workflow step, including hosted-only actions and Linux skips.
# When ci.yml changes, review EVERY entry (commands, order, conditions, cwd, env,
# action versions/inputs), then update the fingerprint below. Never just repin it.
# Portable Linux browser steps are additional Windows gates; perf stays manual.
$steps = @(
    @{ Name='actions/checkout@v4'; Skip='Use current working tree; no checkout/reset performed' }
    @{ Name='Install Linux Tauri dependencies'; Skip='Linux only: apt/system libraries require GitHub Ubuntu' }
    @{ Name='dtolnay/rust-toolchain@stable'; Action={
        Invoke-Checked 'rustup' @('run','stable','rustc','--version')
        Invoke-Checked 'rustup' @('run','stable','cargo','fmt','--version')
        Invoke-Checked 'rustup' @('run','stable','cargo','clippy','--version')
    } }
    @{ Name='Swatinem/rust-cache@v2'; Skip='Hosted cache action; existing local Cargo cache used' }
    @{ Name='actions/setup-node@v4 (Node 22)'; Action={
        $nodeVersion = & node -p 'process.versions.node'
        if ($LASTEXITCODE -ne 0 -or "$nodeVersion".Split('.')[0] -ne '22') { throw 'Install/use Node 22 before running these gates (same major as CI)' }
        Invoke-Checked 'npm.cmd' @('--version')
    } }
    @{ Name='npm ci'; Desktop=$true; Action={ Invoke-Checked 'npm.cmd' @('ci') } }
    @{ Name='Check release version consistency and script tests'; Action={
        Invoke-Checked 'node' @('scripts/check-versions.mjs')
        Invoke-Checked 'node' @('--test','scripts/check-versions.test.mjs','scripts/smoke-contracts.test.mjs','scripts/smoke-stdio.test.mjs','scripts/check-interaction-map.test.mjs')
    } }
    @{ Name='Prepare sidecar for Tauri resource validation'; Desktop=$true; Action={ Invoke-Checked 'npm.cmd' @('run','prepare:sidecar') } }
    @{ Name='Isolated current MCP contract smoke'; Action={ Invoke-Checked 'node' @('scripts/stdio-smoke.mjs') } }
    @{ Name='cargo fmt --all --check'; Action={ Invoke-Checked 'cargo' @('fmt','--all','--check') } }
    @{ Name='cargo clippy --workspace --all-targets -- -D warnings'; Action={ Invoke-Checked 'cargo' @('clippy','--workspace','--all-targets','--','-D','warnings') } }
    @{ Name='cargo test --workspace'; Action={ Invoke-Checked 'cargo' @('test','--workspace') } }
    @{ Name='npm run check'; Desktop=$true; Action={ Invoke-Checked 'npm.cmd' @('run','check') } }
    @{ Name='npm run typecheck'; Desktop=$true; Action={ Invoke-Checked 'npm.cmd' @('run','typecheck') } }
    @{ Name='Typecheck browser scenarios'; Desktop=$true; Action={ Invoke-Checked 'npm.cmd' @('run','typecheck:e2e') } }
    @{ Name='npm test'; Desktop=$true; Action={ Invoke-Checked 'npm.cmd' @('test') } }
    @{ Name='Install Chromium (additional Windows gate)'; Desktop=$true; Action={ Invoke-Checked 'npx.cmd' @('--no-install','playwright','install','chromium') } }
    @{ Name='Functional browser scenarios (additional Windows gate)'; Desktop=$true; Action={ Invoke-Checked 'npx.cmd' @('--no-install','playwright','test','--project=functional') } }
    @{ Name='Production table benchmark (manual only)'; Skip='Linux manual perf dispatch only; not a normal pre-tag gate' }
    @{ Name='Debug desktop build'; Desktop=$true; Action={ Invoke-Checked 'npx.cmd' @('--no-install','tauri','build','--debug','--no-bundle') } }
    @{ Name='actions/upload-artifact@v4 diagnostics'; Always=$true; Action={
        Write-Host "Local diagnostics retained at $(Join-Path $repo '.dev-data/playwright'); no GitHub upload."
    } }
    @{ Name='Preserve synthetic UI screenshots'; Skip='Hosted Linux upload only; existing test-visuals files retained locally' }
)

Push-Location $repo
try {
    $workflow = [IO.File]::ReadAllText((Join-Path $repo '.github/workflows/ci.yml')).Replace("`r`n", "`n").TrimEnd()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($workflow)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    # Full reviewed workflow, not just run: lines: additions, conditions, actions,
    # cwd/env changes, extra jobs and changed setup inputs all fail closed.
    $expected = '2164475536e46421413563cec44750ace6102e808a74fb0d33c3fe88bcd68b63'
    if ($actual -ne $expected) {
        throw 'UNKNOWN/CHANGED CI WORKFLOW: review ci.yml against the complete step list in scripts/ci-local.ps1 and update both the mapping and fingerprint before running gates.'
    }
    Add-Result 'Workflow synchronization guard' 'PASS' 'Reviewed ci.yml matches (LF normalized)'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This runner requires Windows; Linux is checked on GitHub' }
    $env:RUSTUP_TOOLCHAIN = 'stable'
    $env:CI = 'true'
    foreach ($step in $steps) {
        if ($step.Skip) { Add-Result $step.Name 'SKIP' $step.Skip; continue }
        if ($failed -and -not $step.Always) { Add-Result $step.Name 'NOT_RUN' 'Earlier gate failed (CI step semantics)'; continue }
        Write-Host "`n=== $($step.Name) ==="
        $location = $repo
        if ($step.Desktop) { $location = $desktop }
        Push-Location $location
        try {
            & $step.Action
            Add-Result $step.Name 'PASS' 'Completed'
        } catch {
            $failed = $true
            Add-Result $step.Name 'FAIL' $_.Exception.Message
            Write-Warning "$($step.Name): $($_.Exception.Message)"
        } finally { Pop-Location }
    }
} catch {
    $failed = $true
    Add-Result 'Preflight' 'FAIL' $_.Exception.Message
    Write-Warning $_.Exception.Message
} finally {
    $env:RUSTUP_TOOLCHAIN = $oldToolchain
    $env:CI = $oldCI
    Pop-Location
    $results | Format-Table -AutoSize -Wrap | Out-Host
    Write-Host 'Linux behavior is only checked on GitHub. Push the branch, wait for green Windows AND Ubuntu CI on the exact release commit, then tag. A local PASS does not replace either hosted job.'
}
if ($failed) { exit 1 }
exit 0
