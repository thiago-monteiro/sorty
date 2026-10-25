import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera } from "three";
import { directionArrow, projectMarker } from "../src/xr/projection";

const camera = new PerspectiveCamera(60, 412 / 915, 0.01, 30);
camera.updateProjectionMatrix();
camera.updateMatrixWorld(true);
test("a tracked point ahead projects to its real screen position", () => {
  const marker = projectMarker({ x: 0, y: 0, z: -3 }, camera, 412, 915)!;
  assert.equal(marker.onScreen, true);
  assert.equal(marker.x, 206);
  assert.equal(marker.y, 457.5);
});
test("offscreen and behind-camera targets produce bounded directional cues", () => {
  const right = projectMarker({ x: 8, y: 0, z: -2 }, camera, 412, 915)!;
  assert.equal(right.onScreen, false);
  assert.equal(directionArrow(right.angle), "→");
  assert.ok(
    right.x <= 372 && right.x >= 40 && right.y >= 140 && right.y <= 775,
  );
  const behind = projectMarker({ x: -3, y: 0, z: 2 }, camera, 412, 915)!;
  assert.equal(behind.onScreen, false);
  assert.equal(directionArrow(behind.angle), "←");
  assert.equal(projectMarker({ x: 1, y: 0, z: -2 }, camera, 0, 915), null);
});
