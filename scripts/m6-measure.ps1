param(
  [Parameter(Mandatory)][string]$Executable,
  [Parameter(Mandatory)][string]$DataDir,
  [string]$Output = 'docs/media/m6/release-measurements.json'
)
$ErrorActionPreference = 'Stop'
$oldData = $env:JAM_BOARD_DATA_DIR
$oldArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
try {
  $env:JAM_BOARD_DATA_DIR = [IO.Path]::GetFullPath($DataDir)
  Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
  $runs = @()
  for ($run = 1; $run -le 5; $run++) {
    $app = Start-Process -FilePath $Executable -PassThru
    $started = [DateTimeOffset]::new($app.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $receipt = $null
    do {
      Start-Sleep -Milliseconds 20
      $path = Join-Path $DataDir 'logs/app-ready.json'
      if (Test-Path -LiteralPath $path) {
        try { $candidate = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json; if ($candidate.pid -eq $app.Id) { $receipt = $candidate } } catch { }
      }
    } until ($receipt -or [DateTime]::UtcNow -gt $deadline)
    if (-not $receipt) { throw 'First-content-frame receipt missing.' }
    Start-Sleep -Seconds 30
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
    $ids = [Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($app.Id)
    do {
      $added = 0
      foreach ($item in $all) { if ($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)) { $added++ } }
    } while ($added)
    $filter = ($ids | ForEach-Object { "IDProcess = $_" }) -join ' OR '
    $processes = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter $filter | ForEach-Object {
      $native = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.IDProcess)"
      $role = if ($native.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } elseif ($_.Name -like '*msedgewebview2*') { 'browser' } else { 'application' }
      [ordered]@{ pid = [int]$_.IDProcess; name = $_.Name; role = $role; privateWorkingSetBytes = [long]$_.WorkingSetPrivate }
    })
    if (-not ($processes | Where-Object name -Like '*msedgewebview2*')) { throw 'Missing WebView2 memory.' }
    $total = ($processes | Measure-Object privateWorkingSetBytes -Sum).Sum
    $entry = [ordered]@{ run = $run; startupMs = [long]$receipt.readyAtUnixMs - $started; privateWorkingSetBytes = $total; processes = $processes }
    $runs += $entry
    Write-Output "Run $run`: $($entry.startupMs) ms, $([math]::Round($total/1MB,2)) MiB private working set"
    if (-not $app.CloseMainWindow() -or -not $app.WaitForExit(10000)) { throw 'Cannot close the measured process normally.' }
    Start-Sleep -Seconds 1
  }
  $result = [ordered]@{ build = 'release'; installed = $false; debugger = $false; osFileCacheFlushed = $false; idleSeconds = 30; medianStartupMs = @($runs.startupMs | Sort-Object)[2]; medianPrivateWorkingSetBytes = @($runs.privateWorkingSetBytes | Sort-Object)[2]; runs = $runs }
  $result | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 -LiteralPath $Output
} finally {
  $env:JAM_BOARD_DATA_DIR = $oldData
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $oldArguments
}
