param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path $PSScriptRoot -Parent
Push-Location $projectPath
try {
  if (!$SkipBuild) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; demo was not started.' }
  }
  if (!(Test-Path -LiteralPath (Join-Path $projectPath 'dist/index.html'))) { throw 'Run npm run build first.' }
  if (Test-Path -LiteralPath (Join-Path $projectPath '.runtime/speech/models/ggml-tiny.en.bin')) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-local-speech.ps1') -NoSmoke
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Local speech could not start. Inspect .runtime/speech/logs.' }
  }
  if (Test-Path -LiteralPath (Join-Path $projectPath '.runtime/models/scene-vlm/Qwen3VL-2B-Instruct-Q4_K_M.gguf')) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-scene-vlm.ps1') -SkipDownload -SkipSmoke
    if ($LASTEXITCODE -ne 0) { Write-Warning 'The scene model could not start. Inspect .runtime/scene-vlm.stderr.log.' }
  }
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:5173/api/health' -TimeoutSec 4
    if ($health.engine -eq 'deterministic') { Write-Host 'Sorty is already running at http://localhost:5173.'; return }
  } catch { }
  $runtimePath = Join-Path $projectPath '.runtime'
  New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
  $nodePath = (Get-Command node).Source
  $demoProcess = Start-Process -FilePath $nodePath -ArgumentList @('--import','tsx','server/demo.ts') -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'demo.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'demo.stderr.log')
  $demoProcess.Id | Set-Content -LiteralPath (Join-Path $runtimePath 'demo.pid')
  $demoDeadline = (Get-Date).AddSeconds(15)
  $demoReady = $false
  while ((Get-Date) -lt $demoDeadline) {
    if ($demoProcess.HasExited) { throw 'Sorty exited during startup. Inspect .runtime/demo.stderr.log.' }
    try {
      $demoHealth = Invoke-RestMethod 'http://127.0.0.1:5173/api/health' -TimeoutSec 2
      if ($demoHealth.ok) { $demoReady = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 200
  }
  if (!$demoReady) { throw 'Sorty did not become ready within 15 seconds. Inspect .runtime/demo.stderr.log.' }
  Write-Host "Sorty started in the background (PID $($demoProcess.Id)). Open http://localhost:5173."
  Write-Host 'Use scripts/start-android.ps1 to open the Android HTTPS link.'
} finally { Pop-Location }
