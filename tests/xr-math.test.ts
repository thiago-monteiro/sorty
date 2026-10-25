import test from "node:test";
import assert from "node:assert/strict";
import {
  makeBasis,
  toFloor,
  toWorld,
  rectangle,
  corners,
  inside,
  horizontalFloor,
  floorDistance,
} from "../src/xr/math";
test("floor projection is horizontal, metric, and invertible with a rotated fixed basis", () => {
  const b = makeBasis({ x: 3, y: 1, z: 4 }, { x: 3, y: 8, z: 6 });
  assert.deepEqual(toFloor({ x: 1, y: 99, z: 7 }, b), { x: 3, y: 2 });
  assert.deepEqual(toWorld({ x: 3, y: 2 }, b), { x: 1, y: 1, z: 7 });
});
test("reject degenerate axes and rectangles", () => {
  assert.throws(() => makeBasis({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }));
  assert.throws(() => rectangle({ x: 0, y: 0 }, { x: NaN, y: 2 }));
  assert.throws(() => rectangle({ x: 0, y: 0 }, { x: 0.01, y: 2 }));
});
test("rectangle normalization and bounds reject exterior footprints", () => {
  const boundary = corners(rectangle({ x: 0, y: 0 }, { x: -3, y: 4 }));
  assert.equal(inside({ x: -2, y: 3 }, boundary), true);
  assert.equal(
    corners(rectangle({ x: -1, y: 1 }, { x: 1, y: 2 })).every((p) =>
      inside(p, boundary),
    ),
    false,
  );
});
test("floor candidate requires upward near-horizontal normal", () => {
  assert.equal(horizontalFloor([0, 0, 0, 0, 0, 1]), true);
  assert.equal(horizontalFloor([0, 0, 0, 0, 0, 0]), false);
  assert.equal(horizontalFloor([0, 0, 0, 0, 0, -1]), false);
});

test("doorway width is horizontal and rejects invalid hits", () => {
  const b = makeBasis({ x: 3, y: 1, z: 4 }, { x: 3, y: 1, z: 6 });
  assert.equal(
    floorDistance(
      toFloor({ x: 3, y: 1, z: 4 }, b),
      toFloor({ x: 3, y: 1.05, z: 5 }, b),
    ),
    1,
  );
  assert.throws(() => floorDistance({ x: 0, y: 0 }, { x: 0, y: 0 }));
  assert.throws(() => floorDistance({ x: 0, y: 0 }, { x: NaN, y: 1 }));
});
