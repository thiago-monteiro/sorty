import type { Obstacle, Point, Room } from "../domain/types";
import type { WorldPoint } from "./math";
export type { WorldPoint } from "./math";

export interface ScanSnapshot {
  floorY: number | null;
  points: WorldPoint[];
  floorPoints: WorldPoint[];
  elevatedPoints: WorldPoint[];
  boundary: Point[];
  obstacles: Obstacle[];
  area: number;
  samples: number;
  ready: boolean;
  hint: string;
  source: "planes" | "hits";
  origin: WorldPoint | null;
}
type Sample = {
  p: WorldPoint;
  time: number;
  plane: boolean;
  /** Identifies one detected plane polygon, so its vertices cluster together. */
  group: number;
  order: number;
};

const MAX_COORDINATE = 20;
const VOXEL = 0.1;
const MAX_POINTS = 10000;
const FLOOR_TOLERANCE = 0.08;
const HEIGHT_GAP = 0.12;
const MIN_FLOOR_SAMPLES = 6;
const MIN_FLOOR_AREA = 0.12;
const MIN_PLANE_FLOOR_SAMPLES = 3;
const MIN_PLANE_FLOOR_AREA = 0.5;
/** Ignore supported height clusters implausibly far from the bulk of the data. */
const MAX_FLOOR_OFFSET = 3.5;
const ELEVATED_MIN = 0.15;
const ELEVATED_MAX = 2;
const READY_AREA = 3;
const READY_OBSERVATIONS = 60;
const READY_CELLS = 12;
const READY_DURATION_MS = 2000;
const START_CLEARANCE = 0.5;
const OBSTACLE_CELL = 0.35;
const OBSTACLE_MIN_HITS = 4;
const OBSTACLE_MIN_PLANE_POINTS = 3;
const OBSTACLE_MIN_EXTENT = 0.15;
const OBSTACLE_PAD = 0.05;

const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function hull(points: Point[]): Point[] {
  const sorted = [
    ...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values(),
  ].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const half = (ps: Point[]) => {
    const out: Point[] = [];
    for (const p of ps) {
      while (
        out.length > 1 &&
        cross(out[out.length - 2], out[out.length - 1], p) <= 0
      )
        out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function areaOf(ps: Point[]): number {
  return (
    Math.abs(
      ps.reduce((sum, p, i) => {
        const q = ps[(i + 1) % ps.length];
        return sum + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2
  );
}

function contains(p: Point, boundary: Point[], clearance = 0): boolean {
  return (
    boundary.length >= 3 &&
    boundary.every((a, i) => {
      const b = boundary[(i + 1) % boundary.length];
      return (
        cross(a, b, p) >= clearance * Math.hypot(b.x - a.x, b.y - a.y) - 1e-8
      );
    })
  );
}

function rectOverlaps(a: Point[], b: Point[]): boolean {
  return (
    a[0].x <= b[1].x && a[1].x >= b[0].x && a[0].y <= b[1].y && a[1].y >= b[0].y
  );
}

function rectUnion(a: Point[], b: Point[]): Point[] {
  return [
    { x: Math.min(a[0].x, b[0].x), y: Math.min(a[0].y, b[0].y) },
    { x: Math.max(a[1].x, b[1].x), y: Math.max(a[1].y, b[1].y) },
  ];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function overlaps(a: Obstacle, b: Obstacle): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.depth &&
    a.y + a.depth > b.y
  );
}

/** Metric, bounded sensor aggregation. A hull is observed extent, never proof of a complete room. */
export class ScanAccumulator {
  private data = new Map<string, Sample>();
  private floor: number | null = null;
  /** World X/Z of the first stable floor observation. Y is updated when the floor is corrected. */
  private anchor: { x: number; z: number } | null = null;
  private cache: ScanSnapshot | null = null;
  private firstHitTime = Infinity;
  private lastHitTime = -Infinity;
  private firstPlaneTime = Infinity;
  private lastPlaneTime = -Infinity;
  private order = 0;
  private nextGroup = 0;

  clear(): void {
    this.data.clear();
    this.floor = null;
    this.anchor = null;
    this.cache = null;
    this.firstHitTime = Infinity;
    this.lastHitTime = -Infinity;
    this.firstPlaneTime = Infinity;
    this.lastPlaneTime = -Infinity;
    this.order = 0;
    this.nextGroup = 0;
  }

  /** planeGroup is null for ray hits; plane vertices share one group per detected polygon. */
  private insert(p: WorldPoint, time: number, planeGroup: number | null): void {
    if (
      ![p.x, p.y, p.z].every(
        (v) => Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE,
      )
    )
      return;
    const key = [p.x, p.y, p.z].map((v) => Math.round(v / VOXEL)).join(",");
    const existing = this.data.get(key);
    if (existing) {
      // A floor hit and a plane vertex can share a voxel. Prefer the plane evidence
      // so snapshot.source reflects that a detected surface contributed.
      if (planeGroup !== null && !existing.plane) {
        existing.plane = true;
        existing.group = planeGroup;
        this.cache = null;
      }
      return;
    }
    if (this.data.size >= MAX_POINTS) return;
    this.data.set(key, {
      p: { ...p },
      time,
      plane: planeGroup !== null,
      group: planeGroup ?? 0,
      order: this.order++,
    });
    this.cache = null;
  }

  addHit(p: WorldPoint, timestampMs: number): void {
    if (!Number.isFinite(timestampMs) || timestampMs < 0) return;
    const before = this.data.size;
    this.insert(p, timestampMs, null);
    if (this.data.size !== before) {
      this.firstHitTime = Math.min(this.firstHitTime, timestampMs);
      this.lastHitTime = Math.max(this.lastHitTime, timestampMs);
    }
  }

  addPlane(worldVertices: WorldPoint[], semanticLabel?: string): void {
    if (worldVertices.length < 3 || worldVertices.length > MAX_POINTS) return;
    const label = semanticLabel?.trim().toLowerCase();
    // Walls and ceilings are never floor or furniture evidence here.
    if (label === "wall" || label === "ceiling" || label === "roof") return;
    if (
      !worldVertices.every((p) =>
        [p.x, p.y, p.z].every(
          (v) => Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE,
        ),
      )
    )
      return;
    const ys = worldVertices.map((p) => p.y);
    if (Math.max(...ys) - Math.min(...ys) > FLOOR_TOLERANCE) return;
    const time = Date.now();
    const group = ++this.nextGroup;
    for (const p of worldVertices) this.insert(p, time, group);
    // Repeated detection of the same polygon is temporal evidence even when its
    // vertices dedupe, so always refresh the plane observation window.
    this.firstPlaneTime = Math.min(this.firstPlaneTime, time);
    this.lastPlaneTime = Math.max(this.lastPlaneTime, time);
    this.cache = null;
  }

  /**
   * Selects the lowest supported horizontal height cluster. A tabletop observed
   * before the floor is provisional: lower supported floor evidence replaces it.
   * Isolated low points never qualify because support needs both count and spread.
   */
  private estimateFloor(
    samples: Sample[],
  ): { y: number; first: Sample } | null {
    if (!samples.length) return null;
    const ordered = [...samples].sort((a, b) => a.p.y - b.p.y);
    const clusters: { samples: Sample[]; maxY: number }[] = [];
    for (const sample of ordered) {
      const last = clusters[clusters.length - 1];
      if (last && sample.p.y - last.maxY <= HEIGHT_GAP) {
        last.samples.push(sample);
        last.maxY = sample.p.y;
      } else {
        clusters.push({ samples: [sample], maxY: sample.p.y });
      }
    }
    const medianY = median(samples.map((s) => s.p.y));
    let best: { y: number; first: Sample } | null = null;
    for (const cluster of clusters) {
      const area = areaOf(
        hull(cluster.samples.map((s) => ({ x: s.p.x, y: s.p.z }))),
      );
      const planeCount = cluster.samples.filter((s) => s.plane).length;
      const supported =
        (cluster.samples.length >= MIN_FLOOR_SAMPLES &&
          area >= MIN_FLOOR_AREA) ||
        (planeCount >= MIN_PLANE_FLOOR_SAMPLES && area >= MIN_PLANE_FLOOR_AREA);
      if (!supported) continue;
      const y = median(cluster.samples.map((s) => s.p.y));
      if (Math.abs(y - medianY) > MAX_FLOOR_OFFSET) continue;
      if (best !== null && y >= best.y) continue;
      const first = cluster.samples.reduce((a, b) =>
        a.order <= b.order ? a : b,
      );
      best = { y, first };
    }
    return best;
  }

  private obstacleClusters(
    elevated: Sample[],
    boundary: Point[],
    local: (p: WorldPoint) => Point,
  ): { points: Point[]; plane: boolean }[] {
    const planes = new Map<number, Point[]>();
    const cells = new Map<string, Point[]>();
    for (const sample of elevated) {
      const q = local(sample.p);
      if (!contains(q, boundary, 0.1)) continue;
      if (sample.plane) {
        const list = planes.get(sample.group) ?? [];
        list.push(q);
        planes.set(sample.group, list);
      } else {
        const key = `${Math.floor(q.x / OBSTACLE_CELL)},${Math.floor(q.y / OBSTACLE_CELL)}`;
        const list = cells.get(key) ?? [];
        list.push(q);
        cells.set(key, list);
      }
    }
    const clusters: { points: Point[]; plane: boolean }[] = [
      ...[...planes.values()].map((points) => ({ points, plane: true })),
    ];
    while (cells.size) {
      const seed = cells.keys().next().value!;
      const queue = [seed];
      const points: Point[] = [];
      for (let i = 0; i < queue.length; i++) {
        const key = queue[i];
        const group = cells.get(key);
        if (!group) continue;
        cells.delete(key);
        points.push(...group);
        const [x, y] = key.split(",").map(Number);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            const next = `${x + dx},${y + dy}`;
            if (cells.has(next)) queue.push(next);
          }
      }
      clusters.push({ points, plane: false });
    }
    return clusters;
  }

  getSnapshot(): ScanSnapshot {
    if (this.cache) return this.cache;
    const samples = [...this.data.values()];
    const estimated = this.estimateFloor(samples);
    this.floor = estimated?.y ?? null;
    if (estimated && this.anchor === null)
      this.anchor = { x: estimated.first.p.x, z: estimated.first.p.z };
    const floorY = this.floor;
    const origin =
      this.anchor === null || floorY === null
        ? null
        : { x: this.anchor.x, y: floorY, z: this.anchor.z };
    const floorSamples =
      floorY === null
        ? []
        : samples.filter((s) => Math.abs(s.p.y - floorY) <= FLOOR_TOLERANCE);
    const elevated =
      floorY === null
        ? []
        : samples.filter(
            (s) =>
              s.p.y - floorY > ELEVATED_MIN && s.p.y - floorY < ELEVATED_MAX,
          );
    const local = (p: WorldPoint): Point =>
      origin === null
        ? { x: p.x, y: p.z }
        : { x: p.x - origin.x, y: p.z - origin.z };
    const boundary = hull(floorSamples.map((s) => local(s.p)));
    const area = areaOf(boundary);
    let obstacles: Obstacle[] = [];
    if (origin !== null && boundary.length >= 3) {
      const clusters = this.obstacleClusters(elevated, boundary, local);
      const rects: Point[][] = [];
      for (const cluster of clusters) {
        const minimum = cluster.plane
          ? OBSTACLE_MIN_PLANE_POINTS
          : OBSTACLE_MIN_HITS;
        if (cluster.points.length < minimum) continue;
        const xs = cluster.points.map((p) => p.x);
        const ys = cluster.points.map((p) => p.y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const width = Math.max(...xs) - x;
        const depth = Math.max(...ys) - y;
        if (width < OBSTACLE_MIN_EXTENT || depth < OBSTACLE_MIN_EXTENT)
          continue;
        rects.push([
          { x: x - OBSTACLE_PAD, y: y - OBSTACLE_PAD },
          {
            x: x + width + OBSTACLE_PAD,
            y: y + depth + OBSTACLE_PAD,
          },
        ]);
      }
      // Merge touching evidence so the planning engine never receives
      // overlapping footprints. A conservative union is safer than a gap.
      const merged: Point[][] = [];
      for (const rect of rects) {
        let next = rect;
        let changed = true;
        while (changed) {
          changed = false;
          for (let i = merged.length - 1; i >= 0; i--) {
            const other = merged[i];
            if (!rectOverlaps(next, other)) continue;
            next = rectUnion(next, other);
            merged.splice(i, 1);
            changed = true;
          }
        }
        merged.push(next);
      }
      obstacles = merged.flatMap(([a, b], rectIndex) => {
        const rect = {
          x: a.x,
          y: a.y,
          width: b.x - a.x,
          depth: b.y - a.y,
        };
        const corners: Point[] = [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.width, y: rect.y },
          { x: rect.x + rect.width, y: rect.y + rect.depth },
          { x: rect.x, y: rect.y + rect.depth },
        ];
        // Never emit a footprint outside the observed extent: the planner would
        // flag the whole room as uncertain instead of just this cluster.
        if (!corners.every((p) => contains(p, boundary))) return [];
        const id = `scan-object-${rectIndex + 1}`;
        return [
          {
            ...rect,
            id,
            label: `Object ${id.split("-").at(-1)}`,
            movable: false,
            kind: "furniture" as const,
            source: "webxr" as const,
          },
        ];
      });
      obstacles.forEach((o, i) => {
        o.id = `scan-object-${i + 1}`;
        o.label = `Object ${i + 1}`;
      });
    }
    const candidates = floorSamples
      .map((s) => local(s.p))
      .filter((p) => this.free(p, boundary, obstacles));
    const occupied = new Set(
      floorSamples.map(
        (s) => `${Math.floor(s.p.x / 0.5)},${Math.floor(s.p.z / 0.5)}`,
      ),
    );
    const duration = Math.max(
      this.lastHitTime - this.firstHitTime,
      this.lastPlaneTime - this.firstPlaneTime,
    );
    const farthest = (from: Point) =>
      candidates.reduce((best, p) =>
        Math.hypot(p.x - from.x, p.y - from.y) >
        Math.hypot(best.x - from.x, best.y - from.y)
          ? p
          : best,
      );
    const ready =
      floorY !== null &&
      origin !== null &&
      area >= READY_AREA &&
      floorSamples.length >= READY_OBSERVATIONS &&
      occupied.size >= READY_CELLS &&
      duration >= READY_DURATION_MS &&
      candidates.length >= 2 &&
      Math.hypot(
        farthest(candidates[0]).x - candidates[0].x,
        farthest(candidates[0]).y - candidates[0].y,
      ) >= 1;
    this.cache = {
      floorY,
      origin,
      points: samples.map((s) => s.p),
      floorPoints: floorSamples.map((s) => s.p),
      elevatedPoints: elevated.map((s) => s.p),
      boundary,
      obstacles,
      area,
      samples: samples.filter((s) => !s.plane).length,
      ready,
      source: floorSamples.some((s) => s.plane) ? "planes" : "hits",
      hint:
        floorY === null
          ? "Move slowly over the floor to establish its height."
          : ready
            ? "Observed area captured. Review the boundary and objects before planning."
            : "Keep moving to observe more floor area and clear interior space.",
    };
    return this.cache;
  }

  private free(p: Point, boundary: Point[], obstacles: Obstacle[]): boolean {
    return (
      contains(p, boundary, START_CLEARANCE) &&
      obstacles.every(
        (o) =>
          p.x < o.x - START_CLEARANCE ||
          p.x > o.x + o.width + START_CLEARANCE ||
          p.y < o.y - START_CLEARANCE ||
          p.y > o.y + o.depth + START_CLEARANCE,
      )
    );
  }

  buildRoom(): Room {
    const s = this.getSnapshot();
    if (!s.ready || !s.origin)
      throw new Error(
        "Scan needs a stable floor, at least 3 m² of observed area, 60 distinct observations over at least two seconds, and clear interior floor points.",
      );
    const candidates = s.floorPoints
      .map((p) => ({ x: p.x - s.origin!.x, y: p.z - s.origin!.z }))
      .filter((p) => this.free(p, s.boundary, s.obstacles));
    // Farthest observed floor points, never a centroid that may have no surface.
    // Two linear sweeps keep this bounded for 10,000 points.
    const farthest = (from: Point) =>
      candidates.reduce((best, p) =>
        Math.hypot(p.x - from.x, p.y - from.y) >
        Math.hypot(best.x - from.x, best.y - from.y)
          ? p
          : best,
      );
    const start = farthest(candidates[0]);
    const goal = farthest(start);
    return {
      id: `scan-${Date.now()}`,
      name: "Observed room area",
      boundary: s.boundary.map((p) => ({ ...p })),
      obstacles: s.obstacles.map((o) => ({ ...o })),
      start: { ...start },
      goal: { ...goal },
      source: "webxr",
      capturedAt: new Date().toISOString(),
      reviewed: false,
    };
  }
}
