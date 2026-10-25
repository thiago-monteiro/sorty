param([ValidateRange(1,65535)][int]$Port = 5173)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $projectPath '.runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
# Official Windows x64 build also runs under Windows on ARM emulation.
$binary = Join-Path $runtime 'cloudflared-windows-amd64.exe'
& node (Join-Path $PSScriptRoot 'download-cloudflared.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Verified cloudflared installation failed.' }
$statePath = Join-Path $runtime 'phone-tunnel.json'
$state = $null
if (Test-Path -LiteralPath $statePath) {
  try {
    $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $existing = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
    if ($existing -and $existing.Path -eq $binary -and $existing.StartTime.ToUniversalTime().ToString('o') -eq $saved.processStartedAt -and $saved.port -eq $Port) { $state = $saved }
  } catch { $state = $null }
}
if (!$state) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $stdout = Join-Path $runtime "cloudflared-$stamp.stdout.log"
  $stderr = Join-Path $runtime "cloudflared-$stamp.stderr.log"
  # cloudflared reconnects automatically; HTTP/2 also works on networks blocking QUIC/UDP.
  $tunnel = Start-Process -FilePath $binary -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$Port", '--no-autoupdate', '--protocol', 'http2') -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $state = [pscustomobject]@{ pid = $tunnel.Id; port = $Port; processStartedAt = $tunnel.StartTime.ToUniversalTime().ToString('o'); stdout = $stdout; stderr = $stderr; url = $null; createdAt = (Get-Date).ToUniversalTime().ToString('o') }
  $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}
$deadline = (Get-Date).AddSeconds(90)
while (!$state.url -and (Get-Date) -lt $deadline) {
  if (!(Get-Process -Id $state.pid -ErrorAction SilentlyContinue)) { throw "cloudflared exited. See $($state.stderr)" }
  $logs = (Get-Content -LiteralPath $state.stderr -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $state.stdout -Raw -ErrorAction SilentlyContinue)
  if ($logs -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') { $state.url = $Matches[0]; break }
  Start-Sleep -Milliseconds 500
}
if (!$state.url) { throw "Tunnel URL not ready. Process $($state.pid) remains running; rerun this script. See $($state.stderr)" }
$state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
$connection = @{ url = $state.url; createdAt = $state.createdAt } | ConvertTo-Json
foreach ($folder in @('public','dist')) {
  $directory = Join-Path $projectPath $folder
  if (Test-Path -LiteralPath $directory) { [IO.File]::WriteAllText((Join-Path $directory 'connection.json'), $connection, (New-Object Text.UTF8Encoding($false))) }
}
Write-Host "Background phone tunnel: $($state.url)"
Write-Host "PID: $($state.pid). Reconnects automatically while running. Stop: Stop-Process -Id $($state.pid)"
[pscustomobject]@{ url = $state.url; pid = $state.pid; log = $state.stderr }
