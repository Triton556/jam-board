param(
    [Parameter(Mandatory)][string]$LocalDirectory,
    [Parameter(Mandatory)][string]$UploadedDirectory,
    [Parameter(Mandatory)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$local = @(Get-ChildItem -LiteralPath $LocalDirectory -File -Filter '*-setup.exe')
$uploaded = @(Get-ChildItem -LiteralPath $UploadedDirectory -File -Filter '*-setup.exe')
if (-not $local.Count -or $local.Count -ne $uploaded.Count) { throw 'Local/uploaded NSIS asset counts differ or installers are missing' }
$remaining = [Collections.Generic.List[string]]::new()
foreach ($file in $local) { $remaining.Add((Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash) }
$lines = foreach ($file in ($uploaded | Sort-Object Name)) {
    $digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
    if (-not $remaining.Remove($digest)) { throw "Uploaded installer bytes do not match a local build: $($file.Name)" }
    "$($digest.ToLowerInvariant())  $($file.Name)"
}
[IO.File]::WriteAllLines($OutputPath, [string[]]$lines, [Text.UTF8Encoding]::new($false))
