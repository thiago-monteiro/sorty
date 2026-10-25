import { Vector3, type Camera } from "three";
import type { WorldPoint } from "./math";

export type ScreenMarker = {
  x: number;
  y: number;
  onScreen: boolean;
  angle: number;
};

/** World-anchored position, or an edge cue pointing toward an off-screen point. */
export function projectMarker(
  point: WorldPoint,
  camera: Camera,
  width: number,
  height: number,
): ScreenMarker | null {
  if (width <= 0 || height <= 0) return null;
  const world = new Vector3(point.x, point.y, point.z);
  const view = world.clone().applyMatrix4(camera.matrixWorldInverse);
  const clip = world.project(camera);
  if (![clip.x, clip.y, clip.z, view.x, view.y, view.z].every(Number.isFinite))
    return null;
  const front = view.z < -0.01;
  const onScreen =
    front &&
    clip.z >= -1 &&
    clip.z <= 1 &&
    Math.abs(clip.x) < 0.9 &&
    Math.abs(clip.y) < 0.78;
  if (onScreen)
    return {
      x: ((clip.x + 1) * width) / 2,
      y: ((1 - clip.y) * height) / 2,
      onScreen: true,
      angle: 0,
    };
  let dx = front ? (clip.x * width) / 2 : view.x * width;
  let dy = front ? (-clip.y * height) / 2 : -view.y * height;
  if (!front && Math.abs(dx) < 0.01) {
    dx = width;
    dy = 0;
  }
  const boundX = Math.max(1, width / 2 - 40),
    boundY = Math.max(1, height / 2 - 140);
  const extent = Math.min(
    boundX / Math.max(Math.abs(dx), 0.0001),
    boundY / Math.max(Math.abs(dy), 0.0001),
  );
  return {
    x: width / 2 + dx * extent,
    y: height / 2 + dy * extent,
    onScreen: false,
    angle: Math.atan2(dy, dx),
  };
}

export function directionArrow(angle: number): string {
  return ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"][
    (Math.round(angle / (Math.PI / 4)) + 8) % 8
  ];
}
