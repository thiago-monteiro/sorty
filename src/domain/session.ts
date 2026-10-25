import type { PlanStep, Room } from "./types";

/** A completion report changes the working model; it is never a fresh measurement. */
export function applyReportedMove(room: Room, step: PlanStep): Room {
  return {
    ...room,
    source: room.source === "sample" ? "sample" : "manual",
    obstacles: room.obstacles.map((o) =>
      o.id === step.obstacleId
        ? {
            ...o,
            x: step.to.x,
            y: step.to.y,
            source: o.source === "sample" ? "sample" : "manual",
          }
        : o,
    ),
  };
}

/** This is a user-excluded destination, not an automatically measured new object. */
export function excludeDestination(
  room: Room,
  step: PlanStep,
  id: string,
): Room {
  const object = room.obstacles.find((o) => o.id === step.obstacleId);
  if (!object) return room;
  return {
    ...room,
    source: room.source === "sample" ? "sample" : "manual",
    obstacles: [
      ...room.obstacles,
      {
        ...object,
        id,
        label: "Excluded destination",
        x: step.to.x,
        y: step.to.y,
        movable: false,
        kind: "reserved",
        source: "manual",
      },
    ],
  };
}
