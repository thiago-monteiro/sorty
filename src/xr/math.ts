import type { Point } from "../domain/types";
export type WorldPoint = { x: number; y: number; z: number };
export type FloorBasis = { origin: WorldPoint; ux: number; uz: number };
export function makeBasis(origin: WorldPoint, axis: WorldPoint): FloorBasis {
  const distance = Math.hypot(axis.x - origin.x, axis.z - origin.z);
  if (!Number.isFinite(distance) || distance < 0.25)
    throw new Error("Place the axis point at least 25 cm from the origin.");
  return {
    origin,
    ux: (axis.x - origin.x) / distance,
    uz: (axis.z - origin.z) / distance,
  };
}
export function toFloor(p: WorldPoint, b: FloorBasis): Point {
  const x = p.x - b.origin.x,
    z = p.z - b.origin.z;
  return { x: x * b.ux + z * b.uz, y: -x * b.uz + z * b.ux };
}
export function toWorld(p: Point, b: FloorBasis): WorldPoint {
  return {
    x: b.origin.x + p.x * b.ux - p.y * b.uz,
    y: b.origin.y,
    z: b.origin.z + p.x * b.uz + p.y * b.ux,
  };
}
export function rectangle(a: Point, b: Point) {
  const result = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    depth: Math.abs(a.y - b.y),
  };
  if (
    ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
    result.width < 0.1 ||
    result.depth < 0.1
  )
    throw new Error("Both rectangle dimensions must be at least 10 cm.");
  return result;
}
export function corners(r: {
  x: number;
  y: number;
  width: number;
  depth: number;
}): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.depth },
    { x: r.x, y: r.y + r.depth },
  ];
}
export function inside(p: Point, boundary: Point[]): boolean {
  return (
    boundary.length >= 4 &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= Math.min(...boundary.map((v) => v.x)) &&
    p.x <= Math.max(...boundary.map((v) => v.x)) &&
    p.y >= Math.min(...boundary.map((v) => v.y)) &&
    p.y <= Math.max(...boundary.map((v) => v.y))
  );
}
export function horizontalFloor(matrix: ArrayLike<number>): boolean {
  return Number.isFinite(matrix[5]) && matrix[5] >= Math.cos(Math.PI / 12);
}

/** Horizontal distance between projected floor hits. */
export function floorDistance(a: Point, b: Point): number {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  if (!Number.isFinite(distance) || distance < 0.1)
    throw new Error("Place doorway edges at least 10 cm apart on the floor.");
  return distance;
}
