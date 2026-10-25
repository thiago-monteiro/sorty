# General visual instruction agent

The default flow is camera + user goal -> one local VLM -> object boxes, descriptions, and a short ordered set of next actions. There is no fixed task category, COCO detector, cloud text planner, or user selection of movable objects.

## Run

```powershell
node scripts/download-scene-vlm.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-scene-vlm.ps1 -SkipDownload -SkipSmoke
npm run demo
```

The installed model is official Qwen3-VL-2B-Instruct, Q4_K_M with a Q8 vision projector, served by the native ARM64 llama.cpp runner on loopback port 1235 as `sorty-scene`. The verified downloads total 1,552,463,168 bytes. `scripts/start-demo.ps1` reuses or starts this installed model.

`SCENE_VLM_BASE_URL` and `SCENE_VLM_MODEL` select another OpenAI-compatible vision endpoint. The defaults are `http://127.0.0.1:1235/v1` and `sorty-scene`.

## API

POST `/api/scene` with `{image, goal, previous?}`. Image is a base64 JPEG/PNG <=5 MB; goal <=500 characters. Previous contains summary, steps, and currentStep (the count of user-reported actions). The model sees the real image and this task context in one request. It returns status (`working`, `complete`, or `needs_input`), a brief summary, objects with id/label/description and estimated boxes, an optional question, and up to five ordered steps with optional targetIds.

The VLM emits xyxy boxes on a 0..1000 image grid. The server validates bounds, unique IDs and target references, then normalizes boxes to xywh in 0..1. Invalid model responses fail; there is no invented fallback. Results always have `verified: false`.

For the local llama.cpp runner the request carries a GBNF `grammar` that masks invalid tokens, so the answer is always one JSON object in the expected shape: no prose, markdown fence, or truncation. Hosted OpenAI-compatible endpoints get the equivalent `response_format` JSON schema instead. Cross-field rules (target IDs must exist) are still checked by zod after generation.

## Interaction

Say or type any visual task. The plan shows its short ordered steps, with the active step and its instruction anchored to the model-localized object in AR. Done advances to the next step locally. Check result captures a fresh view and spends another inference; it does not assume success because the user said Done. The agent can correct an action, ask a question or request a closer view.

Boxes overlay the exact analyzed frame, labeled as a captured frame with AI estimates. In the XR flow a box bound to a measured footprint uses that footprint; an unmatched box becomes a floor pointing anchor from the captured camera pose. Neither path treats image pixels as metric dimensions. Use Look again to reopen the live view, then Update view to analyze it. Voice supports goal input, done, repeat, pause, resume and rechecking.

## Evidence and limits

Initial real-room smoke inference produced nine object boxes/descriptions and five suggestions in 36.9 seconds at about 3.3 GiB working set. This was a benchmark with a different prompt, not a guarantee for the app. The app prompt has since changed to a short ordered-step plan. The runner now uses eight threads and 1024 image tokens for grounding. Boxes and descriptions can still be wrong, small parts may need a closer photo, and suggestions need user judgment. A view cannot establish hidden states, handling safety or metric clearances.

Voice input uses the browser's `SpeechRecognition` when available. Browsers without it fall back to local Whisper via `/api/speech`, with silence endpointing in the browser. See [local speech setup](LOCAL_SPEECH.md).
