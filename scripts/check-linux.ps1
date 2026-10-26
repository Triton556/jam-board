# Linux pre-check from Windows. No distro, toolchain or system packages are installed.
# Exit 0: full workspace Clippy passed in Linux; 1: check failed; 2: incomplete.
[CmdletBinding()]
param([string]$Distro)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$target = 'x86_64-unknown-linux-gnu'
$result = 2
Push-Location $repo
try {
    $distros = @()
    if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
        Write-Host 'WSL inventory (wsl -l -v):'
        $inventory = @(& wsl.exe -l -v 2>&1)
        $inventoryCode = $LASTEXITCODE
        $inventory | ForEach-Object { Write-Host ("$_" -replace "`0", '') }
        if ($inventoryCode -eq 0) {
            $names = @(& wsl.exe -l -q 2>&1)
            if ($LASTEXITCODE -eq 0) {
                $distros = @($names | ForEach-Object { ("$_" -replace "`0", '').Trim() } | Where-Object { $_ })
            }
        }
    }
    if ($Distro -and $Distro -notin $distros) {
        throw "Requested WSL distro '$Distro' is not available. Nothing was installed."
    }
    if ($distros.Count -gt 0) {
        if (-not $Distro) { $Distro = $distros[0] }
        Write-Host "Linux workspace check in WSL distro: $Distro"
        Write-Host 'Requires Linux Rust/Clippy, Node/npm, installed desktop dependencies and Linux Tauri system libraries (see .github/workflows/ci.yml).'
        # --cd accepts the Windows workspace path; no path interpolation into shell code.
        & wsl.exe -d $Distro --cd $repo -- bash -lc 'set -e; command -v cargo; command -v npm; (cd apps/desktop && npm run prepare:sidecar); cargo clippy --workspace --all-targets -- -D warnings'
        if ($LASTEXITCODE -eq 0) {
            Write-Host 'PASS: full Linux workspace all-targets Clippy. Tests, browser scenarios and packaging were NOT checked.'
            $result = 0
        } else {
            Write-Warning 'Linux workspace check failed. Resolve the diagnostics above; missing prerequisites were not installed. Other CI gates were NOT checked.'
            $result = 1
        }
    } else {
        Write-Warning 'No usable WSL distro inventory. Full Linux workspace check NOT_RUN; no distro was installed.'
        if (-not (Get-Command rustup -ErrorAction SilentlyContinue) -or -not (Get-Command cargo -ErrorAction SilentlyContinue)) {
            Write-Warning 'Cross-target check NOT_RUN: cargo/rustup unavailable.'
        } else {
            $installed = @(& rustup target list --installed)
            if ($LASTEXITCODE -ne 0 -or $target -notin $installed) {
                Write-Warning "Cross-target check NOT_RUN: $target is not installed. Nothing was installed."
            } else {
                Write-Host "Diagnostic cross-target Clippy: jam-voice, jam-web-mcp ($target)."
                Write-Host 'These omit Tauri/SQLite, but reqwest/rustls may still require a Linux C compiler for ring.'
                & cargo clippy --locked --offline --target $target -p jam-voice -p jam-web-mcp --all-targets -- -D warnings
                if ($LASTEXITCODE -eq 0) {
                    Write-Host 'PASS: selected cross-target crates only (no Linux execution or linking).'
                } else {
                    Write-Warning 'Selected cross-target check did not pass; inspect diagnostics for compiler/cache/source failures. No Linux pass is claimed.'
                }
                Write-Warning 'NOT_CHECKED: jam-core, jam-mcp, jam-mcp-cli, jam-agents (bundled SQLite/native dependencies), jam-board (Tauri/GTK/WebKit).'
                Write-Warning 'All current crates have native transitive dependencies; there is no guaranteed C-compiler-free subset. A cross-target failure may prevent application code from being checked.'
            }
        }
        Write-Warning 'PARTIAL: Ubuntu CI is still required for the exact release commit. Exit 2 means incomplete, never a full Linux pass.'
    }
} finally {
    Pop-Location
}
exit $result
