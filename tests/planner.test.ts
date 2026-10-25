import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS as settings, type Room } from "../src/domain/types";
import { SAMPLE_ROOM } from "../src/domain/sample";
import {
  assessRoom,
  circleClear,
  corners,
  overlaps,
  pointInPolygon,
} from "../src/geometry";
import { solveRoom, translationPath } from "../src/planner";
const clone = (): Room => structuredClone(SAMPLE_ROOM);
test("sample blocked; a lightweight relocation creates a route and turning circle", () => {
  const r = clone();
  assert.equal(assessRoom(r, settings).routeClear, false);
  const p = solveRoom(r, settings);
  assert.equal(p.status, "ready", p.reason);
  assert.ok(p.steps.length >= 1 && p.steps.length <= 2);
  assert.ok(p.after.routeClear && p.after.turningClear);
  for (const step of p.steps) {
    const o = p.roomAfter.obstacles.find((o) => o.id === step.obstacleId)!;
    assert.ok(corners(o).every((c) => pointInPolygon(c, r.boundary)));
    assert.ok(
      p.roomAfter.obstacles.every((b) => b.id === o.id || !overlaps(o, b)),
    );
  }
  assert.deepEqual(r, SAMPLE_ROOM);
});
test("fixed blocker cannot be relocated", () => {
  const r = clone();
  r.obstacles.forEach((o) => (o.movable = false));
  assert.equal(solveRoom(r, settings).status, "unsolved");
});
test("invalid and unreviewed geometry remains uncertain", () => {
  const r = clone();
  r.reviewed = false;
  assert.ok(assessRoom(r, settings).uncertain);
  assert.equal(solveRoom(r, settings).status, "unsolved");
  r.boundary = [];
  assert.ok(assessRoom(r, settings).uncertain);
});
test("turn circle detects exact rectangle corner collision and boundary", () => {
  const r = clone();
  r.obstacles = [];
  assert.ok(circleClear(r, { x: 3, y: 2 }, 1));
  assert.equal(circleClear(r, { x: 0.4, y: 2 }, 0.5), false);
  r.obstacles = [
    { ...SAMPLE_ROOM.obstacles[2], x: 3.6, y: 2.6, width: 0.2, depth: 0.2 },
  ];
  assert.equal(circleClear(r, { x: 3, y: 2 }, 0.86), false);
  assert.ok(circleClear(r, { x: 3, y: 2 }, 0.84));
});
test("corridor threshold, margin and bottleneck reflect full route", () => {
  const r = clone();
  r.obstacles = r.obstacles.filter((o) => o.id !== "basket");
  assert.ok(assessRoom(r, { ...settings, clearance: 1.4 }).routeClear);
  assert.equal(
    assessRoom(r, { ...settings, clearance: 1.6 }).routeClear,
    false,
  );
  const a = assessRoom(r, settings);
  assert.ok(a.bottleneck > 1.55 && a.bottleneck < 1.61);
  assert.equal(
    assessRoom(r, { ...settings, clearance: 1.4, margin: 0.11 }).routeClear,
    false,
  );
});
test("boundary endpoint clearance and separate doorway check", () => {
  const r = clone();
  r.start = { x: 0.1, y: 2.2 };
  assert.equal(assessRoom(r, settings).routeClear, false);
  r.start = SAMPLE_ROOM.start;
  r.doorwayWidth = 0.7;
  assert.equal(solveRoom(r, settings).status, "unsolved");
  assert.ok(assessRoom(r, settings).issues.some((i) => i.includes("Doorway")));
});

test("translation records a checked detour and cannot cross a fixed wall", () => {
  const r = clone();
  r.boundary = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 6 },
    { x: 0, y: 6 },
  ];
  const o = { ...SAMPLE_ROOM.obstacles[2], x: 1, y: 2, width: 0.4, depth: 0.4 };
  const wall = {
    ...SAMPLE_ROOM.obstacles[0],
    x: 2.5,
    y: 1,
    width: 0.5,
    depth: 3,
  };
  r.obstacles = [o, wall];
  const to = { ...o, x: 4, y: 2 };
  const path = translationPath(r, o, to, settings, Date.now() + 2000);
  assert.ok(path.length > 2);
  assert.deepEqual(path[0], { x: o.x, y: o.y });
  assert.deepEqual(path.at(-1), { x: to.x, y: to.y });
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const swept = {
      ...o,
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: o.width + Math.abs(a.x - b.x),
      depth: o.depth + Math.abs(a.y - b.y),
    };
    assert.equal(overlaps(swept, wall, settings.margin), false);
    assert.ok(
      corners(swept, settings.margin).every((p) =>
        pointInPolygon(p, r.boundary),
      ),
    );
  }
  r.obstacles[1] = { ...wall, y: 0, depth: 6 };
  assert.deepEqual(translationPath(r, o, to, settings, Date.now() + 2000), []);
});
test("two separate corridor blockers require two relocations", () => {
  const r = clone();
  r.obstacles[2] = { ...r.obstacles[2], x: 2 };
  r.obstacles.push({
    ...r.obstacles[2],
    id: "basket-2",
    label: "Second basket",
    x: 3.7,
  });
  const plan = solveRoom(r, settings);
  assert.equal(plan.status, "ready", plan.reason);
  assert.equal(plan.steps.length, 2);
  for (const step of plan.steps) {
    assert.ok(step.movementPath);
    const length = step
      .movementPath!.slice(1)
      .reduce(
        (n, p, i) =>
          n +
          Math.hypot(
            p.x - step.movementPath![i].x,
            p.y - step.movementPath![i].y,
          ),
        0,
      );
    assert.equal(step.distance, length);
  }
});
test("malformed and oversized geometry is rejected without allocating a grid", () => {
  const r = clone();
  r.boundary[1].x = 1e12;
  assert.ok(assessRoom(r, settings).uncertain);
  const broken = clone();
  broken.boundary[1] = null as never;
  assert.ok(assessRoom(broken, settings).uncertain);
  const obstacles = clone();
  obstacles.obstacles[1] = null as never;
  assert.ok(assessRoom(obstacles, settings).uncertain);
  const overlap = clone();
  overlap.obstacles.push({
    ...overlap.obstacles[2],
    id: "duplicate-footprint",
  });
  assert.ok(assessRoom(overlap, settings).uncertain);
});

test("a destination occupied by fixed furniture cannot produce a plan", () => {
  const r = clone();
  r.goal = { x: 3, y: 0.8 };
  assert.equal(solveRoom(r, settings).status, "unsolved");
});

test("automatic scans can assess a selected route without inventing a doorway measurement", () => {
  const room = clone();
  delete room.doorwayWidth;
  assert.equal(solveRoom(room, settings).status, "unsolved");
  const selectedRoute = solveRoom(room, { ...settings, checkDoorway: false });
  assert.equal(selectedRoute.status, "ready", selectedRoute.reason);
  assert.equal(selectedRoute.roomAfter.doorwayWidth, undefined);
  assert.ok(
    selectedRoute.after.issues.some((issue) =>
      issue.includes("not been measured"),
    ),
  );
});
