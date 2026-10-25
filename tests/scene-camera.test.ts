import test from "node:test";
import assert from "node:assert/strict";
import { fitFrame } from "../src/scene/camera";
test("frame sizing preserves aspect ratio and never upscales", () => {
  assert.deepEqual(fitFrame(1920, 1080), { width: 960, height: 540 });
  assert.deepEqual(fitFrame(1080, 1920), { width: 540, height: 960 });
  assert.deepEqual(fitFrame(640, 480), { width: 640, height: 480 });
  assert.throws(() => fitFrame(0, 1080));
  assert.throws(() => fitFrame(1920, 1080, 0));
});
