# Local speech-to-text (whisper.cpp)

Fallback ASR for the app's microphone path. The primary engine is the browser's own
`SpeechRecognition` (`webkitSpeechRecognition` in Chrome), which handles accents far
better than a tiny local model; its audio goes to the browser vendor's speech service.
This local Whisper server is used only when the browser has no recognizer. It is
separate from the local **vision** model (scene/VLM); audio and vision do not share a
model or process.

- **Server:** `whisper-server` from the official [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) release
- **Bind:** `127.0.0.1:1236` only (never `0.0.0.0`)
- **Model:** `ggml-tiny.en.bin` (~74 MB, English-only, fast enough for push-to-talk)
- **Install:** `powershell -ExecutionPolicy Bypass -File scripts/setup-local-speech.ps1`

## Requirements

- Windows on ARM64 (Snapdragon X) uses the official **native ARM64** CPU build when available;
  otherwise the script falls back to the official **x64** build under emulation. No compiling.
- PowerShell 5.1+, `curl.exe` (ships with Windows).
- Port **1236** must be free. The setup script never binds, probes or restarts any other port
  (`1235`, `5173`, etc.) and never kills a process it does not own.

## What the script does

1. If `server.json`, the runner and the model are already on disk, skips straight to
   reuse/start. Otherwise reads the GitHub releases API and picks the newest official
   release that publishes `whisper-bin-win-cpu-arm64.zip` (or `whisper-bin-x64.zip` when
   ARM64 is unavailable).
2. Verifies the downloaded archive against the release asset's `digest` (`sha256:...`) from
   the GitHub API before extracting.
3. Downloads `ggml-tiny.en.bin` from Hugging Face and verifies the SHA256 from the HF API
   (LFS `oid`).
4. Extracts once into `.runtime/speech/bin/<tag>-<arch>/`, starts `whisper-server.exe` as a
   hidden, detached process with logs and a PID file.
5. Waits up to **30 s** for `/health`; each download attempt is bounded to **180 s** and is
   resumable (`curl -C -`), so a re-run continues where it stopped.
6. Smoke-tests the real official 16 kHz PCM sample `samples/jfk.wav` through `/inference`
   and writes `.runtime/speech-smoke.json`.

The script is idempotent and **manifest/cache first**: when `server.json`, the extracted
runner and the model are present, it never calls GitHub or Hugging Face, so it also works
offline. If a healthy server that is *exactly our binary* is already listening on 1236, it
is reused (no restart, no download). If our binary is listening but unhealthy, only that
PID is restarted. If an unrelated process owns 1236, the script stops with an error.
`-NoSmoke` skips inference and takes under a second on a live server, which makes it safe
to call from `start-demo.ps1` before starting the app.

## HTTP protocol

### Health

```http
GET http://127.0.0.1:1236/health
```

- `200 {"status":"ok"}` — model loaded, ready for inference (this is the readiness check).
- `200 {"status":"loading model"}` — process is up but the model is not loaded yet.

Poll `/health`; do not treat TCP-accept as ready.

### Transcribe

```http
POST http://127.0.0.1:1236/inference
Content-Type: multipart/form-data

file=@recording.wav          (required; 16 kHz mono PCM16 WAV, filename must end in .wav)
language=en                  (optional; "auto" to detect)
response_format=json         (optional; json | text | srt | vtt; default text)
temperature=0                (optional; 0 is deterministic)
```

Response `200`, `application/json`:

```json
{"text":" And so my fellow Americans ask not what your country can do for you\n ask what you can do for your country.\n"}
```

That is the whole body for `response_format=json`; read `text`. Use
`response_format=verbose_json` only if you need the OpenAI-style extras (`task`,
`language`, `duration`, `segments[]`), and `detect_language=true` to get a `language`
field in the plain JSON response. Other statuses: `400` with `{"error":"..."}` for a
missing/invalid `file` field, `404` for an unknown path. The server accepts WAV only by
default; the browser recorder must upload mono PCM16 WAV (the parent `/api/speech` proxy
forwards the multipart body unchanged).

Minimal client check:

```powershell
curl.exe -sS -o .runtime/speech-smoke.json -w "%{http_code} %{time_total}\n" `
  -F "file=@.runtime/speech/samples/jfk.wav;type=audio/wav" `
  -F "language=en" -F "response_format=json" -F "temperature=0" `
  "http://127.0.0.1:1236/inference"
```

## Files and manifests

Everything lives under `.runtime/speech/` (gitignored runtime state):

| Path | Purpose |
| --- | --- |
| `cache/whisper-bin-win-cpu-arm64.zip` | cached release archive (hash-verified) |
| `models/ggml-tiny.en.bin` | ASR model (HF SHA256 verified) |
| `bin/<tag>-<arch>/` | extracted server + DLLs |
| `samples/jfk.wav` | official smoke sample (~11 s, 16 kHz PCM) |
| `logs/whisper-server.stdout.log` / `.stderr.log` | server logs |
| `whisper-server.pid` | running server PID |
| `server.json` | manifest: release/tag, asset SHA256, model SHA256, PID, exact command line, ports, paths, smoke result |
| `.runtime/speech-smoke.json` | raw `/inference` response from the last smoke test |

Example `server.json` fields:

```json
{
  "release": { "tag": "b5454", "asset": "whisper-bin-win-cpu-arm64.zip", "sha256": "28c37e…", "nativeArm64": true },
  "model":   { "file": "ggml-tiny.en.bin", "sha256": "921e4c…", "bytes": 77704715 },
  "server":  { "pid": 12345, "port": 1236, "healthUrl": "http://127.0.0.1:1236/health", "inferenceUrl": "http://127.0.0.1:1236/inference" }
}
```

## Lifecycle

Start / verify (also resumes downloads and restarts our unhealthy server):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-local-speech.ps1
powershell -ExecutionPolicy Bypass -File scripts/setup-local-speech.ps1 -NoSmoke   # skip inference test
```

Stop only the server recorded in the PID file:

```powershell
$pidFile = ".runtime/speech/whisper-server.pid"
if (Test-Path $pidFile) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$(Get-Content $pidFile)"
  if ($p.ExecutablePath -like "*\.runtime\speech\bin\*\whisper-server.exe") { Stop-Process -Id $p.ProcessId -Force }
}
```

If the server is killed, the next run restarts it. Delete `.runtime/speech/bin` to force a
re-extract; delete `.runtime/speech/cache` to force a re-download.

## Troubleshooting

- **`did not become healthy within 30s`** — check
  `.runtime/speech/logs/whisper-server.stderr.log`. Usual cause: a missing DLL because the
  archive was extracted partially; delete `.runtime/speech/bin` and re-run.
- **`Port 1236 is already in use`** — an unrelated process owns it. Free it manually; the
  script will not kill it.
- **`SHA256 mismatch`** — a proxy or interrupted download corrupted the file. The bad file is
  deleted; re-run to resume/re-download.
- **Empty transcript** — the WAV is silent or not 16 kHz mono PCM16. The parent recorder must
  send uncompressed PCM WAV, not WebM/Opus.
- **Slow first request** — tiny.en loads in a few hundred ms; expect roughly real-time or
  faster on 8 cores for short clips (measure with the smoke test's `latencySec`).
