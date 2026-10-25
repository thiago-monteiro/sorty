import assert from "node:assert/strict";
import test from "node:test";
import { ScanAccumulator } from "../src/xr/scan";

function scanGrid(scan: ScanAccumulator, offsetX = 10, offsetZ = -5) {
  let i = 0;
  for (let x = 0; x <= 4; x += 0.25)
    for (let z = 0; z <= 3; z += 0.25) {
      scan.addHit({ x: offsetX + x, y: 0, z: offsetZ + z }, i++ * 20);
    }
}
test("sparse observations cannot establish a floor or build a room", () => {
  const scan = new ScanAccumulator();
  scan.addHit({ x: 0, y: 0, z: 0 }, 0);
  scan.addHit({ x: 1, y: 0, z: 1 }, 3000);
  assert.equal(scan.getSnapshot().floorY, null);
  assert.equal(scan.getSnapshot().ready, false);
  assert.throws(() => scan.buildRoom());
});
test("metric hull uses first supported floor origin and preserves world X/Z orientation", () => {
  const scan = new ScanAccumulator();
  scanGrid(scan);
  const s = scan.getSnapshot(),
    room = scan.buildRoom();
  assert.deepEqual(s.origin, { x: 10, y: 0, z: -5 });
  assert.equal(s.area, 12);
  assert.deepEqual(s.boundary, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ]);
  assert.equal(room.source, "webxr");
  assert.equal(room.reviewed, false);
  assert.equal(room.doorwayWidth, undefined);
  for (const p of [room.start, room.goal]) {
    assert.ok(p.x >= 0.3 && p.x <= 3.7 && p.y >= 0.3 && p.y <= 2.7);
    assert.ok(s.floorPoints.some((w) => w.x - 10 === p.x && w.z + 5 === p.y));
  }
  assert.strictEqual(scan.getSnapshot(), s);
});
test("isolated low outliers and ceiling hits do not displace supported floor", () => {
  const scan = new ScanAccumulator();
  scan.addHit({ x: 0, y: -8, z: 0 }, 0);
  scanGrid(scan, 0, 0);
  scan.addHit({ x: 2, y: 2.5, z: 2 }, 5000);
  assert.equal(scan.getSnapshot().floorY, 0);
  scan.addHit({ x: 1, y: -1, z: 1 }, 6000);
  assert.equal(scan.getSnapshot().floorY, 0);
  assert.equal(scan.getSnapshot().elevatedPoints.length, 0);
});
test("elevated supported clusters become fixed generic objects; tiny clusters are omitted", () => {
  const scan = new ScanAccumulator();
  scanGrid(scan, 0, 0);
  for (const x of [1, 1.2, 1.4])
    for (const z of [1, 1.2, 1.4]) scan.addHit({ x, y: 0.6, z }, 6000);
  scan.addHit({ x: 3, y: 0.7, z: 2 }, 6100);
  const s = scan.getSnapshot();
  assert.equal(s.obstacles.length, 1);
  assert.equal(s.obstacles[0].label, "Object 1");
  assert.equal(s.obstacles[0].movable, false);
  assert.equal(s.obstacles[0].source, "webxr");
  assert.ok(s.obstacles[0].width > 0.4);
});
test("dedupe, invalid coordinates, and insufficient duration cannot fake readiness", () => {
  const scan = new ScanAccumulator();
  for (let i = 0; i < 100; i++) scan.addHit({ x: 0, y: 0, z: 0 }, i * 100);
  scan.addHit({ x: NaN, y: 0, z: 0 }, 10000);
  scan.addHit({ x: 21, y: 0, z: 0 }, 10000);
  assert.equal(scan.getSnapshot().samples, 1);
  scan.clear();
  for (let x = 0; x < 4; x += 0.2)
    for (let z = 0; z < 3; z += 0.2) scan.addHit({ x, y: 0, z }, 0);
  assert.equal(scan.getSnapshot().ready, false);
});
test("floor planes extend observed extent without substituting for timed floor hits", () => {
  const scan = new ScanAccumulator();
  scanGrid(scan, 0, 0);
  scan.addPlane(
    [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 0, z: 3 },
      { x: 0, y: 0, z: 3 },
    ],
    "floor",
  );
  scan.addPlane(
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 3, z: 0 },
      { x: 0, y: 3, z: 3 },
    ],
    "wall",
  );
  assert.equal(scan.getSnapshot().source, "planes");
  assert.equal(scan.getSnapshot().area, 15);
  assert.equal(scan.getSnapshot().obstacles.length, 0);
});

test("a provisional tabletop yields to supported lower floor while the horizontal frame stays fixed", () => {
  const scan = new ScanAccumulator();
  for (const x of [1, 1.2, 1.4])
    for (const z of [1, 1.2, 1.4]) scan.addHit({ x, y: 0.8, z }, 100);
  const table = scan.getSnapshot();
  assert.equal(table.floorY, 0.8);
  scanGrid(scan, 0, 0);
  const floor = scan.getSnapshot();
  assert.equal(floor.floorY, 0);
  assert.equal(floor.origin?.x, table.origin?.x);
  assert.equal(floor.origin?.z, table.origin?.z);
  assert.ok(floor.elevatedPoints.some((point) => point.y === 0.8));
  assert.ok(floor.obstacles.length > 0);
  assert.equal(scan.buildRoom().reviewed, false);
});

test("route endpoints leave clearance inside the observed boundary", () => {
  const scan = new ScanAccumulator();
  scanGrid(scan, 0, 0);
  const room = scan.buildRoom();
  for (const point of [room.start, room.goal]) {
    assert.ok(
      point.x >= 0.5 && point.x <= 3.5 && point.y >= 0.5 && point.y <= 2.5,
    );
  }
});
