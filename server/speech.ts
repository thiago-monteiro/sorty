import express from "express";
import { z } from "zod";

/** Accept bounded PCM, never arbitrary files or decoder/ffmpeg input. */
export function validSpeechWav(bytes: Buffer): boolean {
  if (
    bytes.length < 44 ||
    bytes.length > 530000 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE" ||
    bytes.readUInt32LE(4) + 8 > bytes.length
  )
    return false;
  let format = false,
    data = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4),
      start = offset + 8;
    if (start + size > bytes.length) return false;
    if (kind === "fmt ") {
      if (size < 16) return false;
      format =
        bytes.readUInt16LE(start) === 1 &&
        bytes.readUInt16LE(start + 2) === 1 &&
        bytes.readUInt32LE(start + 4) === 16000 &&
        bytes.readUInt16LE(start + 14) === 16;
    }
    if (kind === "data") data = size >= 640 && size <= 512000 && size % 2 === 0;
    offset = start + size + (size % 2);
  }
  return format && data;
}
const schema = z
  .object({
    audio: z
      .string()
      .min(60)
      .max(710000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
type Options = { fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number };
export function createSpeechRouter(options: Options = {}) {
  const router = express.Router();
  const base = (
    options.baseUrl ??
    process.env.SPEECH_BASE_URL ??
    "http://127.0.0.1:1236"
  ).replace(/\/$/, "");
  const request = options.fetch ?? fetch;
  let busy = false;
  router.post("/", async (req, res) => {
    const started = Date.now();
    const trace = (extra: Record<string, unknown>) =>
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          speech: { ms: Date.now() - started, ...extra },
        }),
      );
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      trace({ status: 400, reason: "schema" });
      res.status(400).json({ error: "Invalid speech audio." });
      return;
    }
    const bytes = Buffer.from(parsed.data.audio, "base64");
    if (!validSpeechWav(bytes)) {
      trace({ status: 400, reason: "wav", bytes: bytes.length });
      res
        .status(400)
        .json({ error: "Expected mono 16 kHz PCM WAV, up to 16 seconds." });
      return;
    }
    if (busy) {
      trace({ status: 429, reason: "busy" });
      res.status(429).json({ error: "Speech is busy." });
      return;
    }
    busy = true;
    const controller = new AbortController();
    const close = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", close);
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 15000,
    );
    try {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
        "speech.wav",
      );
      form.append("language", "en");
      form.append("response_format", "json");
      form.append("temperature", "0");
      const response = await request(`${base}/inference`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Speech provider rejected the audio");
      const result = (await response.json()) as { text?: unknown };
      if (typeof result.text !== "string") throw new Error("No transcription");
      const text = result.text
        .replace(/\[[^\]]*\]|\([^)]*(?:music|silence|applause)[^)]*\)/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1000);
      res.json({
        text,
        local: true,
        model: "whisper-tiny.en",
        latencyMs: Date.now() - started,
      });
      trace({ status: 200, text: text.slice(0, 120), bytes: bytes.length });
    } catch (error) {
      trace({
        status: controller.signal.aborted ? 504 : 503,
        error: error instanceof Error ? error.message : String(error),
        bytes: bytes.length,
      });
      if (!res.destroyed)
        res
          .status(controller.signal.aborted ? 504 : 503)
          .json({
            error: controller.signal.aborted
              ? "Speech took too long."
              : "Local speech is unavailable.",
          });
    } finally {
      clearTimeout(timer);
      res.off("close", close);
      busy = false;
    }
  });
  return router;
}
