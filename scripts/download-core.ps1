param([ValidateSet('amd64','arm64')][string]$Architecture = 'amd64')
$ErrorActionPreference = 'Stop'
$Version = '1.12.14'
$Root = Split-Path -Parent $PSScriptRoot
$Destination = Join-Path $Root 'resources/core'
$Work = Join-Path ([IO.Path]::GetTempPath()) ('supervpn-core-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Destination,$Work | Out-Null
try {
  $Asset = "sing-box-$Version-windows-$Architecture.zip"
  $Base = "https://github.com/SagerNet/sing-box/releases/download/v$Version"
  Write-Host "Downloading official sing-box v$Version ($Architecture)..."
  Invoke-WebRequest "$Base/$Asset" -OutFile (Join-Path $Work $Asset) -UseBasicParsing
  # Digests pinned from the official GitHub release asset metadata for v1.12.14.
  $Hashes = @{
    amd64 = 'aa57fe949c34bcb8f48cc9335e9af0f0f78c94e5bbe542ee00a26c7e3a3d7cd1'
    arm64 = '151a6d3b5a57b13214cd90d0069e7c77b02a11c6930738fa892831cf7020ac52'
  }
  $Expected = $Hashes[$Architecture]
  $Actual = (Get-FileHash (Join-Path $Work $Asset) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw 'SHA256 mismatch; refusing to install.' }
  Expand-Archive (Join-Path $Work $Asset) -DestinationPath (Join-Path $Work 'expanded')
  $Exe = Get-ChildItem (Join-Path $Work 'expanded') -Recurse -Filter 'sing-box.exe' | Select-Object -First 1
  if (!$Exe) { throw 'Archive contains no sing-box.exe.' }
  Copy-Item $Exe.FullName (Join-Path $Destination 'sing-box.exe') -Force
  Invoke-WebRequest 'https://raw.githubusercontent.com/SagerNet/sing-box/v1.12.14/LICENSE' -OutFile (Join-Path $Destination 'LICENSE-sing-box') -UseBasicParsing
  Invoke-WebRequest 'https://www.gnu.org/licenses/gpl-3.0.txt' -OutFile (Join-Path $Destination 'LICENSE-GPL-3.0.txt') -UseBasicParsing
  [IO.File]::WriteAllText((Join-Path $Destination 'LICENSE-source.txt'), "Corresponding source: https://github.com/SagerNet/sing-box/archive/refs/tags/v$Version.tar.gz`r`nUnmodified official sing-box v$Version binary. License: GPL-3.0-or-later.`r`n")
  [IO.File]::WriteAllText((Join-Path $Destination 'version.txt'), $Version)
  Write-Host "Installed and verified: $Destination"
} finally {
  if ([IO.Path]::GetFullPath($Work).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -and (Split-Path $Work -Leaf) -like 'supervpn-core-*') { Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue }
}
