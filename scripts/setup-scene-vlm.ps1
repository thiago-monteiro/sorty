param(
  [int]$Port = 1235,
  [int]$Context = 4096,
  [int]$Threads = 8,
  [int]$TimeoutSeconds = 180,
  [string]$Runner = '',
  [switch]$SkipDownload,
  [switch]$SkipSmoke
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$modelDir = Join-Path $runtime 'models\scene-vlm'
$modelName = 'Qwen3VL-2B-Instruct-Q4_K_M.gguf'
$mmprojName = 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf'
$model = Join-Path $modelDir $modelName
$mmproj = Join-Path $modelDir $mmprojName
$alias = 'sorty-scene'
$smoke = Join-Path $runtime 'scene-vlm\smoke.mjs'
New-Item -ItemType Directory -Force -Path $runtime, $modelDir | Out-Null

if ($Port -in 1234, 5173) { throw "Refusing to use reserved port $Port (backend 1234 / frontend 5173)." }
if (!$SkipDownload -and (!(Test-Path -LiteralPath $model) -or !(Test-Path -LiteralPath $mmproj))) {
  Write-Host 'Downloading Qwen3-VL-2B-Instruct Q4_K_M + mmproj (resumable, SHA256 verified)...'
  $env:DOWNLOAD_SECONDS = '360'
  $env:DOWNLOAD_CONCURRENCY = '8'
  node (Join-Path $PSScriptRoot 'download-scene-vlm.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Download incomplete. Re-run to resume; partial chunks are retained.' }
}
foreach ($file in $model, $mmproj) {
  if (!(Test-Path -LiteralPath $file)) { throw "Missing model file: $file" }
}

if (!$Runner) {
  $Runner = Get-ChildItem -Path "$env:USERPROFILE\.lmstudio\extensions\backends\llama.cpp-win-arm64-*\llama-server.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (!$Runner -or !(Test-Path -LiteralPath $Runner)) {
  throw 'No ARM64 llama-server found. Pass -Runner <path>; official ARM64 llama.cpp builds are the only alternate source.'
}

# Reuse only a healthy server that already serves OUR alias; any other model is left alone.
try {
  $live = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
  if ($live.status -eq 'ok') {
    $models = Invoke-RestMethod "http://127.0.0.1:$Port/v1/models" -TimeoutSec 3
    if ($models.data.id -contains $alias) {
      Write-Host "Reusing healthy llama-server on 127.0.0.1:$Port (alias $alias)"
      $env:SCENE_VLM_PORT = "$Port"
      if (!$SkipSmoke -and (Test-Path -LiteralPath $smoke)) { node $smoke $Port }
      return
    }
    throw "Port $Port is served by a different model ($($models.data.id -join ', ')). Refusing to disturb it."
  }
} catch {
  if ($_.Exception.Message -like 'Port * is served by a different model*') { throw }
}

$pidFile = Join-Path $runtime 'scene-vlm.pid'
$stdout = Join-Path $runtime 'scene-vlm.stdout.log'
$stderr = Join-Path $runtime 'scene-vlm.stderr.log'
# Start-Process joins ArgumentList with spaces, so paths containing spaces must be quoted explicitly.
$arguments = @(
  '-m', ('"' + $model + '"'),
  '--mmproj', ('"' + $mmproj + '"'),
  '-a', $alias,
  '-c', "$Context",
  '-t', "$Threads",
  '--parallel', '1',
  '--image-min-tokens', '1024',
  '--image-max-tokens', '1024',
  '--json-schema-file', ('"' + (Join-Path $root 'server/scene-schema.json') + '"'),
  '--host', '127.0.0.1',
  '--port', "$Port",
  '-ngl', '0'
)
$process = Start-Process -FilePath $Runner -ArgumentList $arguments -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
$process.Id | Set-Content -LiteralPath $pidFile
Write-Host "PID $($process.Id) | $Runner | port $Port | ctx $Context | threads $Threads"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if ($process.HasExited) {
    throw "llama-server exited with code $($process.ExitCode). See $stderr"
  }
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { $ready = $true; break }
  } catch { Start-Sleep -Milliseconds 500 }
}
if (!$ready) {
  $process.Kill()
  throw "llama-server not ready within $TimeoutSeconds s. See $stderr"
}
Write-Host 'Healthy. Model alias: sorty-scene'
if (!$SkipSmoke -and (Test-Path -LiteralPath $smoke)) {
  node $smoke $Port
}
