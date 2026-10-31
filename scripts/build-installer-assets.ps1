param([string]$OutputDirectory = '')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$root=Split-Path $PSScriptRoot -Parent
if(!$OutputDirectory){$OutputDirectory=Join-Path $root 'resources/installer'}
[IO.Directory]::CreateDirectory($OutputDirectory)|Out-Null
[xml]$svg=[IO.File]::ReadAllText((Join-Path $root 'electron/brand.svg'))
function Draw-Mark($g,[single]$left,[single]$top,[single]$size,[Drawing.Color]$color){
 $scale=$size/28.0
 foreach($shape in $svg.svg.path){
  $vector=New-Object Drawing.Drawing2D.GraphicsPath
  $pen=[Drawing.Pen]::new($color,[single]([double]$shape.GetAttribute('stroke-width')*$scale));$pen.LineJoin=[Drawing.Drawing2D.LineJoin]::Round
  try{
   if($shape.d -match '[^ML0-9.\s,-]'){throw 'Unsupported brand path'}
   foreach($command in [regex]::Matches($shape.d,'([ML])\s*(-?[0-9.]+)[ ,]+(-?[0-9.]+)')){
    $x=[single]($left+[double]::Parse($command.Groups[2].Value,[Globalization.CultureInfo]::InvariantCulture)*$scale)
    $y=[single]($top+[double]::Parse($command.Groups[3].Value,[Globalization.CultureInfo]::InvariantCulture)*$scale)
    if($command.Groups[1].Value -eq 'M'){$vector.StartFigure()}else{$vector.AddLine($previousX,$previousY,$x,$y)}
    $previousX=$x;$previousY=$y
   }
   $g.DrawPath($pen,$vector)
  }finally{$pen.Dispose();$vector.Dispose()}
 }
}
$bitmap=[Drawing.Bitmap]::new(164,314,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g=[Drawing.Graphics]::FromImage($bitmap)
$gradient=[Drawing.Drawing2D.LinearGradientBrush]::new([Drawing.Rectangle]::new(0,0,164,314),[Drawing.ColorTranslator]::FromHtml('#7950dd'),[Drawing.ColorTranslator]::FromHtml('#32204f'),[single]90)
$white=[Drawing.SolidBrush]::new([Drawing.Color]::White)
$muted=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(205,218,203,246))
$title=[Drawing.Font]::new('Segoe UI',19,[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel)
$caption=[Drawing.Font]::new('Segoe UI',9,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
try{
 $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias;$g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
 $g.FillRectangle($gradient,0,0,164,314)
 Draw-Mark $g -26 171 210 ([Drawing.Color]::FromArgb(14,255,255,255))
 Draw-Mark $g 21 35 52 ([Drawing.Color]::White)
 $g.DrawString('SuperVPN',$title,$white,[single]23,[single]105)
 $g.DrawString('CONNECT. SIMPLY.',$caption,$muted,[single]24,[single]140)
 $g.FillRectangle($white,24,173,25,2)
 $g.DrawString('WINDOWS CLIENT',$caption,$muted,[single]24,[single]277)
 $bitmap.Save((Join-Path $OutputDirectory 'sidebar.bmp'),[Drawing.Imaging.ImageFormat]::Bmp)
}finally{$g.Dispose();$bitmap.Dispose();$gradient.Dispose();$white.Dispose();$muted.Dispose();$title.Dispose();$caption.Dispose()}
$bitmap=[Drawing.Bitmap]::new(150,57,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g=[Drawing.Graphics]::FromImage($bitmap)
$brush=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#35254f'))
$font=[Drawing.Font]::new('Segoe UI',14,[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel)
try{
 $g.Clear([Drawing.ColorTranslator]::FromHtml('#fcfbfe'));$g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias;$g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
 Draw-Mark $g 10 13 30 ([Drawing.ColorTranslator]::FromHtml('#7047d7'))
 $g.DrawString('SuperVPN',$font,$brush,[single]48,[single]18)
 $bitmap.Save((Join-Path $OutputDirectory 'header.bmp'),[Drawing.Imaging.ImageFormat]::Bmp)
}finally{$g.Dispose();$bitmap.Dispose();$brush.Dispose();$font.Dispose()}
Write-Output 'Generated native NSIS sidebar (164x314) and header (150x57)'
