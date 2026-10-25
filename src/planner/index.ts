import type {
  Obstacle,
  Plan,
  PlanStep,
  Point,
  Room,
  Settings,
} from "../domain/types";
import {
  assessRoom,
  bounds,
  circleClear,
  corners,
  distance,
  findRoute,
  overlaps,
  pointInPolygon,
  segmentClear,
} from "../geometry";
function placement(room: Room, o: Obstacle, s: Settings) {
  if (!corners(o, s.margin).every((p) => pointInPolygon(p, room.boundary)))
    return false;
  // Each edge must stay inside even for concave boundaries.
  const cs = corners(o, s.margin);
  const shell = { ...room, obstacles: [] };
  if (!cs.every((p, i) => segmentClear(shell, p, cs[(i + 1) % 4], 0.00001)))
    return false;
  if (room.obstacles.some((b) => b.id !== o.id && overlaps(o, b, s.margin)))
    return false;
  const protectedRadius = s.clearance / 2 + s.margin;
  return [room.start, room.goal].every(
    (p) =>
      Math.hypot(
        Math.max(o.x - p.x, 0, p.x - o.x - o.width),
        Math.max(o.y - p.y, 0, p.y - o.y - o.depth),
      ) > protectedRadius,
  );
}
function candidates(room: Room, o: Obstacle, s: Settings): Obstacle[] {
  const b = bounds(room),
    out: Obstacle[] = [];
  const xs = [b.minX + s.margin + 0.02, b.maxX - o.width - s.margin - 0.02],
    ys = [b.minY + s.margin + 0.02, b.maxY - o.depth - s.margin - 0.02];
  for (let x = b.minX + 0.1; x + o.width < b.maxX; x += 0.6) xs.push(x);
  for (let y = b.minY + 0.1; y + o.depth < b.maxY; y += 0.6) ys.push(y);
  for (const x of xs)
    for (const y of ys) {
      const p = { ...o, x, y };
      if (distance(o, p) > 0.1 && placement(room, p, s)) out.push(p);
    }
  return out.sort((a, b) => distance(o, a) - distance(o, b)).slice(0, 48);
}
/** Axis-aligned swept footprint checks at every edge of an object-center grid path. */
export function translationPath(
  room: Room,
  o: Obstacle,
  to: Obstacle,
  s: Settings,
  deadline: number,
): Point[] {
  const others = room.obstacles.filter((b) => b.id !== o.id);
  const edge = (a: Point, b: Point) => {
    const swept = {
      ...o,
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: o.width + Math.abs(a.x - b.x),
      depth: o.depth + Math.abs(a.y - b.y),
    };
    const cs = corners(swept, s.margin);
    return (
      cs.every((p) => pointInPolygon(p, room.boundary)) &&
      cs.every((p, i) =>
        segmentClear({ ...room, obstacles: [] }, p, cs[(i + 1) % 4], 0.00001),
      ) &&
      !others.some((b) => overlaps(swept, b, s.margin))
    );
  };
  if (edge(o, to))
    return [
      { x: o.x, y: o.y },
      { x: to.x, y: to.y },
    ];
  const b = bounds(room),
    step = 0.2,
    nx = Math.ceil((b.maxX - b.minX) / step) + 1,
    ny = Math.ceil((b.maxY - b.minY) / step) + 1;
  if (!Number.isFinite(nx * ny) || nx * ny > 10000) return [];
  const queue: Point[] = [o],
    parents: number[] = [-1],
    seen = new Set<string>();
  const finish = (index: number) => {
    const path: Point[] = [{ x: to.x, y: to.y }];
    for (let i = index; i >= 0; i = parents[i])
      path.push({ x: queue[i].x, y: queue[i].y });
    path.reverse();
    const smooth: Point[] = [path[0]];
    for (let i = 0; i < path.length - 1;) {
      let j = path.length - 1;
      while (j > i + 1 && !edge(path[i], path[j])) j--;
      smooth.push(path[j]);
      i = j;
    }
    return smooth;
  };
  for (let q = 0; q < queue.length && q < 2500 && Date.now() < deadline; q++) {
    const p = queue[q];
    if (distance(p, to) < step * 1.6 && edge(p, to)) return finish(q);
    const seeds =
      q === 0
        ? Array.from({ length: 9 }, (_, i) => ({
            x:
              b.minX + (Math.round((p.x - b.minX) / step) + (i % 3) - 1) * step,
            y:
              b.minY +
              (Math.round((p.y - b.minY) / step) + Math.floor(i / 3) - 1) *
                step,
          }))
        : [
            { x: p.x - step, y: p.y },
            { x: p.x + step, y: p.y },
            { x: p.x, y: p.y - step },
            { x: p.x, y: p.y + step },
          ];
    for (const n of seeds) {
      const key = `${n.x.toFixed(4)},${n.y.toFixed(4)}`;
      if (
        !seen.has(key) &&
        n.x >= b.minX &&
        n.y >= b.minY &&
        n.x <= b.maxX &&
        n.y <= b.maxY &&
        edge(p, n)
      ) {
        seen.add(key);
        queue.push(n);
        parents.push(q);
      }
    }
  }
  return [];
}
export function solveRoom(room: Room, settings: Settings): Plan {
  const started = Date.now(),
    deadline = started + 2200,
    before = assessRoom(room, settings);
  let searchedStates = 0;
  const result = (
    status: Plan["status"],
    afterRoom: Room,
    steps: PlanStep[],
    reason: string,
  ): Plan => ({
    status,
    before,
    after: steps.length ? assessRoom(afterRoom, settings) : before,
    roomAfter: afterRoom,
    steps,
    searchedStates,
    elapsedMs: Date.now() - started,
    reason,
  });
  if (before.uncertain)
    return result(
      "unsolved",
      room,
      [],
      "Review the room and complete missing measurements before planning; unknown floor space is not available for placement.",
    );
  const doorOkay =
    settings.checkDoorway === false ||
    (room.doorwayWidth !== undefined &&
      room.doorwayWidth >= 0.8128 + 2 * settings.margin);
  if (!doorOkay)
    return result(
      "unsolved",
      room,
      [],
      "The separate doorway check needs adjustment or re-measurement. Furniture relocation cannot change the measured opening.",
    );
  const good = (r: Room) =>
    (!settings.requireTurning ||
      circleClear(r, r.goal, settings.turningDiameter / 2 + settings.margin)) &&
    findRoute(r, settings.clearance, settings.margin).length > 0;
  if (before.routeClear && (!settings.requireTurning || before.turningClear))
    return result(
      "clear",
      room,
      [],
      "Selected spatial checks met in the measured model.",
    );
  const movable = room.obstacles
    .filter((o) => o.movable && o.kind !== "reserved")
    .slice(0, 8);
  type State = { room: Room; steps: PlanStep[]; cost: number };
  let frontier: State[] = [{ room, steps: [], cost: 0 }];
  for (let depth = 1; depth <= 2; depth++) {
    const next: State[] = [];
    let best: State | undefined;
    search: for (const state of frontier)
      for (const original of movable) {
        if (Date.now() > deadline || searchedStates >= 500) break search;
        if (state.steps.some((s) => s.obstacleId === original.id)) continue;
        const o = state.room.obstacles.find((b) => b.id === original.id)!;
        for (const to of candidates(state.room, o, settings)) {
          if (Date.now() > deadline || searchedStates >= 500) break search;
          searchedStates++;
          const changed = {
            ...state.room,
            obstacles: state.room.obstacles.map((b) =>
              b.id === o.id ? to : b,
            ),
          };
          const feasible = good(changed);
          // Limit expensive manipulation checks to useful final layouts or a small two-move beam.
          if (!feasible && (depth === 2 || next.length >= 20)) continue;
          const movementPath = translationPath(
            state.room,
            o,
            to,
            settings,
            deadline,
          );
          if (!movementPath.length) continue;
          const dx = to.x - o.x,
            dy = to.y - o.y;
          const displacement = `${Math.abs(dx).toFixed(2)} m in ${dx >= 0 ? "positive" : "negative"} scan X and ${Math.abs(dy).toFixed(2)} m in ${dy >= 0 ? "positive" : "negative"} scan Y, relative to the scan origin`;
          const step: PlanStep = {
            id: `move-${depth}-${o.id}`,
            obstacleId: o.id,
            label: o.label,
            from: { x: o.x, y: o.y },
            to: { x: to.x, y: to.y },
            distance: movementPath
              .slice(1)
              .reduce((sum, p, i) => sum + distance(movementPath[i], p), 0),
            movementPath,
            instruction: `Move ${o.label} by ${displacement}. ${movementPath.length > 2 ? "Follow the highlighted path around furniture to the target; do not move directly between endpoints." : "Follow the highlighted straight path to the target."} Keep its orientation; check handling space and get help if needed.`,
            status: "pending",
          };
          const candidate = {
            room: changed,
            steps: [...state.steps, step],
            cost: state.cost + step.distance,
          };
          if (feasible) {
            if (!best || candidate.cost < best.cost) best = candidate;
          } else next.push(candidate);
        }
      }
    if (best)
      return result(
        "ready",
        best.room,
        best.steps,
        "Best plan found: selected route and turning checks met. Object translation is collision-free in the floor model; handling and lifting still need user review. Re-measure after moving.",
      );
    if (Date.now() > deadline || searchedStates >= 500) break;
    frontier = next.sort((a, b) => a.cost - b.cost).slice(0, 20);
  }
  return result(
    "unsolved",
    room,
    [],
    "No validated plan found within the time and two-object search limits. Fixed/reserved objects, narrow passages, or unvalidated manipulation paths may require manual help or a new measurement.",
  );
}
