import { Matrix4, Vector4 } from "three";
import type { Obstacle, Point, Room } from "../domain/types";
import type { SceneObject, ScenePlan } from "../scene/types";
import { pointInPolygon } from "../geometry";
import type { WorldPoint } from "./math";

export type SpatialCapture = {
  cameraWorld: number[];
  projection: number[];
  origin: { x: number; y: number; z: number };
  floorY: number;
};
type Box = [number, number, number, number];
const center = (box: Box) => ({
  x: box[0] + box[2] / 2,
  y: box[1] + box[3] / 2,
});
const area = (box: Box) => box[2] * box[3];
function overlap(a: Box, b: Box) {
  const width = Math.max(
    0,
    Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]),
  );
  const height = Math.max(
    0,
    Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]),
  );
  const intersection = width * height;
  return intersection / Math.max(1e-8, area(a) + area(b) - intersection);
}
const contains = (box: Box, p: Point) =>
  p.x >= box[0] &&
  p.x <= box[0] + box[2] &&
  p.y >= box[1] &&
  p.y <= box[1] + box[3];
function projectedBox(
  o: Obstacle,
  capture: SpatialCapture,
  matrix: Matrix4,
): Box | null {
  const points: Point[] = [];
  // This coarse vertical envelope is for semantic association only. It never
  // changes the measured footprint or supplies dimensions to the planner.
  for (const x of [o.x, o.x + o.width])
    for (const y of [o.y, o.y + o.depth])
      for (const lift of [0.04, 0.65]) {
        const p = new Vector4(
          capture.origin.x + x,
          capture.floorY + lift,
          capture.origin.z + y,
          1,
        ).applyMatrix4(matrix);
        if (p.w <= 0.001) continue;
        const nx = p.x / p.w,
          ny = p.y / p.w,
          nz = p.z / p.w;
        if (nz < -1 || nz > 1) continue;
        points.push({ x: (nx + 1) / 2, y: (1 - ny) / 2 });
      }
  if (points.length < 4) return null;
  const x = Math.max(0, Math.min(...points.map((p) => p.x))),
    y = Math.max(0, Math.min(...points.map((p) => p.y)));
  const right = Math.min(1, Math.max(...points.map((p) => p.x))),
    bottom = Math.min(1, Math.max(...points.map((p) => p.y)));
  return right > x && bottom > y ? [x, y, right - x, bottom - y] : null;
}

/**
 * Map a VLM box to an AR anchor on the floor plane using the captured pose.
 *
 * This is a pointing anchor, not measured geometry: the image ray tells us the
 * direction of the object, the scan floor gives us a plane to stop the ray. It
 * never changes footprints or clearances.
 */
export function boxFloorAnchor(
  box: SceneObject["box"],
  capture: SpatialCapture,
  allowFallback = true,
): WorldPoint | null {
  if (
    box.length !== 4 ||
    !box.every(Number.isFinite) ||
    capture.cameraWorld.length !== 16 ||
    capture.projection.length !== 16 ||
    ![...capture.cameraWorld, ...capture.projection, capture.floorY].every(
      Number.isFinite,
    )
  )
    return null;
  const camera = new Matrix4().fromArray(capture.cameraWorld);
  const projection = new Matrix4().fromArray(capture.projection);
  if (
    Math.abs(camera.determinant()) < 1e-8 ||
    Math.abs(projection.determinant()) < 1e-8
  )
    return null;
  const u = box[0] + box[2] / 2;
  const v = box[1] + box[3];
  const far = new Vector4(u * 2 - 1, 1 - v * 2, -1, 1).applyMatrix4(
    projection.clone().invert(),
  );
  if (Math.abs(far.w) < 1e-8) return null;
  far.multiplyScalar(1 / far.w).applyMatrix4(camera);
  const origin = {
    x: capture.cameraWorld[12],
    y: capture.cameraWorld[13],
    z: capture.cameraWorld[14],
  };
  const direction = {
    x: far.x - origin.x,
    y: far.y - origin.y,
    z: far.z - origin.z,
  };
  let distance: number | null = null;
  if (direction.y < -1e-6) {
    const t = (capture.floorY - origin.y) / direction.y;
    const horizontal = Math.hypot(direction.x * t, direction.z * t);
    if (t > 0 && horizontal <= 12) distance = t;
  }
  // A box above the horizon has no floor intersection. Keep the pointing
  // direction and stop two meters out instead of hiding the instruction.
  if (distance === null) {
    if (!allowFallback) return null;
    const horizontal = Math.hypot(direction.x, direction.z);
    if (horizontal > 1e-6) distance = 2 / horizontal;
    else return null;
  }
  return {
    x: origin.x + direction.x * distance,
    y: capture.floorY + 0.02,
    z: origin.z + direction.z * distance,
  };
}

/** Attach semantics to existing measured footprints. VLM boxes never create metric geometry. */
export function groundScene(
  room: Room,
  scene: ScenePlan,
  capture: SpatialCapture,
): { room: Room; bindings: Record<string, string>; unmatchedIds: string[] } {
  const bindings: Record<string, string> = {};
  const annotations = new Map<string, SceneObject>();
  const valid =
    [
      ...capture.cameraWorld,
      ...capture.projection,
      capture.floorY,
      capture.origin.x,
      capture.origin.y,
      capture.origin.z,
    ].every(Number.isFinite) &&
    capture.cameraWorld.length === 16 &&
    capture.projection.length === 16;
  if (valid) {
    const camera = new Matrix4().fromArray(capture.cameraWorld);
    if (Math.abs(camera.determinant()) > 1e-8) {
      const matrix = new Matrix4()
        .fromArray(capture.projection)
        .multiply(camera.invert());
      const candidates: Array<{
        object: SceneObject;
        obstacle: Obstacle;
        score: number;
      }> = [];
      for (const obstacle of room.obstacles) {
        if (obstacle.kind === "reserved") continue;
        const projected = projectedBox(obstacle, capture, matrix);
        if (!projected) continue;
        for (const object of scene.objects) {
          const box = object.box;
          if (
            box.length !== 4 ||
            !box.every(Number.isFinite) ||
            box[2] <= 0 ||
            box[3] <= 0 ||
            area(box) < area(projected) * 0.12
          )
            continue;
          const iou = overlap(projected, box),
            inside =
              contains(box, center(projected)) ||
              contains(projected, center(box));
          if (iou < 0.08 || !inside) continue;
          const a = center(projected),
            b = center(box),
            distance = Math.hypot(a.x - b.x, a.y - b.y);
          const score = iou * 0.8 + Math.max(0, 1 - distance / 0.4) * 0.2;
          if (score >= 0.18) candidates.push({ object, obstacle, score });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const used = new Set<string>();
      for (const candidate of candidates) {
        if (bindings[candidate.object.id] || used.has(candidate.obstacle.id))
          continue;
        const ambiguous = candidates.some(
          (other) =>
            other !== candidate &&
            other.object.id === candidate.object.id &&
            other.obstacle.id !== candidate.obstacle.id &&
            Math.abs(other.score - candidate.score) < 0.04,
        );
        if (ambiguous) continue;
        bindings[candidate.object.id] = candidate.obstacle.id;
        used.add(candidate.obstacle.id);
        annotations.set(candidate.obstacle.id, candidate.object);
      }
    }
  }
  // The VLM can repeat one detection under two IDs. Treat near-identical same-
  // class boxes as aliases; never manufacture a second measured object.
  for (const object of scene.objects) {
    if (bindings[object.id]) continue;
    const duplicate = scene.objects.find(
      (other) =>
        bindings[other.id] &&
        other.label.toLowerCase() === object.label.toLowerCase() &&
        overlap(other.box, object.box) > 0.9,
    );
    if (duplicate) {
      bindings[object.id] = bindings[duplicate.id];
      if (object.movable !== "likely") {
        const annotation = annotations.get(bindings[duplicate.id]);
        if (annotation)
          annotations.set(bindings[duplicate.id], {
            ...annotation,
            movable: "unknown",
          });
      }
    }
  }
  const obstacles = room.obstacles.map((obstacle) => {
    const object = annotations.get(obstacle.id);
    // A model's suggestion of portability is bounded, not a handling-safety claim.
    const movable =
      !!object &&
      object.movable === "likely" &&
      !/\b(sofa|couch|armchair|cabinet|wardrobe|bed|table|desk|shelf|shelving|refrigerator|stove|oven|washer|dryer|door|wall)\b/i.test(
        object.label,
      ) &&
      obstacle.kind !== "reserved" &&
      obstacle.width * obstacle.depth <= 0.75 &&
      Math.max(obstacle.width, obstacle.depth) <= 1.2;
    return { ...obstacle, label: object?.label || obstacle.label, movable };
  });
  return {
    room: { ...room, obstacles },
    bindings,
    unmatchedIds: scene.objects.filter((o) => !bindings[o.id]).map((o) => o.id),
  };
}

function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function clearPoint(room: Room, p: Point, radius = 0.5) {
  return (
    pointInPolygon(p, room.boundary) &&
    room.boundary.every(
      (a, i) =>
        segmentDistance(p, a, room.boundary[(i + 1) % room.boundary.length]) >=
        radius,
    ) &&
    room.obstacles.every((o) => {
      const dx = Math.max(o.x - p.x, 0, p.x - o.x - o.width),
        dy = Math.max(o.y - p.y, 0, p.y - o.y - o.depth);
      return Math.hypot(dx, dy) >= radius;
    })
  );
}
/** Choose an arrival point OUTSIDE the target footprint, with floor clearance. */
export function approachPoint(
  room: Room,
  obstacleId: string,
  cameraRoomPoint: Point = room.start,
): Point | null {
  const object = room.obstacles.find((o) => o.id === obstacleId);
  if (!object) return null;
  const candidates: Point[] = [];
  for (const distance of [0.58, 0.75, 1])
    for (const t of [0.15, 0.35, 0.5, 0.65, 0.85]) {
      candidates.push(
        { x: object.x - distance, y: object.y + object.depth * t },
        {
          x: object.x + object.width + distance,
          y: object.y + object.depth * t,
        },
        { x: object.x + object.width * t, y: object.y - distance },
        {
          x: object.x + object.width * t,
          y: object.y + object.depth + distance,
        },
      );
    }
  return (
    candidates
      .filter((p) => clearPoint(room, p))
      .sort(
        (a, b) =>
          Math.hypot(a.x - cameraRoomPoint.x, a.y - cameraRoomPoint.y) -
          Math.hypot(b.x - cameraRoomPoint.x, b.y - cameraRoomPoint.y),
      )[0] ?? null
  );
}
/** Snap the tracked camera position to clear observed floor, not a guessed room origin. */
export function scanStartPoint(
  room: Room,
  cameraRoomPoint: Point,
): Point | null {
  if (clearPoint(room, cameraRoomPoint)) return cameraRoomPoint;
  const xs = room.boundary.map((p) => p.x),
    ys = room.boundary.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  const step = Math.max(0.15, (maxX - minX) / 100, (maxY - minY) / 100);
  let best: Point | null = null,
    bestDistance = Infinity;
  for (let x = minX + 0.5; x < maxX - 0.5; x += step)
    for (let y = minY + 0.5; y < maxY - 0.5; y += step) {
      const distance = Math.hypot(x - cameraRoomPoint.x, y - cameraRoomPoint.y);
      if (distance < bestDistance && clearPoint(room, { x, y })) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  return best;
}

/** Project a visible doorway base onto the measured floor; never infer its depth. */
export function floorTargetPoint(
  room: Room,
  object: SceneObject,
  capture: SpatialCapture,
): Point | null {
  if (
    !/\b(door|doorway|entrance|exit)\b/i.test(object.label) ||
    /\b(cabinet|car|cupboard)\b/i.test(object.label)
  )
    return null;
  // A doorway must actually meet the floor. No pointing fallback here.
  const world = boxFloorAnchor(object.box, capture, false);
  if (!world) return null;
  const dx = world.x - capture.cameraWorld[12];
  const dz = world.z - capture.cameraWorld[14];
  const distance = Math.hypot(dx, dz);
  if (distance > 15) return null;
  const point = {
    x: world.x - capture.origin.x,
    y: world.z - capture.origin.z,
  };
  for (const backoff of [0, 0.55, 0.75, 1]) {
    const candidate = {
      x: point.x - (distance ? (dx / distance) * backoff : 0),
      y: point.y - (distance ? (dz / distance) * backoff : 0),
    };
    if (clearPoint(room, candidate)) return candidate;
  }
  return null;
}
