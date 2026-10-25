import { test } from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera } from "three";
import type { Room } from "../src/domain/types";
import type { ScenePlan } from "../src/scene/types";
import {
  boxFloorAnchor,
  groundScene,
  approachPoint,
  scanStartPoint,
  floorTargetPoint,
} from "../src/xr/grounding";

const room: Room = {
  id: "scan",
  name: "Measured area",
  boundary: [
    { x: -3, y: -3 },
    { x: 3, y: -3 },
    { x: 3, y: 3 },
    { x: -3, y: 3 },
  ],
  start: { x: 0, y: 2 },
  goal: { x: 0, y: -2 },
  source: "webxr",
  capturedAt: "2026-10-24",
  reviewed: false,
  obstacles: [
    {
      id: "left",
      label: "A",
      x: -1,
      y: -0.2,
      width: 0.4,
      depth: 0.4,
      kind: "clutter",
      source: "webxr",
      movable: false,
    },
    {
      id: "right",
      label: "B",
      x: 0.6,
      y: -0.2,
      width: 0.4,
      depth: 0.4,
      kind: "furniture",
      source: "webxr",
      movable: false,
    },
  ],
};
const camera = new PerspectiveCamera(60, 1, 0.1, 30);
camera.position.set(0, 5, 0);
camera.up.set(0, 0, -1);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const capture = {
  cameraWorld: camera.matrixWorld.toArray(),
  projection: camera.projectionMatrix.toArray(),
  origin: { x: 0, y: 0, z: 0 },
  floorY: 0,
};
const scene: ScenePlan = {
  summary: "A basket and a stool.",
  objects: [
    {
      id: "basket",
      label: "basket",
      description: "Light basket",
      box: [0.29, 0.44, 0.1, 0.12],
      movable: "likely",
    },
    {
      id: "stool",
      label: "stool",
      box: [0.6, 0.43, 0.14, 0.14],
      movable: "unknown",
    },
  ],
  steps: [],
  model: "test-vlm",
  verified: false,
};

test("VLM semantics attach to measured objects without replacing metric dimensions", () => {
  const result = groundScene(room, scene, capture);
  assert.deepEqual(result.bindings, { basket: "left", stool: "right" });
  assert.equal(result.room.obstacles[0].label, "basket");
  assert.equal(result.room.obstacles[0].movable, true);
  assert.equal(result.room.obstacles[1].movable, false);
  assert.equal(result.room.obstacles[0].width, 0.4);
  assert.equal(result.room.obstacles[0].x, -1);
  assert.equal(room.obstacles[0].label, "A");
});
test("tiny parts cannot relabel whole furniture, unmatched and invalid poses stay fixed", () => {
  const tiny = {
    ...scene,
    objects: [
      {
        ...scene.objects[0],
        id: "button",
        label: "button",
        box: [0.32, 0.49, 0.01, 0.01] as [number, number, number, number],
      },
    ],
  };
  const result = groundScene(room, tiny, capture);
  assert.deepEqual(result.bindings, {});
  assert.deepEqual(result.unmatchedIds, ["button"]);
  assert.equal(result.room.obstacles[0].movable, false);
  const invalid = groundScene(room, scene, {
    ...capture,
    cameraWorld: Array(16).fill(0),
  });
  assert.deepEqual(invalid.bindings, {});
});
test("even model-portable objects remain fixed when the measured footprint is large", () => {
  const large = {
    ...room,
    obstacles: [
      { ...room.obstacles[0], id: "large", x: -1, y: -0.5, width: 2, depth: 1 },
    ],
  };
  const result = groundScene(
    large,
    {
      ...scene,
      objects: [{ ...scene.objects[0], box: [0.29, 0.39, 0.42, 0.22] }],
    },
    capture,
  );
  assert.equal(result.room.obstacles[0].movable, false);
});
test("a model's incorrect portable-sofa label cannot enable a furniture move", () => {
  const result = groundScene(
    room,
    {
      ...scene,
      objects: [{ ...scene.objects[0], label: "sofa", movable: "likely" }],
    },
    capture,
  );
  assert.equal(result.room.obstacles[0].movable, false);
});
test("duplicate VLM boxes share a measured object instead of creating phantom blockers", () => {
  const result = groundScene(
    room,
    {
      ...scene,
      objects: [scene.objects[0], { ...scene.objects[0], id: "duplicate" }],
    },
    capture,
  );
  assert.deepEqual(result.bindings, { basket: "left", duplicate: "left" });
  assert.deepEqual(result.unmatchedIds, []);
  assert.equal(result.room.obstacles.length, 2);
});
test("VLM boxes become floor pointing anchors from the captured pose", () => {
  const view = new PerspectiveCamera(60, 1, 0.1, 100);
  view.position.set(0, 1.6, 0);
  view.lookAt(0, 1.6, -3);
  view.updateMatrixWorld();
  const pose = {
    cameraWorld: view.matrixWorld.toArray(),
    projection: view.projectionMatrix.toArray(),
    origin: { x: 0, y: 0, z: 0 },
    floorY: 0,
  };
  const low = boxFloorAnchor([0.45, 0.8, 0.1, 0.2], pose);
  assert.ok(low);
  assert.ok(Math.abs(low.x) < 0.01);
  assert.ok(low.z < -2.4 && low.z > -3.2);
  assert.ok(Math.abs(low.y - 0.02) < 1e-8);
  // A box above the horizon has no floor hit, but still gets a direction.
  const high = boxFloorAnchor([0.45, 0.15, 0.1, 0.1], pose);
  assert.ok(high);
  assert.ok(high.z < -1.5);
  assert.equal(
    boxFloorAnchor([0.45, 0.8, 0.1, 0.2], {
      ...pose,
      projection: Array(16).fill(0),
    }),
    null,
  );
});
test("arrival and camera start points leave space outside measured obstacles", () => {
  const arrival = approachPoint(room, "left", { x: -2, y: 0 });
  assert.ok(arrival);
  assert.ok(arrival.x < -1.5);
  assert.equal(approachPoint(room, "not-measured"), null);
  const start = scanStartPoint(room, { x: -0.8, y: 0 });
  assert.ok(start);
  assert.ok(Math.hypot(start.x + 0.8, start.y) >= 0.5);
});
test("doorway arrival uses the calibrated floor plane and rejects non-room doors", () => {
  const door = {
    id: "door",
    label: "door",
    box: [0.45, 0.3, 0.1, 0.2] as [number, number, number, number],
  };
  const point = floorTargetPoint(room, door, capture);
  assert.ok(point);
  assert.ok(Math.abs(point.x) < 1e-8);
  assert.ok(Math.abs(point.y) < 1e-8);
  assert.equal(
    floorTargetPoint(room, { ...door, label: "cabinet door" }, capture),
    null,
  );
  assert.equal(
    floorTargetPoint(room, door, { ...capture, projection: Array(16).fill(0) }),
    null,
  );
});
