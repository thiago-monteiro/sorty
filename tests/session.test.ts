import test from "node:test";
import assert from "node:assert/strict";
import { applyReportedMove, excludeDestination } from "../src/domain/session";
import { SAMPLE_ROOM } from "../src/domain/sample";
import type { PlanStep, Room } from "../src/domain/types";

const step: PlanStep = {
  id: "move-1",
  obstacleId: "basket",
  label: "Basket",
  from: { x: 2.7, y: 1.85 },
  to: { x: 0.1, y: 0.7 },
  distance: 3.5,
  instruction: "Move basket",
  status: "pending",
};
test("a reported move downgrades measured positions and preserves sample identity", () => {
  const measured: Room = {
    ...structuredClone(SAMPLE_ROOM),
    source: "webxr",
    obstacles: SAMPLE_ROOM.obstacles.map((o) => ({ ...o, source: "webxr" })),
  };
  const moved = applyReportedMove(measured, step);
  assert.equal(moved.source, "manual");
  assert.equal(
    moved.obstacles.find((o) => o.id === "basket")?.source,
    "manual",
  );
  assert.equal(moved.obstacles.find((o) => o.id === "sofa")?.source, "webxr");
  assert.equal(measured.obstacles.find((o) => o.id === "basket")?.x, 2.7);
  assert.equal(applyReportedMove(SAMPLE_ROOM, step).source, "sample");
});
test("excluding a destination preserves previously reported moves during replanning", () => {
  const moved = applyReportedMove(SAMPLE_ROOM, step);
  const next: PlanStep = { ...step, obstacleId: "other", to: { x: 5, y: 0.2 } };
  const room: Room = {
    ...moved,
    obstacles: [
      ...moved.obstacles,
      { ...SAMPLE_ROOM.obstacles[2], id: "other" },
    ],
  };
  const blocked = excludeDestination(room, next, "reservation");
  assert.equal(blocked.obstacles.find((o) => o.id === "basket")?.x, step.to.x);
  assert.equal(
    blocked.obstacles.find((o) => o.id === "reservation")?.kind,
    "reserved",
  );
  assert.equal(
    blocked.obstacles.find((o) => o.id === "reservation")?.source,
    "manual",
  );
  assert.equal(blocked.obstacles.find((o) => o.id === "other")?.x, 2.7);
  assert.equal(room.obstacles.length + 1, blocked.obstacles.length);
});
