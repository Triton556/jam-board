param(
    [Parameter(Mandatory)][string]$Executable
)
$ErrorActionPreference = 'Stop'
$file = Get-Item -LiteralPath $Executable
$stream = [IO.File]::OpenRead($file.FullName)
$reader = [IO.BinaryReader]::new($stream)
try {
    if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) { throw 'Desktop executable has no valid DOS header' }
    $stream.Position = 0x3c
    $peOffset = $reader.ReadInt32()
    if ($peOffset -lt 64 -or $peOffset + 24 + 70 -gt $stream.Length) { throw 'Desktop executable has a truncated PE header' }
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Desktop executable has no valid PE signature' }
    $stream.Position = $peOffset + 24
    if ($reader.ReadUInt16() -notin @(0x10b, 0x20b)) { throw 'Desktop executable has an unsupported optional header' }
    $stream.Position = $peOffset + 24 + 68
    $subsystem = $reader.ReadUInt16()
    if ($subsystem -ne 2) { throw "Desktop EXE uses Windows subsystem $subsystem; expected 2 (GUI), which launches without a console" }
    [pscustomobject]@{ Executable=$file.FullName; Subsystem=$subsystem; WindowsGUI=$true }
} finally {
    $reader.Dispose()
}
