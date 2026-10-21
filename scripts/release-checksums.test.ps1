$ErrorActionPreference = 'Stop'
$fixture = Get-Content -Raw -LiteralPath "$PSScriptRoot/fixtures/release-upload-manifest.json" | ConvertFrom-Json
$root = Join-Path $PSScriptRoot "../.dev-data/release-prep-20261021/checksum-test-$([guid]::NewGuid())"
$local = New-Item -ItemType Directory -Path "$root/local"
$uploaded = New-Item -ItemType Directory -Path "$root/uploaded"
[IO.File]::WriteAllText((Join-Path $local $fixture.localName), 'deterministic installer bytes')
Copy-Item -LiteralPath (Join-Path $local $fixture.localName) -Destination (Join-Path $uploaded $fixture.uploadedName)
$output = Join-Path $root 'SHA256SUMS.txt'
& "$PSScriptRoot/release-checksums.ps1" -LocalDirectory $local -UploadedDirectory $uploaded -OutputPath $output
$expected = "$((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $uploaded $fixture.uploadedName)).Hash.ToLowerInvariant())  $($fixture.uploadedName)"
if ((Get-Content -Raw $output).Trim() -cne $expected) { throw "Checksum entry does not match the verified uploaded-asset manifest: $(Get-Content -Raw $output)" }
[IO.File]::WriteAllText((Join-Path $uploaded $fixture.uploadedName), 'different uploaded bytes')
$rejected = $false
try { & "$PSScriptRoot/release-checksums.ps1" -LocalDirectory $local -UploadedDirectory $uploaded -OutputPath $output } catch { $rejected = $true }
if (-not $rejected) { throw 'Mismatched uploaded bytes were accepted' }
'PASS: uploaded manifest name, SHA256 bytes, mismatch rejection'
