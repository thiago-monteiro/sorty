import type {
  Assessment,
  Obstacle,
  Point,
  Room,
  Settings,
} from "../domain/types";
const EPS = 1e-8;
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export function pointSegment(p: Point, a: Point, b: Point): number {
  const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = d
    ? Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / d,
        ),
      )
    : 0;
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j],
      b = poly[i];
    if (pointSegment(p, a, b) < EPS) return true;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function intersects(a: Point, b: Point, c: Point, d: Point) {
  if (
    Math.max(a.x, b.x) + EPS < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) + EPS < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) + EPS < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) + EPS < Math.min(a.y, b.y)
  )
    return false;
  return (
    cross(a, b, c) * cross(a, b, d) <= EPS &&
    cross(c, d, a) * cross(c, d, b) <= EPS
  );
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  return intersects(a, b, c, d)
    ? 0
    : Math.min(
        pointSegment(a, c, d),
        pointSegment(b, c, d),
        pointSegment(c, a, b),
        pointSegment(d, a, b),
      );
}
export function corners(o: Obstacle, pad = 0): Point[] {
  return [
    { x: o.x - pad, y: o.y - pad },
    { x: o.x + o.width + pad, y: o.y - pad },
    { x: o.x + o.width + pad, y: o.y + o.depth + pad },
    { x: o.x - pad, y: o.y + o.depth + pad },
  ];
}
export function overlaps(a: Obstacle, b: Obstacle, pad = 0) {
  return (
    a.x < b.x + b.width + pad - EPS &&
    a.x + a.width + pad > b.x + EPS &&
    a.y < b.y + b.depth + pad - EPS &&
    a.y + a.depth + pad > b.y + EPS
  );
}
export function circleClear(room: Room, p: Point, r: number): boolean {
  if (!pointInPolygon(p, room.boundary)) return false;
  for (let i = 0; i < room.boundary.length; i++)
    if (
      pointSegment(
        p,
        room.boundary[i],
        room.boundary[(i + 1) % room.boundary.length],
      ) <
      r - EPS
    )
      return false;
  return room.obstacles.every(
    (o) =>
      Math.hypot(
        Math.max(o.x - p.x, 0, p.x - o.x - o.width),
        Math.max(o.y - p.y, 0, p.y - o.y - o.depth),
      ) >=
      r - EPS,
  );
}
export function segmentClear(
  room: Room,
  a: Point,
  b: Point,
  r: number,
): boolean {
  if (!pointInPolygon(a, room.boundary) || !pointInPolygon(b, room.boundary))
    return false;
  for (let i = 0; i < room.boundary.length; i++)
    if (
      segmentDistance(
        a,
        b,
        room.boundary[i],
        room.boundary[(i + 1) % room.boundary.length],
      ) <
      r - EPS
    )
      return false;
  for (const o of room.obstacles) {
    const cs = corners(o, r);
    if (pointInPolygon(a, cs) || pointInPolygon(b, cs)) return false;
    for (let i = 0; i < 4; i++)
      if (intersects(a, b, cs[i], cs[(i + 1) % 4])) return false;
  }
  return true;
}
export function bounds(room: Room) {
  return {
    minX: Math.min(...room.boundary.map((p) => p.x)),
    maxX: Math.max(...room.boundary.map((p) => p.x)),
    minY: Math.min(...room.boundary.map((p) => p.y)),
    maxY: Math.max(...room.boundary.map((p) => p.y)),
  };
}
/** Four-neighbor grid with exact segment checks; no diagonal corner cutting. */
export function findRoute(room: Room, width: number, margin: number): Point[] {
  const r = width / 2 + margin;
  if (
    !segmentClear(room, room.start, room.start, r) ||
    !segmentClear(room, room.goal, room.goal, r)
  )
    return [];
  if (segmentClear(room, room.start, room.goal, r))
    return [room.start, room.goal];
  const box = bounds(room),
    step = 0.12,
    nx = Math.ceil((box.maxX - box.minX) / step) + 1,
    ny = Math.ceil((box.maxY - box.minY) / step) + 1;
  if (!Number.isFinite(nx * ny) || nx * ny > 30000) return [];
  const points: Point[] = [];
  const valid: boolean[] = [];
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const p = { x: box.minX + x * step, y: box.minY + y * step };
      points.push(p);
      valid.push(segmentClear(room, p, p, r));
    }
  const parents = new Int32Array(points.length).fill(-2),
    queue: number[] = [];
  for (let i = 0; i < points.length; i++)
    if (
      valid[i] &&
      distance(points[i], room.start) <= step * 2 &&
      segmentClear(room, room.start, points[i], r)
    ) {
      parents[i] = -1;
      queue.push(i);
    }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q],
      p = points[i];
    if (
      distance(p, room.goal) <= step * 2 &&
      segmentClear(room, p, room.goal, r)
    ) {
      const path: Point[] = [room.goal];
      let j = i;
      while (j >= 0) {
        path.push(points[j]);
        j = parents[j];
      }
      path.push(room.start);
      return path.reverse();
    }
    for (const j of [
      i % nx > 0 ? i - 1 : -1,
      i % nx < nx - 1 ? i + 1 : -1,
      i - nx,
      i + nx,
    ])
      if (
        j >= 0 &&
        j < points.length &&
        parents[j] === -2 &&
        valid[j] &&
        segmentClear(room, p, points[j], r)
      ) {
        parents[j] = i;
        queue.push(j);
      }
  }
  return [];
}
export function validationIssues(room: Room, settings: Settings): string[] {
  const issues: string[] = [];
  const finite = (p: Point) =>
    !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (
    !room ||
    !Array.isArray(room.boundary) ||
    !Array.isArray(room.obstacles) ||
    !settings
  )
    return ["Room data is invalid."];
  if (room.boundary.length > 256)
    return ["Room boundary exceeds the supported vertex limit."];
  if (
    room.boundary.length < 3 ||
    !Array.from(room.boundary).every(finite) ||
    !finite(room.start) ||
    !finite(room.goal)
  )
    return ["Room boundary or route points are invalid."];
  const extent = bounds(room);
  if (
    extent.maxX - extent.minX > 100 ||
    extent.maxY - extent.minY > 100 ||
    room.obstacles.length > 256
  )
    return ["Room exceeds the supported planning size."];
  if (Array.from(room.obstacles).some((o) => !o))
    return ["Obstacle data is invalid."];
  let area = 0;
  for (let i = 0; i < room.boundary.length; i++) {
    const a = room.boundary[i],
      b = room.boundary[(i + 1) % room.boundary.length];
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 2; j < room.boundary.length; j++)
      if (
        (j + 1) % room.boundary.length !== i &&
        intersects(
          a,
          b,
          room.boundary[j],
          room.boundary[(j + 1) % room.boundary.length],
        )
      )
        issues.push("Room boundary crosses itself.");
  }
  if (Math.abs(area) < EPS) issues.push("Room boundary has no area.");
  if (
    ![settings.clearance, settings.turningDiameter, settings.margin].every(
      Number.isFinite,
    ) ||
    settings.clearance <= 0 ||
    settings.turningDiameter <= 0 ||
    settings.margin < 0
  )
    issues.push("Clearance settings are invalid.");
  if (
    room.obstacles.some(
      (o) =>
        ![o.x, o.y, o.width, o.depth].every(Number.isFinite) ||
        o.width <= 0 ||
        o.depth <= 0,
    )
  )
    issues.push("Obstacle dimensions are invalid.");
  if (
    !issues.length &&
    room.obstacles.some(
      (o) =>
        !corners(o).every((p) => pointInPolygon(p, room.boundary)) ||
        !corners(o).every((p, i, cs) =>
          segmentClear(
            { ...room, obstacles: [] },
            p,
            cs[(i + 1) % 4],
            0.000001,
          ),
        ),
    )
  )
    issues.push("An obstacle footprint extends outside the measured boundary.");
  if (
    room.obstacles.some((o, i) =>
      room.obstacles.slice(i + 1).some((b) => overlaps(o, b)),
    )
  )
    issues.push("Obstacle footprints overlap; review the measured layout.");
  if (new Set(room.obstacles.map((o) => o.id)).size !== room.obstacles.length)
    issues.push("Obstacle identifiers must be unique.");
  if (
    room.doorwayWidth !== undefined &&
    (!Number.isFinite(room.doorwayWidth) || room.doorwayWidth <= 0)
  )
    issues.push("Doorway measurement is invalid.");
  if (
    !pointInPolygon(room.start, room.boundary) ||
    !pointInPolygon(room.goal, room.boundary)
  )
    issues.push("Route endpoints must be inside the room.");
  return [...new Set(issues)];
}
export function assessRoom(room: Room, settings: Settings): Assessment {
  const issues = validationIssues(room, settings);
  if (issues.length)
    return {
      routeClear: false,
      turningClear: false,
      path: [],
      bottleneck: 0,
      issues,
      turnCenter: room.goal,
      uncertain: true,
    };
  const path = findRoute(room, settings.clearance, settings.margin);
  const turningClear = circleClear(
    room,
    room.goal,
    settings.turningDiameter / 2 + settings.margin,
  );
  const box = bounds(room);
  let low = 0,
    high = Math.min(box.maxX - box.minX, box.maxY - box.minY);
  for (let i = 0; i < 8; i++) {
    const mid = (low + high) / 2;
    if (findRoute(room, mid, 0).length) low = mid;
    else high = mid;
  }
  if (!path.length)
    issues.push(
      "No route found at the selected width plus measurement margin.",
    );
  if (settings.requireTurning && !turningClear)
    issues.push(
      "The turning circle at the destination intersects furniture or the room boundary.",
    );
  if (
    room.doorwayWidth !== undefined &&
    room.doorwayWidth < 0.8128 + 2 * settings.margin
  )
    issues.push(
      "Doorway clear opening is below the separate 32 inch reference plus measurement margin; re-measure or adjust.",
    );
  if (room.doorwayWidth === undefined)
    issues.push(
      "Doorway clear opening has not been measured; doorway check not assessed.",
    );
  if (!room.reviewed)
    issues.push(
      "Room is unreviewed; unknown or uncaptured areas cannot be assumed clear.",
    );
  return {
    routeClear: !!path.length,
    turningClear,
    path,
    bottleneck: low,
    issues,
    turnCenter: room.goal,
    uncertain:
      !room.reviewed ||
      (settings.checkDoorway !== false && room.doorwayWidth === undefined),
  };
}
