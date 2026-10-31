param([string]$OutputDirectory = '')
# Reuse the original route-shaped S. Windows ICO frames include BOTH 32-bit
# alpha and a real AND transparency mask, including small tray/DPI sizes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
if (!$OutputDirectory) { $OutputDirectory = Join-Path $root 'electron' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$source = [IO.File]::ReadAllText((Join-Path $root 'src/main.jsx'))
$mark = [regex]::Match($source, '(?s)function Mark\(\).*?(<svg\b.*?</svg>)').Groups[1].Value
if (!$mark) { throw 'Brand SVG not found' }
$accent = [regex]::Match([IO.File]::ReadAllText((Join-Path $root 'src/styles.css')), '--accent:\s*(#[0-9a-fA-F]+)').Groups[1].Value
$svgText = $mark.Replace('strokeWidth', 'stroke-width').Replace('strokeLinejoin', 'stroke-linejoin').Replace('currentColor', $accent).Replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
[xml]$svg = $svgText

function New-BrandBitmap([int]$Size, [bool]$WithBackground) {
  $bitmap = New-Object Drawing.Bitmap $Size,$Size,([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    if ($WithBackground) {
      $background = New-Object Drawing.Drawing2D.GraphicsPath
      $brush = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#f7f6fc'))
      try {
        $arc = [single]($Size * 88.0 / 256)
        $inset = [single]0.5
        $end = [single]($Size - $arc - $inset)
        $background.AddArc($inset,$inset,$arc,$arc,180,90); $background.AddArc($end,$inset,$arc,$arc,270,90)
        $background.AddArc($end,$end,$arc,$arc,0,90); $background.AddArc($inset,$end,$arc,$arc,90,90); $background.CloseFigure()
        $graphics.FillPath($brush, $background)
      } finally { $brush.Dispose(); $background.Dispose() }
    }
    $scale = $Size / 28.0
    foreach ($shape in $svg.svg.path) {
      $vector = New-Object Drawing.Drawing2D.GraphicsPath
      $pen = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml($accent)),([single]([double]$shape.GetAttribute('stroke-width')*$scale))
      $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
      try {
        if ($shape.d -match '[^ML0-9.\s,-]') { throw 'Only SVG M/L commands are supported' }
        foreach ($command in [regex]::Matches($shape.d, '([ML])\s*(-?[0-9.]+)[ ,]+(-?[0-9.]+)')) {
          $x = [single]([double]::Parse($command.Groups[2].Value, [Globalization.CultureInfo]::InvariantCulture)*$scale)
          $y = [single]([double]::Parse($command.Groups[3].Value, [Globalization.CultureInfo]::InvariantCulture)*$scale)
          if ($command.Groups[1].Value -eq 'M') { $vector.StartFigure() } else { $vector.AddLine($previousX,$previousY,$x,$y) }
          $previousX = $x; $previousY = $y
        }
        $graphics.DrawPath($pen, $vector)
      } finally { $vector.Dispose(); $pen.Dispose() }
    }
    return $bitmap
  } catch { $bitmap.Dispose(); throw }
  finally { $graphics.Dispose() }
}

function Get-IconDib([Drawing.Bitmap]$Bitmap) {
  $size = $Bitmap.Width
  $maskStride = [int]([Math]::Ceiling($size / 32.0) * 4)
  $stream = New-Object IO.MemoryStream
  $writer = New-Object IO.BinaryWriter $stream
  try {
    # BITMAPINFOHEADER; positive height is XOR + AND bitmap, both bottom-up.
    $writer.Write([uint32]40); $writer.Write([int32]$size); $writer.Write([int32]($size * 2))
    $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]0); $writer.Write([uint32]0)
    $writer.Write([int32]0); $writer.Write([int32]0); $writer.Write([uint32]0); $writer.Write([uint32]0)
    for ($y = $size - 1; $y -ge 0; $y--) {
      for ($x = 0; $x -lt $size; $x++) {
        $color = $Bitmap.GetPixel($x, $y)
        # A transparent XOR pixel must also be RGB=0. Otherwise legacy GDI
        # mask composition can invert the background into black corner edges.
        if ($color.A -eq 0) { $writer.Write([uint32]0) }
        # ICO files store straight BGRA; the Windows loader premultiplies it.
        # Premultiplying here again would create dark antialiasing halos.
        else { $writer.Write([byte]$color.B); $writer.Write([byte]$color.G); $writer.Write([byte]$color.R); $writer.Write([byte]$color.A) }
      }
    }
    for ($y = $size - 1; $y -ge 0; $y--) {
      $mask = New-Object byte[] $maskStride
      for ($x = 0; $x -lt $size; $x++) {
        if ($Bitmap.GetPixel($x, $y).A -eq 0) {
          $index = [int][Math]::Floor($x / 8.0)
          $mask[$index] = $mask[$index] -bor (0x80 -shr ($x % 8))
        }
      }
      $writer.Write([byte[]]$mask)
    }
    $writer.Flush()
    return ,$stream.ToArray()
  } finally { $writer.Dispose(); $stream.Dispose() }
}

function Write-WindowsIcon([string]$File, [int[]]$Sizes, [bool]$WithBackground) {
  $images = @()
  foreach ($size in $Sizes) {
    $bitmap = New-BrandBitmap $size $WithBackground
    try { $images += [pscustomobject]@{ Size = $size; Bytes = [byte[]](Get-IconDib $bitmap) } }
    finally { $bitmap.Dispose() }
  }
  $stream = New-Object IO.MemoryStream
  $writer = New-Object IO.BinaryWriter $stream
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    foreach ($image in $images) {
      $dimension = if ($image.Size -eq 256) { 0 } else { $image.Size }
      $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
      $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$image.Bytes.Length); $writer.Write([uint32]$offset)
      $offset += $image.Bytes.Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
    $writer.Flush(); [IO.File]::WriteAllBytes($File, $stream.ToArray())
  } finally { $writer.Dispose(); $stream.Dispose() }
}

Write-WindowsIcon (Join-Path $OutputDirectory 'app.ico') @(16,20,24,32,40,48,64,128,256) $true
# Tray uses only the transparent S, without the application's rounded tile.
# Render each size directly: no resize of a PNG with transparent black RGB.
Write-WindowsIcon (Join-Path $OutputDirectory 'tray.ico') @(16,20,24,32,40,48,64) $false
$trayBitmap = New-BrandBitmap 48 $false
try { $trayBitmap.Save((Join-Path $OutputDirectory 'tray.png'), [Drawing.Imaging.ImageFormat]::Png) }
finally { $trayBitmap.Dispose() }
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'brand.svg'), $svgText, (New-Object Text.UTF8Encoding $false))
Write-Output 'Updated app.ico, tray.ico, tray.png and brand.svg with explicit Windows transparency masks'
