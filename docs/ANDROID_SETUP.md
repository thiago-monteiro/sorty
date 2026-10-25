# Current combined Android flow

Use `scripts/start-demo.ps1` and `scripts/start-android.ps1`, then open the printed HTTPS link directly in Android Chrome. The app combines the metric scan, VLM object recognition, browser speech recognition (local Whisper fallback) and AR guidance. There is no movable-object selection step. Camera, microphone, ARCore and WebXR raw-camera access require an actual Android test; use the camera fallback when unavailable. See [combined flow](COMBINED_FLOW.md), [local scene VLM](LOCAL_SCENE_VLM.md), and [local speech](LOCAL_SPEECH.md).

The remaining notes include earlier setup options for other models and connection methods.

# Android demo setup

Use a WebXR/ARCore-compatible Android phone with Chrome. Camera, microphone and immersive AR require a secure context; plain HTTP to the laptop LAN IP is insufficient.

1. In the project root, optionally copy `.env.example` to `.env`. Run `npm run demo` on the laptop for the compressed production build at port 5173. For a detached process use `powershell -ExecutionPolicy Bypass -File scripts/start-demo.ps1`; this writes its PID and logs under `.runtime/demo.*`.
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-android.ps1`. It verifies the official Windows x64 Cloudflare executable in `.runtime`, starts a hidden background tunnel, and prints a temporary HTTPS URL plus PID. Windows on ARM uses x64 emulation. The tunnel reconnects within the running process. Re-running the launcher reuses its verified process identity. The app's **Open on Android** dialog shows a QR code, updated in both public and production assets. No tunnel account or API key is needed.
3. Open that URL in Android Chrome. Grant camera/microphone permissions when requested. Check immersive AR availability on the actual phone. Compare a measured floor segment to a tape measure. Test leaving AR for camera inspection and returning to measurement; re-register or scan again after tracking resets.
4. The launcher prints the exact `Stop-Process -Id ...` command for the tunnel it started. Stop it after the demo. A quick tunnel exposes the app and API to anyone who knows its URL. Do not expose the model port; the model binds to loopback only. Frames are forwarded to the configured model. Speech input uses the browser's recognition service; only browsers without one fall back to Whisper on the laptop.

For USB access instead, enable Android debugging, connect the phone, run `adb reverse tcp:5173 tcp:5173`, and open `http://localhost:5173` on the phone. Localhost is treated as a secure context; plain HTTP to the laptop's LAN IP is not.

For development, `npm run dev` serves Vite on 5173 and proxies the API on 3001. For an existing build, `npm start` serves both on loopback port 3001; the phone launcher accepts `-Port 3001`. `/api/connect` LAN addresses are diagnostic, not secure phone URLs. The backend's `secure` field describes its local connection; Cloudflare terminates the phone's TLS connection.

## Optional local vision

For slow Hugging Face transfers, run `node scripts/download-model.mjs` before the native setup script. This dependency-free Node 24 downloader uses up to 16 concurrent 4 MiB ranges across both Q8_0 files, reuses a signed CDN redirect per file, checks every `206 Content-Range`, and verifies the assembled file against the HF API LFS SHA256. It keeps resumable range data under `.runtime/models/chunks` and preserves older curl `.part` files. Rerun to resume. The default download budget is 360 seconds; PowerShell can override it with `$env:DOWNLOAD_SECONDS='420'` and concurrency with `$env:DOWNLOAD_CONCURRENCY='8'` (maximum 16). Exit code 1 means the download remains incomplete; do not claim inference passed until setup and the image test below succeed.

Each `.chunk.partial` retains the validated response prefix when a request times out. Retries request only the remaining bytes and append after checking the exact returned start, end, and total; full `200` responses and oversized bodies are rejected. Requests have a 120-second timeout bounded by the remaining download budget. Only a complete chunk is renamed, and final files still require the full SHA256 check.

The installed Windows ARM64 llama.cpp runner can serve vision directly without the LM Studio daemon. Run `powershell -ExecutionPolicy Bypass -File scripts/setup-native-vision.ps1` (the existing `setup-local-vision.ps1` also prefers this runner). It discovers the native runner under `.lmstudio/extensions/backends`, downloads the Q8_0 SmolVLM model (175,054,528 bytes) and projector (103,769,856 bytes) directly from Hugging Face into ignored `.runtime/models`, verifies SHA256, and starts a hidden CPU server on loopback port 1234 with alias `sorty-smolvlm`. No packages or runtime download are needed. Downloads have a 240-second limit per file; rerun to resume retained `.part` files. Use `-DownloadTimeoutSeconds 600` for a slower connection, or `-Runner` to select a compatible executable explicitly. Startup has a 90-second limit; logs and the started PID are in `.runtime/vision.*`. The script leaves that server running for the demo and never stops unrelated processes. To stop it later, inspect the PID and command with `Get-Process -Id (Get-Content .runtime/vision.pid)` before using `Stop-Process` on that PID. If choosing another `-Port`, set `VISION_BASE_URL` accordingly. A loaded model alone does not verify vision.
Check `/api/health`: `vision.available` means a matching loaded model was discovered, not that image inference has passed. A real captured frame submitted through `/api/vision` must return an observation before claiming vision works. Observe its `latencyMs`. With the API running, use `powershell -ExecutionPolicy Bypass -File scripts/test-native-vision.ps1 -ImagePath path/to/non-sensitive-fixture.png` to print the actual observation and elapsed time. If unavailable, manual labeling and metric geometry remain functional. There are no canned model observations. Tiny models may misidentify objects; review all suggestions. Images never establish metric clearance or verify accessibility.

`VISION_BASE_URL` defaults to `http://127.0.0.1:1234/v1`; `VISION_MODEL` can select a loaded vision model explicitly. Changing the base URL can send images off the laptop, so review it before using private photos. Requests accept JPEG/PNG data URLs up to 5 MB each (12 MB total JSON), with optional `beforeImage` and `instruction`. Only one inference runs at a time, with a 60-second limit and cancellation on disconnect.

### Observed native vision run (2026-10-24)

Both exact Q8_0 files completed and passed SHA256:

- Model: `2a31195d3769c0b0fd0a4906201666108834848db768af11de1d2cef7cd35e65`
- Projector: `7e943f7c53f0382a6fc41b6ee0c2def63ba4fded9ab8ed039cc9e2ab905e0edd`

The installed `llama.cpp-win-arm64-2.64.0/llama-server.exe` started on `127.0.0.1:1234` with alias `sorty-smolvlm` using four CPU threads. A real PNG photo from [Hugging Face's documentation fixtures](https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/coco_sample.png), showing two cats and two remotes on a pink couch, was submitted through the running application's `http://127.0.0.1:5173/api/vision`. With instruction `What animals are visible in the image?`, the actual response was `Two cats are sleeping with two remotes next to them.` Server latency was 3,255 ms; client elapsed time was 3,378 ms. The response correctly retained `verified: false`. This confirms local image transport and useful inference for this fixture, not general accuracy or accessibility verification.

The simpler red rectangle/blue circle fixture returned only `1` (3,370 ms), demonstrating a quality limitation. After both requests the native process used 524,025,856 bytes working set, with a 545,112,064-byte peak. Ignored `.runtime/vision-cats-result.json`, `.runtime/vision-memory.json`, and `.runtime/range-round4.log` retain the observations, memory snapshot, and download/hash evidence. To repeat the successful request while this application runs on port 5173:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-native-vision.ps1 -ApiUrl http://127.0.0.1:5173 -ImagePath .runtime/vision-cats.png -Instruction 'What animals are visible in the image?'
```
