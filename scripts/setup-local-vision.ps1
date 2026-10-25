param([int]$TimeoutSeconds = 240)
$ErrorActionPreference = 'Stop'
# Prefer the installed native runner: it does not depend on the LM Studio daemon.
$native = Get-ChildItem -Path "$env:USERPROFILE\.lmstudio\extensions\backends\llama.cpp-win-arm64-*\llama-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($native) {
  & (Join-Path $PSScriptRoot 'setup-native-vision.ps1') -Runner $native.FullName -DownloadTimeoutSeconds $TimeoutSeconds
  return
}
$lms = Join-Path $env:USERPROFILE '.lmstudio\bin\lms.exe'
if (!(Test-Path -LiteralPath $lms)) { throw 'Install LM Studio for Windows ARM64 first.' }
function Invoke-BoundedLms([string[]]$Arguments) {
  $process = Start-Process -FilePath $lms -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill()
    throw "LM Studio command exceeded $TimeoutSeconds seconds. Retry later; Sorty manual labeling remains available."
  }
  if ($process.ExitCode -ne 0) { throw "LM Studio command failed ($($process.ExitCode)): $Arguments" }
}
Invoke-BoundedLms @('daemon', 'up')
# LM Studio resolves the model and accompanying multimodal projector/runtime.
Invoke-BoundedLms @('get', 'https://huggingface.co/ggml-org/SmolVLM-256M-Instruct-GGUF', '-y')
Invoke-BoundedLms @('load', 'SmolVLM-256M-Instruct', '--identifier', 'sorty-smolvlm', '--context-length', '2048', '--gpu', 'off', '-y')
Invoke-BoundedLms @('server', 'start', '--port', '1234')
Invoke-RestMethod 'http://127.0.0.1:1234/v1/models' -TimeoutSec 2 | ConvertTo-Json -Depth 4
Write-Host 'Model loaded. A real image inference is still required to verify vision compatibility and latency.'
