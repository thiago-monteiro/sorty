param(
  [Parameter(Mandatory = $true)][string]$ImagePath,
  [string]$ApiUrl = 'http://127.0.0.1:3001',
  [string]$Instruction = 'Describe the visible objects and colors.'
)
$ErrorActionPreference = 'Stop'
$extension = [IO.Path]::GetExtension($ImagePath).ToLowerInvariant()
$mime = switch ($extension) { '.png' { 'image/png' } '.jpg' { 'image/jpeg' } '.jpeg' { 'image/jpeg' } default { throw 'Use a PNG or JPEG fixture.' } }
$bytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ImagePath).Path)
if ($bytes.Length -gt 5MB) { throw 'Fixture exceeds the API 5 MB image limit.' }
$body = @{ image = "data:$mime;base64,$([Convert]::ToBase64String($bytes))"; instruction = $Instruction } | ConvertTo-Json -Compress
$watch = [Diagnostics.Stopwatch]::StartNew()
$result = Invoke-RestMethod "$($ApiUrl.TrimEnd('/'))/api/vision" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 65
$watch.Stop()
@{ elapsedMs = $watch.ElapsedMilliseconds; response = $result } | ConvertTo-Json -Depth 6
