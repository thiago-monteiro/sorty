/** All room coordinates and dimensions are in meters, on a horizontal floor plane. */
export type Point = { x: number; y: number };
export type Source = "sample" | "webxr" | "manual";
export type Obstacle = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  movable: boolean;
  kind: "furniture" | "clutter" | "reserved";
  source: Source;
};
export type Room = {
  id: string;
  name: string;
  boundary: Point[];
  obstacles: Obstacle[];
  start: Point;
  goal: Point;
  source: Source;
  capturedAt: string;
  reviewed: boolean;
  doorwayWidth?: number;
};
export type Settings = {
  /** Doorway is a separate optional assessment, not required for automatic surface capture. */
  checkDoorway?: boolean;
  clearance: number;
  turningDiameter: number;
  margin: number;
  requireTurning: boolean;
};
export const DEFAULT_SETTINGS: Settings = {
  clearance: 0.9144,
  turningDiameter: 1.524,
  margin: 0.025,
  requireTurning: true,
};
export type Assessment = {
  routeClear: boolean;
  turningClear: boolean;
  path: Point[];
  bottleneck: number;
  issues: string[];
  turnCenter: Point;
  uncertain: boolean;
};
export type StepStatus = "pending" | "reported" | "verified";
export type PlanStep = {
  id: string;
  obstacleId: string;
  label: string;
  from: Point;
  to: Point;
  distance: number;
  /** Collision-checked positions of the footprint corner along the relocation. */
  movementPath?: Point[];
  instruction: string;
  status: StepStatus;
};
export type Plan = {
  status: "ready" | "clear" | "unsolved";
  before: Assessment;
  after: Assessment;
  steps: PlanStep[];
  roomAfter: Room;
  searchedStates: number;
  elapsedMs: number;
  reason: string;
};
export type VoiceCommand =
  | "next"
  | "repeat"
  | "back"
  | "pause"
  | "resume"
  | "blocked"
  | "immovable"
  | "check"
  | "remeasure"
  | "help"
  | "unknown";
