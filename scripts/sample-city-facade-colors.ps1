param([Parameter(Mandatory=$true)][string]$ImagePath)
# Run from the repository root with the original reference JPEG downloaded from imageUrl in the manifest.
# Windows PowerShell / PowerShell on Windows; only RGB statistics are written, never image pixels.
Add-Type -AssemblyName System.Drawing
$manifestPath = 'src/world/seoulFacadePalette.json'
$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
$bitmap = [Drawing.Bitmap]::new((Resolve-Path $ImagePath).ProviderPath)
try {
  if ($bitmap.Width -ne $manifest.width -or $bitmap.Height -ne $manifest.height) { throw 'Original image dimensions required.' }
  foreach ($sample in $manifest.colors) {
    $x,$y,$width,$height = $sample.region
    $red = [Collections.Generic.List[int]]::new()
    $green = [Collections.Generic.List[int]]::new()
    $blue = [Collections.Generic.List[int]]::new()
    for ($j=$y; $j -lt $y+$height; $j++) {
      for ($i=$x; $i -lt $x+$width; $i++) {
        $pixel=$bitmap.GetPixel($i,$j)
        $red.Add($pixel.R); $green.Add($pixel.G); $blue.Add($pixel.B)
      }
    }
    $red.Sort(); $green.Sort(); $blue.Sort()
    $mid=[int][Math]::Floor($red.Count/2)
    $sample.hex='#{0:x2}{1:x2}{2:x2}' -f $red[$mid],$green[$mid],$blue[$mid]
    $sample.pixels=$red.Count
  }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $manifestPath
} finally { $bitmap.Dispose() }
