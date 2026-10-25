<#
  setup-local-speech.ps1 - install, start and smoke-test a LOCAL whisper.cpp ASR server.

  - manifest/cache first: a live or restartable install never calls GitHub/HF
  - native Windows ARM64 build when the official release publishes one, official x64 otherwise
  - verifies the GitHub release asset SHA256 digest and the Hugging Face model SHA256
  - resumable downloads, cached under .runtime/speech
  - whisper-server on 127.0.0.1:1236, hidden/detached, PID + logs + manifest
  - real smoke test: official whisper.cpp samples/jfk.wav -> .runtime/speech-smoke.json

  Usage:  powershell -ExecutionPolicy Bypass -File scripts/setup-local-speech.ps1
          powershell -ExecutionPolicy Bypass -File scripts/setup-local-speech.ps1 -NoSmoke
#>
[CmdletBinding()]
param(
    [int]$Port = 1236,
    [switch]$NoSmoke
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $RepoRoot ".runtime"
$SpeechHome = Join-Path $RuntimeDir "speech"
$CacheDir   = Join-Path $SpeechHome "cache"
$ModelsDir  = Join-Path $SpeechHome "models"
$BinDir     = Join-Path $SpeechHome "bin"
$LogsDir    = Join-Path $SpeechHome "logs"
$SamplesDir = Join-Path $SpeechHome "samples"
$Manifest   = Join-Path $SpeechHome "server.json"
$PidFile    = Join-Path $SpeechHome "whisper-server.pid"
$SmokePath  = Join-Path $RuntimeDir "speech-smoke.json"
$ModelFile  = "ggml-tiny.en.bin"
$ModelPath  = Join-Path $ModelsDir $ModelFile
$SamplePath = Join-Path $SamplesDir "jfk.wav"
$GitHubApi  = "https://api.github.com/repos/ggml-org/whisper.cpp"

foreach ($d in @($SpeechHome, $CacheDir, $ModelsDir, $BinDir, $LogsDir, $SamplesDir)) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    $msg" -ForegroundColor Yellow }

function Get-Sha256($path) {
    (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-Json($url) {
    Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "sorty-local-speech" } -TimeoutSec 30
}

function Get-CachedServer($procId) {
    if (-not $procId) { return $null }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if (-not $p -or -not $p.ExecutablePath) { return $null }
    if ($p.ExecutablePath -ine $serverExe) { return $null }
    return $p
}

function Test-Health($timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    do {
        try {
            $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($r.status -eq "ok") { return $true }
        } catch { }
        if ($timeoutSec -le 0) { break }
        Start-Sleep -Milliseconds 400
    } while ((Get-Date) -lt $deadline)
    return $false
}

$cached = $null
if (Test-Path $Manifest) {
    try { $cached = Get-Content $Manifest -Raw | ConvertFrom-Json } catch { $cached = $null }
}

# ---------- 1. prefer the install already on disk (no network) -------------
$pick = $null
$modelSha = $null
$serverExe = $null
$zipPath = $null

$cacheUsable = $false
if ($cached -and $cached.release -and $cached.release.tag -and $cached.model -and
    (Test-Path $ModelPath) -and ((Get-Item $ModelPath).Length -eq $cached.model.bytes)) {
    $zipPath = Join-Path $CacheDir $cached.release.asset
    if ((Test-Path $cached.server.executable) -or (Test-Path $zipPath)) { $cacheUsable = $true }
}

if ($cacheUsable) {
    $pick = [pscustomobject]@{
        Tag     = $cached.release.tag
        Name    = $cached.release.asset
        Size    = 0
        Sha256  = $cached.release.sha256
        Url     = $null
        IsArm64 = [bool]$cached.release.nativeArm64
    }
    $modelSha = $cached.model.sha256
    if (Test-Path $cached.server.executable) {
        $serverExe = (Resolve-Path $cached.server.executable).Path
    }
    Write-Step "Using cached whisper.cpp install from server.json (no network)"
    Write-Ok "release $($pick.Tag) / $($pick.Name), model $ModelFile"
} else {
    Write-Step "Resolving latest official whisper.cpp release with a Windows CPU asset"
    $arch = $env:PROCESSOR_ARCHITECTURE
    $isArm64 = ($arch -eq "ARM64")
    $preferred = @()
    if ($isArm64) { $preferred += "whisper-bin-win-cpu-arm64.zip" }
    $preferred += "whisper-bin-x64.zip"

    $releases = Get-Json "$GitHubApi/releases?per_page=20"
    foreach ($name in $preferred) {
        foreach ($rel in $releases) {
            $asset = $rel.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
            if ($asset -and $asset.digest -and $asset.digest.StartsWith("sha256:")) {
                $pick = [pscustomobject]@{
                    Tag     = $rel.tag_name
                    Name    = $asset.name
                    Size    = $asset.size
                    Sha256  = $asset.digest.Substring(7).ToLowerInvariant()
                    Url     = $asset.browser_download_url
                    IsArm64 = ($name -eq "whisper-bin-win-cpu-arm64.zip")
                }
                break
            }
        }
        if ($pick) { break }
    }
    if (-not $pick) { throw "No official Windows CPU release asset with a sha256 digest was found on GitHub." }
    Write-Ok "release $($pick.Tag) asset $($pick.Name) ($([math]::Round($pick.Size/1MB,2)) MB, native=$($pick.IsArm64))"
    if ($isArm64 -and -not $pick.IsArm64) {
        Write-Warn2 "No official Windows ARM64 asset in the scanned releases - falling back to official x64 (runs under emulation)."
    }

    function Get-VerifiedDownload($url, $dest, $expectedSha256, $maxSeconds, $label) {
        if (Test-Path $dest) {
            $have = Get-Sha256 $dest
            if ($have -eq $expectedSha256) {
                Write-Ok "$label cached and verified ($have)"
                return
            }
            Write-Warn2 "$label cached file failed verification - discarding"
            Remove-Item -Force $dest
        }
        $partial = "$dest.download"
        Write-Step "Downloading $label (resumable, max ${maxSeconds}s)"
        & curl.exe -sSL --fail -C - --max-time $maxSeconds -o $partial $url
        if ($LASTEXITCODE -ne 0) {
            throw "$label download failed (curl exit $LASTEXITCODE). Re-run this script to resume from $partial."
        }
        $got = Get-Sha256 $partial
        if ($got -ne $expectedSha256) {
            Remove-Item -Force $partial -ErrorAction SilentlyContinue
            throw "$label SHA256 mismatch. expected=$expectedSha256 actual=$got"
        }
        Move-Item -Force $partial $dest
        Write-Ok "$label verified ($got)"
    }

    $zipPath = Join-Path $CacheDir $pick.Name
    Get-VerifiedDownload $pick.Url $zipPath $pick.Sha256 180 "whisper.cpp $($pick.Tag) $($pick.Name)"

    Write-Step "Resolving Hugging Face model SHA256 for $ModelFile"
    $hf = Get-Json "https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main"
    $hfEntry = $hf | Where-Object { $_.path -eq $ModelFile } | Select-Object -First 1
    if (-not $hfEntry -or -not $hfEntry.lfs -or -not $hfEntry.lfs.oid) {
        throw "Hugging Face API did not return an LFS sha256 for $ModelFile."
    }
    $modelSha = $hfEntry.lfs.oid.ToLowerInvariant()
    Write-Ok "model sha256 $modelSha ($([math]::Round($hfEntry.size/1MB,2)) MB)"
    Get-VerifiedDownload "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$ModelFile" $ModelPath $modelSha 180 "model $ModelFile"
}

# ---------- 2. extract + locate whisper-server -----------------------------
if (-not $serverExe) {
    if (-not (Test-Path $zipPath)) { throw "Cached archive missing: $zipPath" }
    $serverBinDir = Join-Path $BinDir ("{0}-{1}" -f $pick.Tag, $(if ($pick.IsArm64) { "arm64" } else { "x64" }))
    Write-Step "Extracting into $serverBinDir"
    Expand-Archive -Path $zipPath -DestinationPath $serverBinDir -Force
    $found = Get-ChildItem -Path $serverBinDir -Recurse -Filter "whisper-server.exe" | Select-Object -First 1
    if (-not $found) { throw "whisper-server.exe not present in $($pick.Name) (expected in the official archive)." }
    $serverExe = $found.FullName
}
$serverExe = (Resolve-Path $serverExe).Path
$serverBinDir = Split-Path -Parent $serverExe
Write-Ok "whisper-server: $serverExe"

# ---------- 3. reuse, or start hidden/detached on 127.0.0.1:1236 -----------
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
$serverPid = $null
$startedAt = $null
if ($listener) {
    $serverPid = [int]$listener.OwningProcess
    $owned = Get-CachedServer $serverPid
    if ($owned) {
        Write-Step "whisper-server already listening on port $Port (pid $serverPid) - checking health"
        if (Test-Health 10) {
            Write-Ok "existing server is healthy and is our exact binary - reusing"
            if ($cached -and $cached.server.startedAt) { $startedAt = $cached.server.startedAt }
        } else {
            Write-Warn2 "our server is unhealthy - restarting only that PID"
            Stop-Process -Id $serverPid -Force
            $serverPid = $null
            Start-Sleep -Seconds 1
        }
    } else {
        throw "Port $Port is already in use by pid $serverPid ($($listener.LocalAddress)); refusing to touch an unrelated process."
    }
}

if (-not $serverPid) {
    Write-Step "Starting whisper-server on 127.0.0.1:$Port (hidden, detached)"
    $stdoutLog = Join-Path $LogsDir "whisper-server.stdout.log"
    $stderrLog = Join-Path $LogsDir "whisper-server.stderr.log"
    $argLine = '--model "{0}" --host 127.0.0.1 --port {1} --language en --threads 6' -f $ModelPath, $Port
    $proc = Start-Process -FilePath $serverExe -ArgumentList $argLine -WorkingDirectory $serverBinDir `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
    $serverPid = $proc.Id
    $startedAt = (Get-Date).ToString("o")
    Set-Content -Path $PidFile -Value $serverPid -NoNewline
    Write-Ok "spawned pid $serverPid; waiting up to 30s for /health"
    if (-not (Test-Health 30)) {
        $tail = (Get-Content $stderrLog -Tail 20 -ErrorAction SilentlyContinue) -join "`n"
        throw "whisper-server did not become healthy within 30s. stderr:`n$tail"
    }
    Write-Ok "healthy at http://127.0.0.1:$Port/health"
}
if (-not (Test-Path $PidFile)) { Set-Content -Path $PidFile -Value $serverPid -NoNewline }
if (-not $startedAt) { $startedAt = (Get-Date).ToString("o") }
$procInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid"

# ---------- 4. real smoke test (official jfk.wav, 16 kHz PCM) --------------
$smokeResult = $null
if (-not $NoSmoke) {
    if (-not (Test-Path $SamplePath) -or (Get-Item $SamplePath).Length -eq 0) {
        Write-Step "Downloading official sample samples/jfk.wav"
        & curl.exe -sSL --fail --max-time 60 -o $SamplePath "https://raw.githubusercontent.com/ggml-org/whisper.cpp/$($pick.Tag)/samples/jfk.wav"
        if ($LASTEXITCODE -ne 0) { throw "Could not download samples/jfk.wav (curl exit $LASTEXITCODE)." }
    }
    Write-Step "Smoke testing /inference with samples/jfk.wav"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $curlOut = & curl.exe -sS --max-time 120 -o $SmokePath `
        -w "%{http_code} %{time_total}" `
        -F "file=@$SamplePath;type=audio/wav" -F "language=en" -F "response_format=json" -F "temperature=0" `
        "http://127.0.0.1:$Port/inference"
    $sw.Stop()
    $parts = ($curlOut | Out-String).Trim() -split '\s+'
    $httpCode = $parts[0]
    $serverTime = $parts[1]
    if ($httpCode -ne "200") {
        $body = Get-Content $SmokePath -Raw -ErrorAction SilentlyContinue
        throw "Smoke test failed: HTTP $httpCode. body=$body"
    }
    $json = Get-Content $SmokePath -Raw | ConvertFrom-Json
    if (-not $json.text) { throw "Smoke test returned no transcript. body=$(Get-Content $SmokePath -Raw)" }
    # canonical 44-byte header, 16 kHz mono PCM16
    $audioSec = [math]::Round((((Get-Item $SamplePath).Length - 44) / 32000.0), 2)
    $smokeResult = [pscustomobject]@{
        httpStatus   = [int]$httpCode
        transcript   = $json.text.Trim()
        latencySec   = [double]$serverTime
        wallClockSec = [math]::Round($sw.Elapsed.TotalSeconds, 3)
        audioSec     = $audioSec
        language     = "en"
        wavPath      = $SamplePath
        wavSha256    = Get-Sha256 $SamplePath
        wavBytes     = (Get-Item $SamplePath).Length
        responseFile = $SmokePath
    }
    Write-Ok "transcript: `"$($smokeResult.transcript)`""
    Write-Ok "latency: $($smokeResult.latencySec)s server / $($smokeResult.wallClockSec)s wall for $($smokeResult.audioSec)s audio"
} else {
    Write-Warn2 "smoke test skipped (-NoSmoke)"
    if ($cached -and $cached.smoke) { $smokeResult = $cached.smoke }
}

# ---------- 5. manifest ----------------------------------------------------
$manifestObj = [ordered]@{
    service        = "whisper.cpp"
    release        = [ordered]@{ tag = $pick.Tag; asset = $pick.Name; sha256 = $pick.Sha256; nativeArm64 = $pick.IsArm64; arch = $env:PROCESSOR_ARCHITECTURE }
    model          = [ordered]@{ file = $ModelFile; path = $ModelPath; sha256 = $modelSha; bytes = (Get-Item $ModelPath).Length }
    server         = [ordered]@{
        pid         = $serverPid
        executable  = $serverExe
        commandLine = $procInfo.CommandLine
        host        = "127.0.0.1"
        port        = $Port
        healthUrl   = "http://127.0.0.1:$Port/health"
        inferenceUrl= "http://127.0.0.1:$Port/inference"
        startedAt   = $startedAt
    }
    files          = [ordered]@{
        pidFile     = $PidFile
        manifest    = $Manifest
        stdoutLog   = Join-Path $LogsDir "whisper-server.stdout.log"
        stderrLog   = Join-Path $LogsDir "whisper-server.stderr.log"
        smoke       = $SmokePath
        sample      = $SamplePath
        archive     = $zipPath
    }
    smoke          = $smokeResult
}
$manifestObj | ConvertTo-Json -Depth 6 | Set-Content -Path $Manifest -Encoding UTF8

Write-Step "Ready"
[ordered]@{
    ok          = $true
    pid         = $serverPid
    port        = $Port
    health      = "http://127.0.0.1:$Port/health"
    inference   = "http://127.0.0.1:$Port/inference"
    release     = $pick.Tag
    assetSha256 = $pick.Sha256
    model       = $ModelFile
    modelSha256 = $modelSha
    transcript  = if ($smokeResult) { $smokeResult.transcript } else { $null }
    latencySec  = if ($smokeResult) { $smokeResult.latencySec } else { $null }
    manifest    = $Manifest
} | ConvertTo-Json -Depth 4
