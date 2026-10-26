param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [ValidateRange(2, 1000)][int]$Runs = 7
)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $Executable).Path
if (Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($binary)) -ErrorAction SilentlyContinue) {
    throw 'Close existing Jam Board instances before measuring startup'
}
$sidecar = Join-Path (Split-Path -Parent $binary) 'jam-board-mcp.exe'
if (!(Test-Path -LiteralPath $sidecar -PathType Leaf)) {
    throw "Demo seeding requires the matching sidecar: $sidecar"
}
$outputRoot = Join-Path $PSScriptRoot '../test-visuals/round6/w6'
$null = New-Item -ItemType Directory -Path $outputRoot -Force
$outputRoot = (Resolve-Path -LiteralPath $outputRoot).Path
$fixture = Join-Path $outputRoot ('startup-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $fixture
$linesPath = Join-Path $fixture 'samples.jsonl'

function New-IsolatedProcess([string]$File, [bool]$Probe) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WorkingDirectory = Split-Path -Parent $binary
    foreach ($key in @('JAM_BOARD_DB', 'JAM_BOARD_PROJECT', 'JAM_BOARD_STARTUP_PROBE', 'JAM_BOARD_STARTUP_OUT', 'JAM_BOARD_STARTUP_EXIT')) {
        $info.EnvironmentVariables.Remove($key)
    }
    $info.EnvironmentVariables['JAM_BOARD_DATA_DIR'] = $fixture
    if ($Probe) {
        $info.EnvironmentVariables['JAM_BOARD_STARTUP_PROBE'] = '1'
        $info.EnvironmentVariables['JAM_BOARD_STARTUP_OUT'] = $linesPath
        $info.EnvironmentVariables['JAM_BOARD_STARTUP_EXIT'] = '1'
    }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    return $process
}

# The bundled demo uses the real Store seed, not a copy of any personal database.
# EOF after an MCP initialization ends the seeding sidecar before measured runs.
$seed = New-IsolatedProcess $sidecar $false
$seed.StartInfo.Arguments = '--db "' + (Join-Path $fixture 'jam.db') + '" --seed-demo'
$seed.StartInfo.RedirectStandardInput = $true
$seed.StartInfo.RedirectStandardOutput = $true
$seed.StartInfo.RedirectStandardError = $true
try {
    $null = $seed.Start()
    $stdout = $seed.StandardOutput.ReadToEndAsync()
    $stderr = $seed.StandardError.ReadToEndAsync()
    $seed.StandardInput.WriteLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"startup-fixture","version":"1"}}}')
    $seed.StandardInput.WriteLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')
    $seed.StandardInput.Close()
    if (!$seed.WaitForExit(60000)) { $seed.Kill(); throw 'Demo seeding timed out' }
    if ($seed.ExitCode -ne 0) { throw "Demo seeding failed: $($stderr.Result)" }
    if (!(Test-Path -LiteralPath (Join-Path $fixture 'jam.db'))) { throw 'Demo seed produced no database' }
} finally { $seed.Dispose() }

$samples = @()
for ($run = 1; $run -le $Runs; $run++) {
    $process = New-IsolatedProcess $binary $true
    try {
        $null = $process.Start()
        if (!$process.WaitForExit(60000)) { $process.Kill(); throw "Startup run $run timed out (close any existing Jam Board instance)" }
        if ($process.ExitCode -ne 0) { throw "Startup run $run exited with $($process.ExitCode)" }
        $lines = @(Get-Content -LiteralPath $linesPath)
        if ($lines.Count -ne $run) { throw "Startup run $run did not produce exactly one receipt" }
        $sample = $lines[-1] | ConvertFrom-Json
        foreach ($metric in @('processToWindowMs', 'processToFirstPaintMs')) {
            $value = $sample.$metric
            if ($null -eq $value -or $value -is [string] -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value) -or $value -lt 0) { throw "Invalid $metric in run $run" }
        }
        if ($sample.processToFirstPaintMs -lt $sample.processToWindowMs -or $sample.route -notin @('/board', '/plan', '/welcome') -or !$sample.version) { throw "Invalid receipt in run $run" }
        if ($sample.route -ne '/board') { throw "Seeded fixture should open /board, got $($sample.route)" }
        $samples += $sample
    } finally { $process.Dispose() }
}

function Measure-Group($Group) {
    $result = [ordered]@{ count = @($Group).Count }
    foreach ($metric in @('processToWindowMs', 'processToFirstPaintMs')) {
        $values = @($Group | ForEach-Object { [double]$_.$metric } | Sort-Object)
        $middle = [int][math]::Floor($values.Count / 2)
        $median = $values[$middle]
        if ($values.Count % 2 -eq 0) { $median = ($values[$middle - 1] + $values[$middle]) / 2 }
        $result[$metric] = @{ median = $median; p90 = $values[[int][math]::Ceiling(0.9 * $values.Count) - 1] }
    }
    return $result
}
$summary = [ordered]@{
    executable = $binary
    measuredAt = [DateTime]::UtcNow.ToString('o')
    cold = Measure-Group @($samples[0])
    warm = Measure-Group @($samples[1..($samples.Count - 1)])
    samples = $samples
    fixture = $fixture
}
$destination = Join-Path $outputRoot 'startup.json'
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $destination -Encoding UTF8
foreach ($group in @('cold', 'warm')) {
    foreach ($metric in @('processToWindowMs', 'processToFirstPaintMs')) {
        $stats = $summary[$group][$metric]
        Write-Host ('{0} (n={1}) {2}: median {3:N2} ms; p90 {4:N2} ms' -f $group, $summary[$group].count, $metric, $stats.median, $stats.p90)
    }
}
Write-Host "Results: $destination"
