import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createSpeechRouter, validSpeechWav } from "../server/speech";
import { encodeWav, UtteranceSegmenter } from "../src/guidance/audio";

test("capture resamples microphone PCM into bounded native Whisper audio", () => {
  const wav = Buffer.from(encodeWav(new Float32Array(48000).fill(0.25), 48000));
  assert.equal(wav.length, 32044);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.ok(validSpeechWav(wav));
  assert.equal(wav.readInt16LE(44), 8192);
  assert.equal(validSpeechWav(wav.subarray(0, 50)), false);
  const stereo = Buffer.from(wav);
  stereo.writeUInt16LE(2, 22);
  assert.equal(validSpeechWav(stereo), false);
});
test("silence never triggers inference, speech ends after the quiet window", () => {
  const vad = new UtteranceSegmenter(),
    quiet = new Float32Array(1600),
    speech = new Float32Array(1600).fill(0.1);
  for (let i = 0; i < 40; i++) assert.equal(vad.push(quiet, 16000), null);
  for (let i = 0; i < 4; i++) assert.equal(vad.push(speech, 16000), null);
  let result: Float32Array | null = null;
  for (let i = 0; i < 9; i++) result = vad.push(quiet, 16000) || result;
  assert.ok(result);
  assert.ok(result.some((x) => x === speech[0]));
});
test("speech endpoint forwards real PCM, validates responses and rejects other audio", async () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  let calls = 0;
  app.use(
    "/api/speech",
    createSpeechRouter({
      fetch: async (_url, init) => {
        calls++;
        const form = init?.body as FormData;
        const file = form.get("file") as Blob;
        assert.ok(validSpeechWav(Buffer.from(await file.arrayBuffer())));
        assert.equal(form.get("response_format"), "json");
        return Response.json({ text: " Done. [BLANK_AUDIO] " });
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const post = (audio: string) =>
    fetch(`http://127.0.0.1:${addr.port}/api/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio }),
    });
  try {
    assert.equal(
      (await post(Buffer.from("invalid recording").toString("base64"))).status,
      400,
    );
    const response = await post(
      Buffer.from(encodeWav(new Float32Array(16000).fill(0.2), 16000)).toString(
        "base64",
      ),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, "Done.");
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
