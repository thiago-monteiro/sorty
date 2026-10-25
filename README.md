<img src="public/sorty.svg" width="64" height="64" alt="Sorty">

# Sorty

**Show me. Guide me.** A general visual instruction agent: show the camera what you are working on, say what you want to do, and get a short grounded plan.

A local Qwen3-VL-2B model produces object boxes, descriptions, scene understanding and an ordered set of next actions. Done advances through that plan locally; Check result spends a fresh inference on a new view. Tasks are freeform; there is no fixed furniture or organization workflow. Labels and arrows overlay the analyzed frame, and voice handles the goal and follow-up conversation.

See [the model and API notes](docs/SCENE_MODEL.md) for setup, evidence, and limitations. The default Android flow combines metric WebXR scanning, VLM object understanding, browser speech recognition (local Whisper fallback) and spatial guidance. See [combined flow](docs/COMBINED_FLOW.md).

## Run the demo

Requires Node.js 22+ (developed on Node 24).

```powershell
npm install
npm run demo
```

Open **http://localhost:5173** on this laptop. In another terminal, create the temporary HTTPS Android link:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-android.ps1
```

Open the printed HTTPS URL directly in Android Chrome. The general camera agent does not require ARCore; the optional metric scan does. The tunnel starts in the background and reconnects within its running process. The launcher prints its PID; stop that PID after the demo. The URL is public to anyone who knows it. Camera frames are sent through the laptop server to the local VLM.

USB alternative: enable Android USB debugging, connect the phone, run `adb reverse tcp:5173 tcp:5173`, and visit `http://localhost:5173` in phone Chrome. This uses the phone's localhost secure-context exception. A plain HTTP laptop LAN address does not enable WebXR.

For a detached app process, run `powershell -ExecutionPolicy Bypass -File scripts/start-demo.ps1` instead of `npm run demo`; its PID and logs are saved in `.runtime/demo.*`.

For development with live reload: `npm run dev` starts Vite on 5173 and the API on 3001. `npm start` serves an existing production build on loopback port 3001. The compressed `npm run demo` build is preferable for a phone over a tunnel.

## A two-minute sample demonstration

1. Tap **Try sample**, then **Find a path**.
2. The map labels objects with letters and destinations with numbers. Follow the arrow from the movable object to point **1**.
3. Tap **Guide me**. Enable the microphone for short spoken cues and commands such as ?done,? ?pause,? ?repeat,? and ?that spot is taken.?
4. Report a blocked destination to get a new plan, or report the move done. Completion is a user report, not a verified measurement.
5. Choose **Scan again** to inspect the result on a compatible Android phone.

Sample data is explicitly labeled and never substitutes for live tracking.

## Real-room capture

1. Tap **Start scan** on Android Chrome.
2. Move the phone slowly while looking at the floor and surrounding objects. Measured points and detected surfaces appear as they are captured; a small map shows observed coverage.
3. When enough usable observations exist, finish the scan. There is no origin, axis, corner, or doorway tracing step.
4. Review the point labels and tap objects you can move. Automatic clusters receive generic labels; the system does not invent furniture identities.
5. Find a path and follow the arrows toward numbered targets. Short voice cues use the same labels as the screen.
6. Scan the changed area again to check it.

Tracked AR guidance retains the scan's coordinate frame within the same XR session. Starting a new session requires a fresh scan; old coordinates are not silently reused. The sample/ordinary-camera fallback uses a separate map, because ordinary camera pixels alone do not establish world tracking.

The scan captures **observed surfaces**, not a complete room mesh. Floor hulls may bridge unknown areas, and hidden or unsampled objects may be missing. Review is required. Doorway checks are a separate optional measurement and do not block the initial automatic scan.

## Local image understanding

The app works with manually confirmed object labels. An optional local vision model adds real image observations and before/after comparisons in the guidance camera panel. Captured frames are submitted deliberately; video is not continuously uploaded. Image observations cannot verify metric clearance.

On this laptop, the setup can reuse the installed Windows ARM64 llama.cpp runner:

```powershell
node scripts/download-model.mjs
powershell -ExecutionPolicy Bypass -File scripts/setup-native-vision.ps1
```

The downloader preserves resumable range chunks in ignored `.runtime/models`, and verifies both final GGUF hashes. The setup runs the SmolVLM-256M model and image projector on loopback port 1234. See [Android and model setup](docs/ANDROID_SETUP.md) for configurable paths, download limits, startup logs, and stopping the process.

Check actual model availability at `/api/health`, then test a real image:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-native-vision.ps1 -ApiUrl http://127.0.0.1:5173 -ImagePath path/to/room.jpg
```

No API key is required for local inference. Optional `.env` settings are documented in `.env.example`. Configuring a remote model endpoint sends frames to that endpoint. Browser speech recognition may use a network service; the application does not claim fully offline voice.

## What's technically substantive

- **Metric capture:** real WebXR hit-test poses, horizontal floor projection, a local coordinate frame, and explicit registration between AR sessions.
- **Spatial assessment:** polygon boundaries, conservative clearance envelopes, doorway and turning-circle checks, grid connectivity, and estimated widest-route bottlenecks.
- **Relocation search:** bounded one-then-two-object search, finite candidate placements, collision-checked object translation paths, and path-length cost. The planner runs in a Web Worker with a client timeout.
- **Closed-loop execution:** blocked destinations and movability changes trigger replanning; reported completion is separated from fresh geometric measurement.
- **Local vision service:** typed requests, size limits, concurrency control, deadlines, disconnect cancellation, and truthful unavailable/error states. Model output never becomes unmeasured geometry.

The default route-width reference draws from US Access Board guidance; turning space can be enabled separately. The app assesses selected planar geometry; it does not certify overall accessibility or ADA compliance. Slopes, thresholds, surface quality, all door maneuvering conditions, and individual requirements remain outside the first version.

## Validation

```powershell
npm test
npm run build
```
See [the build specification](docs/BUILD_PLAN.md) and [the primary-source WebXR feasibility notes](docs/webxr-feasibility.md).
