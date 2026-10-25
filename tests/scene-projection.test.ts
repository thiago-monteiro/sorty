import { test } from "node:test";
import assert from "node:assert/strict";
import { coverBox } from "../src/scene/types";

test("object labels follow object-fit cover crop on a portrait phone", () => {
  const box = coverBox(
    [0.4, 0.2, 0.2, 0.4],
    { width: 1280, height: 720 },
    { width: 412, height: 915 },
  );
  assert.ok(Math.abs(box.x + box.width / 2 - 206) < 1e-8);
  assert.equal(box.y, 183);
  assert.equal(box.height, 366);
});
test("object labels retain horizontal image coordinates on a wide view", () => {
  const box = coverBox(
    [0.25, 0.25, 0.5, 0.5],
    { width: 1000, height: 1000 },
    { width: 1000, height: 500 },
  );
  assert.deepEqual(box, { x: 250, y: 0, width: 500, height: 500 });
});
test("VLM boxes align with the complete analyzed frame when letterboxed", () => {
  const box = coverBox(
    [0, 0, 1, 1],
    { width: 640, height: 480 },
    { width: 412, height: 915 },
    "contain",
  );
  assert.deepEqual(box, { x: 0, y: 303, width: 412, height: 309 });
});
