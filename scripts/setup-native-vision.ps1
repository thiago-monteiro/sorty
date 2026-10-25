param(
  [string]$Runner,
  [int]$DownloadTimeoutSeconds = 240,
  [int]$StartupTimeoutSeconds = 90,
  [int]$Port = 1234
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root '.runtime'
$models = Join-Path $runtime 'models'
New-Item -ItemType Directory -Force $models | Out-Null
if (!$Runner) {
  $backends = Join-Path $env:USERPROFILE '.lmstudio\extensions\backends'
  $Runner = Get-ChildItem -Path "$backends\llama.cpp-win-arm64-*\llama-server.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (!$Runner -or !(Test-Path -LiteralPath $Runner)) { throw 'No native ARM64 llama-server found. Supply -Runner with a compatible llama.cpp server executable.' }
try {
  $existing = Invoke-RestMethod "http://127.0.0.1:$Port/v1/models" -TimeoutSec 2
  if ($existing.data.id -contains 'sorty-smolvlm') { Write-Host "sorty-smolvlm is already available on port $Port."; return }
  throw "Port $Port already serves another model. Choose another -Port; no existing process was changed."
} catch {
  if ($_.Exception.Message -like 'Port *') { throw }
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is occupied. Choose another -Port; no existing process was changed." }
$expected = @{
  'SmolVLM-256M-Instruct-Q8_0.gguf' = '2a31195d3769c0b0fd0a4906201666108834848db768af11de1d2cef7cd35e65'
  'mmproj-SmolVLM-256M-Instruct-Q8_0.gguf' = '7e943f7c53f0382a6fc41b6ee0c2def63ba4fded9ab8ed039cc9e2ab905e0edd'
}
foreach ($name in $expected.Keys) {
  $target = Join-Path $models $name
  $partial = "$target.part"
  if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $expected[$name]) {
    if (Test-Path -LiteralPath $partial) { throw "Both invalid final file and partial exist for $name. Inspect them before retrying." }
    Move-Item -LiteralPath $target -Destination $partial
  }
  if (!(Test-Path -LiteralPath $target)) {
    & curl.exe --fail --location --progress-bar --connect-timeout 20 --max-time $DownloadTimeoutSeconds --continue-at - --output $partial "https://huggingface.co/ggml-org/SmolVLM-256M-Instruct-GGUF/resolve/main/$name"
    if ($LASTEXITCODE -ne 0) { throw "Download incomplete ($name); partial retained at $partial. Run this script again to resume." }
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $expected[$name]) { throw "SHA256 mismatch for $name. Partial retained for inspection." }
    Move-Item -LiteralPath $partial -Destination $target
  }
}
$arguments = @('-m', ('"' + (Join-Path $models 'SmolVLM-256M-Instruct-Q8_0.gguf') + '"'), '--mmproj', ('"' + (Join-Path $models 'mmproj-SmolVLM-256M-Instruct-Q8_0.gguf') + '"'), '--host', '127.0.0.1', '--port', $Port, '--alias', 'sorty-smolvlm', '--ctx-size', '2048', '--parallel', '1', '--gpu-layers', '0', '--no-mmproj-offload', '--threads', '4')
$process = Start-Process -FilePath $Runner -ArgumentList $arguments -WorkingDirectory (Split-Path $Runner -Parent) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'vision.stdout.log') -RedirectStandardError (Join-Path $runtime 'vision.stderr.log')
$process.Id | Set-Content (Join-Path $runtime 'vision.pid')
$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
do {
  if ($process.HasExited) { throw "Native server exited ($($process.ExitCode)). Inspect .runtime/vision.stderr.log." }
  try {
    $status = Invoke-RestMethod "http://127.0.0.1:$Port/v1/models" -TimeoutSec 2
    if ($status.data.id -contains 'sorty-smolvlm') {
      Write-Host "Native vision ready: http://127.0.0.1:$Port/v1 (PID $($process.Id)). Image inference still needs verification."
      return
    }
  } catch { }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)
throw "Startup exceeded $StartupTimeoutSeconds seconds. PID $($process.Id) was left running; inspect .runtime/vision.stderr.log."


