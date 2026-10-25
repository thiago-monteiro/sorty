# Local scene VLM

Official model repository: https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF

- Qwen3VL-2B-Instruct-Q4_K_M.gguf: 1,107,409,952 bytes; SHA256 089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae
- mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf: 445,053,216 bytes; SHA256 f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82

Both were fully downloaded and verified. The downloader resumes validated 4 MiB range chunks and verifies the complete files. The installed ARM64 llama.cpp server runs on 127.0.0.1:1235 under alias sorty-scene. It uses eight CPU threads, one slot, context 4096, 1024 image tokens, and a GBNF grammar for constrained decoding. The grammar guarantees one complete JSON object in the response shape; the matching schema in server/scene-schema.json is still used for hosted endpoints and for validation after generation.

```powershell
node scripts/download-scene-vlm.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-scene-vlm.ps1 -SkipDownload -SkipSmoke
```

The PID and logs are in .runtime/scene-vlm.pid and .runtime/scene-vlm.*.log. The setup script reuses a healthy server only when the model alias matches. start-demo.ps1 starts this installed model before the app.

Actual tests on this Snapdragon X Plus X1P42100 laptop:

- Initial room benchmark: 36.9 seconds, nine object boxes and descriptions, about 3.3 GiB working set. Its generic suggestions were weak; the application now uses a general, ordered-step prompt instead.
- Full structured laptop task via the real scene router: HTTP 200 in 46.3 seconds with three VLM object boxes/descriptions and one action. The public mobile-viewport flow subsequently completed a request in about 28 seconds with cached prompt context. Current runner working set was about 3.5 GiB.
- Grammar-constrained decoding was verified against this runner (build b1-36e36e6): a text-only request returned a complete valid scene object in 1.7 seconds, and real image requests through `/api/scene` returned valid plans in 32-54 seconds. The small model still tends to return one step for simple photos; the app accepts 0-6 if it produces more.
- The small headphone connector was localized coarsely. Do not interpret a valid JSON response as accurate recognition. Close-ups are necessary for small parts, and the model can misidentify them.

There is no COCO-SSD or cloud text-model stage in the default agent. The older SmolVLM runner was stopped. The same Qwen VLM handles object descriptions, boxes, scene reasoning and the ordered steps. Voice input uses the browser's SpeechRecognition service when available; browsers without one capture microphone PCM and use local whisper.cpp on the laptop. See LOCAL_SPEECH.md.
