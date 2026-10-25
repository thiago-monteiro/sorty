import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  Camera,
  ChevronLeft,
  LoaderCircle,
  Mic,
  MicOff,
  RotateCcw,
  Smartphone,
  X,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  type Obstacle,
  type Plan,
  type PlanStep,
  type Point,
  type Room,
  type VoiceCommand,
} from "../domain/types";
import { applyReportedMove, excludeDestination } from "../domain/session";
import { solveRoomAsync } from "../planner/client";
import { parseCommand } from "../guidance/commands";
import useVoice from "../guidance/useVoice";
import type { ScenePlan } from "../scene/types";
import { ScanAccumulator } from "./scan";
import type { ScanSnapshot, WorldPoint } from "./scan";
import { directionArrow, projectMarker } from "./projection";
import { createXRCameraCapture } from "./camera";
import {
  approachPoint,
  boxFloorAnchor,
  groundScene,
  scanStartPoint,
  floorTargetPoint,
  type SpatialCapture,
} from "./grounding";
import "./xr.css";

type Props = {
  mode: "scan" | "preview" | "verify";
  room?: Room;
  plan?: Plan;
  onComplete: (room: Room) => void;
  onClose: () => void;
  onDemo?: () => void;
  onPhone?: () => void;
  onAssistant?: () => void;
};

/** Parent owns the API shape; these fields arrive with ScenePlan. */
type IntentPlan = ScenePlan & {
  intent?: "route" | "task";
  navigationTargetId?: string;
};
type Shot = {
  image: string;
  width: number;
  height: number;
  cameraWorld: number[];
  projection: number[];
  capturedAt: number;
  roomPoint: Point;
};
type Grounded = {
  room: Room;
  bindings: Record<string, string>;
  unmatchedIds: string[];
};
type Phase = "intro" | "scanning" | "review" | "planning" | "guide" | "done";
type Frame = { origin: WorldPoint; floorY: number };
type Tone = "floor" | "object" | "fixed" | "movable" | "target" | "step";
type Label = {
  key: string;
  text: string;
  world: WorldPoint;
  tone: Tone;
  obstacleId?: string;
};
type ViewApi = {
  showScan: () => void;
  showReview: (room: Room) => void;
  showPlan: (plan: Plan, room: Room, index: number) => void;
  showTask?: (
    scene: IntentPlan,
    room: Room,
    bindings: Record<string, string>,
    stepIndex: number,
  ) => void;
  clearPlan: () => void;
  clear: () => void;
};
type DetectedPlane = {
  planeSpace: XRSpace;
  polygon: ReadonlyArray<{ x: number; y: number; z: number }>;
  semanticLabel?: string;
};

/** Planning profile: a route through the observed hull, without a manual door point. */
const PROFILE = {
  ...DEFAULT_SETTINGS,
  checkDoorway: false,
  requireTurning: false,
};
const WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const letter = (index: number) => LETTERS[index] ?? String(index + 1);
const word = (index: number) => WORDS[index] ?? String(index + 1);
const roomToWorld = (p: Point, frame: Frame, lift = 0.02): WorldPoint => ({
  x: frame.origin.x + p.x,
  y: frame.floorY + lift,
  z: frame.origin.z + p.y,
});
const center = (o: Obstacle): Point => ({
  x: o.x + o.width / 2,
  y: o.y + o.depth / 2,
});
const centroid = (points: Point[]): Point =>
  points.length
    ? {
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
      }
    : { x: 0, y: 0 };

function scanLabels(snapshot: ScanSnapshot): Label[] {
  if (!snapshot.origin || snapshot.floorY === null) return [];
  const frame: Frame = { origin: snapshot.origin, floorY: snapshot.floorY };
  const labels: Label[] = [
    {
      key: "floor",
      text: "Floor",
      world: roomToWorld(centroid(snapshot.boundary), frame, 0.012),
      tone: "floor",
    },
  ];
  snapshot.obstacles.forEach((o, i) =>
    labels.push({
      key: o.id,
      text: letter(i),
      world: roomToWorld(center(o), frame, 0.24),
      tone: "object",
    }),
  );
  return labels;
}

function roomLabels(room: Room, frame: Frame): Label[] {
  return room.obstacles.map((o, i) => ({
    key: o.id,
    text: letter(i),
    world: roomToWorld(center(o), frame, 0.24),
    tone: o.movable ? "movable" : "fixed",
    obstacleId: o.id,
  }));
}

function line(points: WorldPoint[], color: number, opacity = 0.9): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    ),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}
function loop(
  points: WorldPoint[],
  color: number,
  opacity = 0.9,
): THREE.LineLoop {
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    ),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}
/** Keep arrowheads sparse; the floor line keeps every measured vertex. */
function spaced(points: WorldPoint[], min: number): WorldPoint[] {
  if (points.length < 2) return points;
  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    if (Math.hypot(points[i].x - last.x, points[i].z - last.z) >= min) {
      out.push(points[i]);
      last = points[i];
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
function addCones(
  group: THREE.Group,
  points: WorldPoint[],
  color: number,
): void {
  const marks = spaced(points, 0.75);
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i],
      b = marks[i + 1];
    const dx = b.x - a.x,
      dz = b.z - a.z,
      length = Math.hypot(dx, dz);
    if (length < 0.05) continue;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.045, 0.14, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    cone.position.set((a.x + b.x) / 2, a.y + 0.05, (a.z + b.z) / 2);
    cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx / length, 0, dz / length),
    );
    group.add(cone);
  }
}
function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const holder = child as THREE.Mesh;
    holder.geometry?.dispose();
    const material = holder.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    disposeObject(child);
    group.remove(child);
  }
}

export default function XRWorkspace({
  mode,
  onComplete,
  onClose,
  onDemo,
  onPhone,
  onAssistant,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const accumulator = useRef(new ScanAccumulator());
  const dispose = useRef<() => void>(() => {});
  const mounted = useRef(true);
  const frame = useRef<Frame | null>(null);
  const view = useRef<ViewApi | null>(null);
  const labelsRef = useRef<Label[]>([]);
  const labelEls = useRef(new Map<string, HTMLElement>());
  const taskPose = useRef<SpatialCapture | null>(null);
  const phaseRef = useRef<Phase>("intro");
  const scanHint = useRef("");
  const autoUnderstand = useRef(false);
  const busy = useRef(false);
  const startingRef = useRef(false);
  const planGeneration = useRef(0);
  const trackingOk = useRef(false);
  const request = useRef<AbortController | null>(null);
  const advancing = useRef(false);
  const captureShot = useRef<() => Promise<Shot | null>>(async () => null);
  const rawText = useRef<(text: string) => void>(() => {});
  const [trackingReady, setTrackingReady] = useState(false);
  const command = useRef<(value: VoiceCommand) => void>(() => {});

  const [phase, setPhase] = useState<Phase>("intro");
  const [snapshot, setSnapshot] = useState<ScanSnapshot>(() =>
    accumulator.current.getSnapshot(),
  );
  const [room, setRoom] = useState<Room | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [task, setTask] = useState<IntentPlan | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [labels, setLabels] = useState<Label[]>([]);
  const [goal, setGoal] = useState("");
  const [followup, setFollowup] = useState("");
  const [question, setQuestion] = useState("");
  const [cameraAccess, setCameraAccess] = useState<boolean | null>(null);
  const [cue, setCue] = useState(
    mode === "scan"
      ? "Move slowly. Look toward the floor."
      : "Scan again to register this space.",
  );
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [fatal, setFatal] = useState("");
  const [paused, setPaused] = useState(false);
  const voice = useVoice((text) => rawText.current(text));
  phaseRef.current = phase;

  const updateLabels = (next: Label[]) => {
    labelsRef.current = next;
    if (mounted.current) setLabels(next);
  };

  useEffect(() => {
    mounted.current = true;
    if (!window.isSecureContext || !navigator.xr) {
      setSupported(false);
      setFatal("Camera scanning needs a phone over HTTPS.");
    } else {
      void navigator.xr
        .isSessionSupported("immersive-ar")
        .then((ok) => {
          if (!mounted.current) return;
          setSupported(ok);
          if (!ok) setFatal("Camera scanning is unavailable on this device.");
        })
        .catch(() => {
          if (!mounted.current) return;
          setSupported(false);
          setFatal("Camera scanning is unavailable in this browser.");
        });
    }
    return () => {
      mounted.current = false;
      dispose.current();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    if (phase === "scanning") view.current?.showScan();
    else if (phase === "review" && room) view.current?.showReview(room);
    else if ((phase === "guide" || phase === "done") && task && room)
      view.current?.showTask?.(task, room, bindings, index);
    else if (phase === "guide" && plan && room)
      view.current?.showPlan(plan, room, index);
    else if (phase === "done" && plan && room)
      view.current?.showPlan(plan, room, -1);
  }, [active, phase, room, plan, task, bindings, index]);

  function resetScan() {
    autoUnderstand.current = false;
    scanHint.current = "";
    voice.silence();
    request.current?.abort();
    request.current = null;
    planGeneration.current++;
    busy.current = false;
    accumulator.current.clear();
    frame.current = null;
    setSnapshot(accumulator.current.getSnapshot());
    setRoom(null);
    setPlan(null);
    setTask(null);
    setBindings({});
    setFollowup("");
    setQuestion("");
    setIndex(0);
    setPaused(false);
    updateLabels([]);
    view.current?.clear();
    if (active) view.current?.showScan();
    setPhase(active ? "scanning" : "intro");
    setCue("Move slowly. Look toward the floor.");
  }

  function toReview() {
    scanHint.current = "";
    const next = accumulator.current.getSnapshot();
    if (!next.ready || !next.origin || next.floorY === null) return;
    try {
      const built = accumulator.current.buildRoom();
      const labelled: Room = {
        ...built,
        reviewed: false,
        obstacles: built.obstacles.map((o, i) => ({
          ...o,
          label: letter(i),
          movable: false,
        })),
      };
      frame.current = { origin: next.origin, floorY: next.floorY };
      setRoom(labelled);
      setPlan(null);
      setTask(null);
      setBindings({});
      setIndex(0);
      setPaused(false);
      setPhase("review");
      autoUnderstand.current = !!goal.trim();
      setCue(
        cameraAccess === false
          ? "Object understanding needs camera access."
          : goal.trim()
            ? "Review the scan. Understand when ready."
            : "Say or type your goal.",
      );
      view.current?.showReview(labelled);
    } catch {
      setCue("Scan a little more.");
    }
  }

  useEffect(() => {
    if (
      phase === "review" &&
      room &&
      autoUnderstand.current &&
      goal.trim() &&
      cameraAccess === true
    ) {
      autoUnderstand.current = false;
      void understand(goal);
    }
  }, [phase, room, goal, cameraAccess]);

  function scanMore(message: string) {
    voice.silence();
    scanHint.current = message;
    setPlan(null);
    setTask(null);
    setRoom(null);
    setBindings({});
    setQuestion("");
    frame.current = null;
    setPhase("scanning");
    setCue(message);
    view.current?.showScan();
    if (voice.enabled) voice.speak(message);
  }

  async function runPlan(scene: Room) {
    if (busy.current) return;
    busy.current = true;
    const generation = ++planGeneration.current;
    voice.silence();
    setPaused(false);
    setPlan(null);
    setIndex(0);
    setPhase("planning");
    setCue("Finding a path.");
    updateLabels([]);
    view.current?.clearPlan();
    try {
      // Same XR session and reference frame: no new origin, no manual door point.
      const result = await solveRoomAsync(
        { ...scene, reviewed: true },
        PROFILE,
      );
      if (!mounted.current || generation !== planGeneration.current) return;
      setPlan(result);
      if (result.steps.length) {
        const first = result.steps[0];
        setPhase("guide");
        setIndex(0);
        setCue(`Move ${first.label} to point one.`);
        if (voice.enabled) voice.speak(narration(first, 0));
      } else {
        setPhase("done");
        setCue(
          result.status === "clear"
            ? "Route clear in this scan."
            : "No clear path.",
        );
        if (voice.enabled)
          voice.speak(
            result.status === "clear"
              ? "Route clear in this scan. Check with another scan."
              : "No clear path. Check with another scan.",
          );
      }
    } catch {
      if (mounted.current && generation === planGeneration.current) {
        setPhase("done");
        setCue("Could not plan.");
      }
    } finally {
      if (generation === planGeneration.current) busy.current = false;
    }
  }

  async function understand(
    text = goal,
    previous?: {
      summary: string;
      steps: ScenePlan["steps"];
      currentStep: number;
    },
    shot?: Shot,
  ) {
    const nextGoal = text.trim();
    if (!nextGoal) {
      setCue("Say or type your goal.");
      return;
    }
    if (busy.current || !room || !frame.current) return;
    if (cameraAccess === false) {
      setCue("Object understanding needs camera access.");
      return;
    }
    if (!trackingOk.current) {
      setCue("Hold steady. Tracking was lost.");
      return;
    }
    busy.current = true;
    const generation = ++planGeneration.current;
    request.current?.abort();
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 100000);
    request.current = controller;
    const spatial = frame.current;
    voice.silence();
    setPaused(false);
    setPlan(null);
    setTask(null);
    taskPose.current = null;
    setBindings({});
    setFollowup("");
    setQuestion("");
    setIndex(0);
    updateLabels([]);
    view.current?.clearPlan();
    setPhase("planning");
    setCue(
      previous ? "Checking the current step." : "Understanding the scene.",
    );
    try {
      const picture = shot ?? (await captureShot.current());
      if (!mounted.current || generation !== planGeneration.current) return;
      if (!picture) {
        if (!trackingOk.current) {
          setPhase("review");
          setCue("Hold steady. Tracking was lost.");
          return;
        }
        setCameraAccess(false);
        setPhase("review");
        setCue("Camera access is unavailable. Use the camera assistant.");
        return;
      }
      const response = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          image: picture.image,
          goal: nextGoal.slice(0, 500),
          client: "xr",
          ...(previous ? { previous } : {}),
        }),
      });
      const result = (await response.json()) as IntentPlan;
      if (!response.ok) throw new Error("Scene understanding unavailable.");
      if (!mounted.current || generation !== planGeneration.current) return;
      if (!Array.isArray(result.steps) || typeof result.summary !== "string")
        throw new Error("The model did not return a usable plan.");
      // The VLM sees this exact frame; this pose anchors its boxes for AR.
      const capture: SpatialCapture = {
        cameraWorld: picture.cameraWorld,
        projection: picture.projection,
        origin: spatial.origin,
        floorY: spatial.floorY,
      };
      const grounded: Grounded = groundScene(room, result, capture);
      taskPose.current = capture;
      const intent = result.intent ?? "task";
      const snapped = scanStartPoint(grounded.room, picture.roomPoint);
      // Route starts on observed clear floor. A task only needs the existing start.
      const start =
        intent === "route" ? snapped : (snapped ?? grounded.room.start);
      if (!start) {
        setRoom({ ...grounded.room, reviewed: false });
        setBindings(grounded.bindings);
        setPhase("review");
        setCue(
          `${result.steps[0]?.instruction ?? result.summary} Scan more clear floor, then understand again.`,
        );
        return;
      }
      const nextRoom: Room = {
        ...grounded.room,
        ...(start ? { start } : {}),
        reviewed: true,
      };
      setRoom(nextRoom);
      setBindings(grounded.bindings);
      setQuestion(result.question ?? "");
      if (result.status === "needs_input" || result.question) {
        setTask(result);
        setPhase("review");
        const ask = result.question || "Can you tell me a little more?";
        setCue(ask);
        if (voice.enabled) voice.speak(ask);
        return;
      }
      if (intent === "route") {
        const missing = result.objects.find(
          (object) =>
            !grounded.bindings[object.id] &&
            !/\b(floor|wall|ceiling|window|door|picture|frame|hand|arm)\b/i.test(
              object.label,
            ),
        );
        if (missing) {
          scanMore(
            `${result.steps[0]?.instruction ?? result.summary} Scan around the ${missing.label}.`,
          );
          return;
        }
        // Never fall back to a stale endpoint when the named target is not measured.
        const target = result.navigationTargetId
          ? grounded.bindings[result.navigationTargetId]
          : undefined;
        const targetObject = result.objects.find(
          (object) => object.id === result.navigationTargetId,
        );
        const approach = target
          ? approachPoint(nextRoom, target, start)
          : targetObject
            ? floorTargetPoint(nextRoom, targetObject, capture)
            : null;
        if (result.navigationTargetId && !approach) {
          scanMore(
            `${result.steps[0]?.instruction ?? result.summary} Scan around the destination.`,
          );
          return;
        }
        setTask(null);
        setQuestion("");
        busy.current = false;
        const defaultGoal =
          Math.hypot(nextRoom.goal.x - start.x, nextRoom.goal.y - start.y) >
          Math.hypot(
            grounded.room.start.x - start.x,
            grounded.room.start.y - start.y,
          )
            ? nextRoom.goal
            : grounded.room.start;
        const destination = approach || defaultGoal;
        if (
          Math.hypot(destination.x - start.x, destination.y - start.y) < 0.5
        ) {
          scanMore("Scan a little farther ahead.");
          return;
        }
        await runPlan({ ...nextRoom, goal: destination });
        return;
      }
      setTask(result);
      const step = result.steps[0];
      if (!step) {
        setPhase("done");
        setCue(result.summary);
        if (voice.enabled) voice.speak(result.summary);
        return;
      }
      setIndex(0);
      setPhase("guide");
      setCue(step.instruction);
      if (voice.enabled) voice.speak(step.instruction);
      view.current?.showTask?.(result, nextRoom, grounded.bindings, 0);
    } catch (cause) {
      if (mounted.current && generation === planGeneration.current) {
        setPhase("review");
        setCue(
          controller.signal.aborted
            ? "Understanding stopped."
            : cause instanceof Error
              ? cause.message
              : "Scene understanding unavailable.",
        );
      }
    } finally {
      window.clearTimeout(requestTimeout);
      if (request.current === controller) request.current = null;
      if (generation === planGeneration.current) busy.current = false;
    }
  }

  /** Capture a fresh view and let the VLM verify or correct the current steps. */
  async function checkTask() {
    if (!task || !room || busy.current) return;
    if (paused || advancing.current) return;
    if (!trackingOk.current) {
      setCue("Hold steady.");
      return;
    }
    advancing.current = true;
    try {
      const currentTask = task;
      const picture = await captureShot.current();
      if (!mounted.current) return;
      if (!picture) {
        if (!trackingOk.current) {
          setCue("Hold steady. Tracking was lost.");
          return;
        }
        setCameraAccess(false);
        setCue("Camera access is unavailable. Use the camera assistant.");
        return;
      }
      // A fresh frame is required: never reuse the previous understanding photo.
      const goalText = followup.trim()
        ? `${goal || currentTask.summary}. Follow-up: ${followup.trim()}`
        : goal || currentTask.summary;
      await understand(
        goalText,
        {
          summary: currentTask.summary,
          steps: currentTask.steps,
          // Done means every step was reported; during guidance the steps
          // before the current one are the reported ones.
          currentStep:
            phase === "done" ? currentTask.steps.length : Math.min(index, currentTask.steps.length),
        },
        picture,
      );
    } finally {
      advancing.current = false;
    }
  }

  function narration(step: PlanStep, stepIndex: number) {
    return `Move ${step.label} to point ${word(stepIndex)}. Follow the arrow.`;
  }

  function reportDone() {
    if (phase !== "guide") return;
    if (task) {
      if (paused || advancing.current) return;
      // The VLM returns a short ordered set. Flip through it locally with the
      // button or voice; only an explicit check spends another inference.
      if (index + 1 < task.steps.length) {
        const next = task.steps[index + 1];
        setIndex(index + 1);
        setCue(next.instruction);
        if (voice.enabled) voice.speak(next.instruction);
        return;
      }
      setPhase("done");
      setCue("Steps done. Check the result, or scan again.");
      if (voice.enabled) voice.speak("Steps done. Check the result, or scan again.");
      return;
    }
    if (!plan || !room || paused) return;
    if (!trackingOk.current) {
      setCue("Hold steady.");
      return;
    }
    const step = plan.steps[index];
    if (!step) return;
    const nextRoom = applyReportedMove(room, step);
    const steps = plan.steps.map((s) =>
      s.id === step.id ? { ...s, status: "reported" as const } : s,
    );
    setRoom(nextRoom);
    setPlan({ ...plan, steps });
    const nextIndex = index + 1;
    if (nextIndex < steps.length) {
      const next = steps[nextIndex];
      setIndex(nextIndex);
      setCue(`Move ${next.label} to point ${word(nextIndex)}.`);
      if (voice.enabled) voice.speak(narration(next, nextIndex));
    } else {
      setPhase("done");
      setCue("Moves reported.");
      if (voice.enabled)
        voice.speak("Moves reported. Check with another scan.");
    }
  }

  function resume() {
    if (phase !== "guide") return;
    setPaused(false);
    if (task) {
      const step = task.steps[index];
      setCue(step?.instruction || task.summary);
      if (voice.enabled) voice.speak(step?.instruction || task.summary);
      return;
    }
    const step = plan?.steps[index];
    if (step) {
      setCue(`Move ${step.label} to point ${word(index)}.`);
      if (voice.enabled) voice.speak(narration(step, index));
    }
  }

  function pause() {
    voice.silence();
    setPaused(true);
    setCue("Paused.");
  }

  function toggleVoice() {
    if (!voice.supported) return;
    if (!voice.enabled) {
      voice.toggle();
      const step = plan?.steps[index];
      if (phase === "guide" && step) voice.speak(narration(step, index));
      else if (phase === "guide" && task)
        voice.speak(task.steps[index]?.instruction || task.summary);
      else if (phase === "review") voice.speak("Ready to understand.");
    } else {
      voice.toggle();
    }
  }

  function close() {
    voice.silence();
    const current = room;
    dispose.current();
    if (current) onComplete(current);
    onClose();
  }

  command.current = (value) => {
    if (value === "pause") {
      if (phase === "guide") pause();
      return;
    }
    if (value === "resume") {
      resume();
      return;
    }
    if (value === "next") {
      reportDone();
      return;
    }
    if (value === "repeat") {
      const step = plan?.steps[index];
      if (phase === "guide" && step) voice.speak(narration(step, index));
      else if (phase === "guide" && task)
        voice.speak(task.steps[index]?.instruction || task.summary);
      return;
    }
    if (value === "remeasure") {
      resetScan();
    }
  };

  // Whisper text is also free-form: a goal before scanning, or a follow-up while guiding.
  rawText.current = (text) => {
    const raw = text.trim().slice(0, 500);
    if (!raw) return;
    const parsed = parseCommand(raw);
    if (
      (parsed === "blocked" || parsed === "immovable") &&
      phase === "guide" &&
      !busy.current
    ) {
      if (task) {
        void understand(`${goal}. User update: ${raw}`, {
          summary: task.summary,
          steps: task.steps,
          currentStep: index,
        });
        return;
      }
      const step = plan?.steps[index];
      if (room && step) {
        const corrected =
          parsed === "immovable"
            ? {
                ...room,
                obstacles: room.obstacles.map((o) =>
                  o.id === step.obstacleId ? { ...o, movable: false } : o,
                ),
              }
            : excludeDestination(room, step, crypto.randomUUID());
        setRoom(corrected);
        void runPlan(corrected);
      }
      return;
    }
    if (parsed === "check") {
      if (task && room && !busy.current)
        void understand(goal, {
          summary: task.summary,
          steps: task.steps,
          currentStep: index,
        });
      else if (active && !busy.current) resetScan();
      return;
    }
    if (parsed === "pause") {
      if (phase === "guide") pause();
      return;
    }
    if (parsed === "resume") {
      if (phase === "guide") resume();
      return;
    }
    if (parsed === "repeat") {
      command.current("repeat");
      return;
    }
    if (parsed === "remeasure") {
      resetScan();
      return;
    }
    if (parsed === "next") {
      if (phase === "scanning") {
        if (snapshot.ready) toReview();
        else setCue("Keep scanning a little longer.");
        return;
      }
      if (phase === "review") {
        void understand(goal || followup);
        return;
      }
      if (phase === "guide") {
        reportDone();
        return;
      }
    }
    if (phase === "intro" || phase === "scanning" || phase === "review") {
      // Free-form goal, even when it contains a command word like "done".
      if (question && phase === "review") {
        const clarified = `${goal}. Clarification: ${raw}`.slice(0, 500);
        setGoal(clarified);
        setQuestion("");
        void understand(clarified);
      } else {
        setGoal(raw);
        // Speaking the goal is the whole interaction in review; asking for a
        // second tap is what made the mic look broken.
        if (phase === "review" && room) {
          setCue("Understanding the scene.");
          void understand(raw);
        } else setCue("Goal set. Understand when ready.");
      }
      return;
    }
    if (phase === "guide" && task) {
      setFollowup(raw);
      setCue("Follow-up noted.");
    }
  };

  async function start() {
    if (!navigator.xr || startingRef.current) return;
    startingRef.current = true;
    planGeneration.current++;
    busy.current = false;
    setStarting(true);
    setFatal("");
    accumulator.current.clear();
    frame.current = null;
    setSnapshot(accumulator.current.getSnapshot());
    setRoom(null);
    setPlan(null);
    setTask(null);
    setBindings({});
    setFollowup("");
    setQuestion("");
    setIndex(0);
    setPaused(false);
    updateLabels([]);

    let xr: XRSession | undefined;
    let captureTool: ReturnType<typeof createXRCameraCapture> | null = null;
    let renderer: THREE.WebGLRenderer | undefined;
    const sources: XRHitTestSource[] = [];
    const listeners: (() => void)[] = [];
    const scene = new THREE.Scene();
    const scanGroup = new THREE.Group();
    const scanExtras = new THREE.Group();
    const planGroup = new THREE.Group();
    scanGroup.add(scanExtras);
    scene.add(scanGroup, planGroup);
    let scanVisible = true,
      planVisible = false;

    const cloudGeometry = new THREE.BufferGeometry();
    const cloudMaterial = new THREE.PointsMaterial({
      color: 0xbafa82,
      size: 0.035,
      sizeAttenuation: true,
    });
    const cloud = new THREE.Points(cloudGeometry, cloudMaterial);
    cloud.frustumCulled = false;
    scanGroup.add(cloud);
    let hull: THREE.LineLoop | null = null;
    let grid: THREE.GridHelper | null = null;

    let cleaned = false;
    let pendingShot: {
      resolve: (shot: Shot | null) => void;
      timer: number;
    } | null = null;
    const finishShot = (shot: Shot | null) => {
      if (!pendingShot) return;
      window.clearTimeout(pendingShot.timer);
      const resolve = pendingShot.resolve;
      pendingShot = null;
      resolve(shot);
    };
    captureShot.current = () =>
      new Promise<Shot | null>((resolve) => {
        finishShot(null);
        if (!captureTool) {
          resolve(null);
          return;
        }
        const timer = window.setTimeout(() => finishShot(null), 3000);
        pendingShot = { resolve, timer };
      });
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      planGeneration.current++;
      busy.current = false;
      trackingOk.current = false;
      request.current?.abort();
      request.current = null;
      finishShot(null);
      captureShot.current = async () => null;
      voice.silence();
      captureTool?.dispose();
      captureTool = null;
      sources.forEach((source) => source.cancel());
      listeners.forEach((remove) => remove());
      renderer?.setAnimationLoop(null);
      clearGroup(planGroup);
      clearGroup(scanGroup);
      cloudGeometry.dispose();
      cloudMaterial.dispose();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer?.domElement.remove();
      labelsRef.current = [];
      labelEls.current.clear();
      view.current = null;
      if (mounted.current) {
        setTrackingReady(false);
        setActive(false);
        setStarting(false);
        setPhase("intro");
        setLabels([]);
      }
      startingRef.current = false;
    };
    dispose.current = () => {
      void xr?.end().catch(() => {});
      cleanup();
    };

    try {
      // The session request stays directly inside the Start scan user gesture.
      xr = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: [
          "dom-overlay",
          "plane-detection",
          "depth-sensing",
          "camera-access",
        ],
        domOverlay: { root: root.current! },
        depthSensing: {
          usagePreference: ["cpu-optimized"],
          dataFormatPreference: ["float32", "luminance-alpha"],
          depthTypePreference: ["smooth", "raw"],
        },
      } as XRSessionInit);
      if (cleaned || !mounted.current) {
        await xr.end();
        return;
      }
      // Without the DOM overlay there is no honest way to run this workflow.
      if (!xr.domOverlayState) {
        await xr.end().catch(() => {});
        throw new Error("Controls unavailable");
      }
      xr.addEventListener("end", cleanup, { once: true });
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setClearColor(0x000000, 0);
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType("local");
      host.current!.appendChild(renderer.domElement);
      const r = renderer;
      await r.xr.setSession(xr);
      if (cleaned) return;
      const reference = r.xr.getReferenceSpace();
      if (!reference) throw new Error("Local tracking is unavailable.");
      const gl = r.getContext();
      if (
        typeof WebGL2RenderingContext !== "undefined" &&
        gl instanceof WebGL2RenderingContext
      ) {
        try {
          captureTool = createXRCameraCapture(gl);
        } catch {
          captureTool = null;
        }
      }
      const granted = (xr as XRSession & { enabledFeatures?: string[] })
        .enabledFeatures;
      setCameraAccess(
        !!captureTool && (granted ? granted.includes("camera-access") : true),
      );
      const viewer = await xr.requestReferenceSpace("viewer");
      if (cleaned) return;
      if (!xr.requestHitTestSource)
        throw new Error("Surface measurements are unavailable.");
      for (const x of [-0.35, 0, 0.35])
        for (const y of [-0.35, 0, 0.35]) {
          const source = await xr.requestHitTestSource({
            space: viewer,
            offsetRay: new XRRay(
              { x: 0, y: 0, z: 0, w: 1 },
              { x, y, z: -1, w: 0 },
            ),
          });
          if (cleaned) {
            source?.cancel();
            return;
          }
          if (source) sources.push(source);
        }
      if (!sources.length)
        throw new Error("Surface measurements are unavailable.");

      let cueHoldUntil = 0;
      const onReset = () => {
        // A tracking reset invalidates every stored spatial position; keep the
        // session and offer a fresh measurement in the same frame.
        planGeneration.current++;
        busy.current = false;
        request.current?.abort();
        request.current = null;
        finishShot(null);
        voice.silence();
        accumulator.current.clear();
        frame.current = null;
        setSnapshot(accumulator.current.getSnapshot());
        setRoom(null);
        setPlan(null);
        setTask(null);
        setBindings({});
        setFollowup("");
        setQuestion("");
        setIndex(0);
        setPaused(false);
        updateLabels([]);
        view.current?.clear();
        view.current?.showScan();
        setPhase("scanning");
        setCue("Tracking reset. Scan again.");
        cueHoldUntil = performance.now() + 2500;
      };
      reference.addEventListener("reset", onReset);
      listeners.push(() => reference.removeEventListener("reset", onReset));

      const beforeSelect = (event: Event) => event.preventDefault();
      const overlayRoot = root.current!;
      overlayRoot.addEventListener("beforexrselect", beforeSelect);
      listeners.push(() =>
        overlayRoot.removeEventListener("beforexrselect", beforeSelect),
      );
      const resize = () => r.setSize(window.innerWidth, window.innerHeight);
      window.addEventListener("resize", resize);
      listeners.push(() => window.removeEventListener("resize", resize));

      const camera = new THREE.PerspectiveCamera();
      const projectLabels = () => {
        const trackedCamera = r.xr.getCamera();
        const xrCamera = trackedCamera.cameras[0] || trackedCamera;
        const width = r.domElement.clientWidth || window.innerWidth;
        const height = r.domElement.clientHeight || window.innerHeight;
        for (const label of labelsRef.current) {
          const node = labelEls.current.get(label.key);
          if (!node) continue;
          const marker = projectMarker(label.world, xrCamera, width, height);
          const edgeCue =
            !!marker &&
            !marker.onScreen &&
            phaseRef.current === "guide" &&
            (label.tone === "target" ||
              label.tone === "object" ||
              label.tone === "step");
          const visible = !!marker && (marker.onScreen || edgeCue);
          node.style.opacity = visible ? "1" : "0";
          node.style.visibility = visible ? "visible" : "hidden";
          node.dataset.edge = String(edgeCue);
          node.textContent = edgeCue
            ? `${
                label.tone === "step"
                  ? label.text.split(" ")[0]
                  : label.text
              } ${directionArrow(marker!.angle)}`
            : label.text;
          if (visible && marker)
            node.style.transform = `translate3d(${marker.x}px, ${marker.y}px, 0) translate(-50%, -50%)`;
        }
      };

      const updateScan = (next: ScanSnapshot) => {
        const positions = next.points.flatMap((p) => [p.x, p.y + 0.008, p.z]);
        cloudGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        if (hull) {
          scanExtras.remove(hull);
          hull.geometry.dispose();
          (hull.material as THREE.Material).dispose();
          hull = null;
        }
        if (next.origin && next.floorY !== null && next.boundary.length > 2) {
          const current: Frame = { origin: next.origin, floorY: next.floorY };
          hull = loop(
            next.boundary.map((p) => roomToWorld(p, current, 0.012)),
            0xbfe89a,
            0.8,
          );
          scanExtras.add(hull);
        }
        if (!grid && next.origin && next.floorY !== null) {
          grid = new THREE.GridHelper(12, 24, 0x6d8f7d, 0x40574a);
          grid.position.set(next.origin.x, next.floorY + 0.002, next.origin.z);
          scanExtras.add(grid);
        }
        updateLabels(scanLabels(next));
      };

      const clearScanExtras = () => {
        clearGroup(scanExtras);
        hull = null;
        grid = null;
      };

      const api: ViewApi = {
        showScan: () => {
          scanVisible = true;
          planVisible = false;
          clearGroup(planGroup);
          updateScan(accumulator.current.getSnapshot());
        },
        showReview: (reviewed: Room) => {
          const current = frame.current;
          if (!current) return;
          scanVisible = false;
          planVisible = true;
          clearGroup(planGroup);
          if (reviewed.boundary.length > 2)
            planGroup.add(
              loop(
                reviewed.boundary.map((p) => roomToWorld(p, current, 0.012)),
                0xbfe89a,
                0.85,
              ),
            );
          reviewed.obstacles.forEach((o) => {
            const corners = [
              { x: o.x, y: o.y },
              { x: o.x + o.width, y: o.y },
              { x: o.x + o.width, y: o.y + o.depth },
              { x: o.x, y: o.y + o.depth },
            ];
            planGroup.add(
              loop(
                corners.map((p) => roomToWorld(p, current, 0.016)),
                o.movable ? 0xf0b45e : 0x9db8a6,
                0.95,
              ),
            );
          });
          updateLabels(roomLabels(reviewed, current));
        },
        showTask: (taskScene, working, map, stepIndex) => {
          const current = frame.current;
          if (!current) return;
          scanVisible = false;
          planVisible = true;
          clearGroup(planGroup);
          const step = taskScene.steps[stepIndex];
          const capture = taskPose.current;
          const activeObject = step?.targetId
            ? taskScene.objects.find((object) => object.id === step.targetId)
            : undefined;
          // Put the active target first so it wins when two boxes share one
          // measured footprint.
          const ordered = activeObject
            ? [
                activeObject,
                ...taskScene.objects.filter(
                  (object) => object !== activeObject,
                ),
              ]
            : taskScene.objects;
          const nextLabels: Label[] = [];
          const shown = new Set<string>();
          for (const object of ordered) {
            const obstacleId = map[object.id];
            const obstacle = obstacleId
              ? working.obstacles.find((candidate) => candidate.id === obstacleId)
              : undefined;
            // A measured footprint is the authoritative metric anchor. An
            // unmatched VLM box still gets a pointing anchor from its image ray
            // to the captured floor plane; it never changes dimensions.
            const anchor = obstacle
              ? roomToWorld(center(obstacle), current, 0.02)
              : capture
                ? boxFloorAnchor(object.box, capture)
                : null;
            if (!anchor) continue;
            const duplicate = !!obstacleId && shown.has(obstacleId);
            if (obstacleId) shown.add(obstacleId);
            if (duplicate) continue;
            const active = object.id === activeObject?.id;
            const ring = new THREE.Mesh(
              new THREE.RingGeometry(
                active ? 0.17 : 0.09,
                active ? 0.23 : 0.13,
                32,
              ),
              new THREE.MeshBasicMaterial({
                color: active ? 0xf0b45e : 0xd2f78e,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: active ? 0.95 : 0.6,
              }),
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(anchor.x, anchor.y, anchor.z);
            planGroup.add(ring);
            nextLabels.push({
              key: object.id,
              text:
                active && step
                  ? `${stepIndex + 1}/${taskScene.steps.length} ${step.instruction}`
                  : object.label,
              world: { ...anchor, y: anchor.y + (active ? 0.3 : 0.2) },
              tone: active ? "step" : "object",
              obstacleId,
            });
          }
          updateLabels(nextLabels);
        },
        showPlan: (activePlan, working, stepIndex) => {
          const current = frame.current;
          if (!current) return;
          scanVisible = false;
          planVisible = true;
          clearGroup(planGroup);
          if (activePlan.after.path.length > 1) {
            const path = activePlan.after.path.map((p) =>
              roomToWorld(p, current, 0.018),
            );
            planGroup.add(line(path, 0xd5fa69, 0.95));
            addCones(planGroup, path, 0xd5fa69);
          }
          const nextLabels: Label[] = [];
          const step = stepIndex >= 0 ? activePlan.steps[stepIndex] : undefined;
          if (step) {
            const object = working.obstacles.find(
              (o) => o.id === step.obstacleId,
            );
            const width = object?.width ?? 0.3;
            const depth = object?.depth ?? 0.3;
            const movement = step.movementPath?.length
              ? step.movementPath
              : [step.from, step.to];
            const moved = movement.map((p) =>
              roomToWorld(
                { x: p.x + width / 2, y: p.y + depth / 2 },
                current,
                0.024,
              ),
            );
            planGroup.add(line(moved, 0xf0b45e, 0.95));
            addCones(planGroup, moved, 0xf0b45e);
            const from = [
              { x: step.from.x, y: step.from.y },
              { x: step.from.x + width, y: step.from.y },
              { x: step.from.x + width, y: step.from.y + depth },
              { x: step.from.x, y: step.from.y + depth },
            ].map((p) => roomToWorld(p, current, 0.02));
            planGroup.add(loop(from, 0xf0b45e, 0.9));
            const target = roomToWorld(
              { x: step.to.x + width / 2, y: step.to.y + depth / 2 },
              current,
              0.02,
            );
            const ring = new THREE.Mesh(
              new THREE.RingGeometry(0.18, 0.24, 32),
              new THREE.MeshBasicMaterial({
                color: 0xf0b45e,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.95,
              }),
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(target.x, target.y, target.z);
            planGroup.add(ring);
            nextLabels.push({
              key: "object",
              text: object?.label ?? step.label,
              world: roomToWorld(
                { x: step.from.x + width / 2, y: step.from.y + depth / 2 },
                current,
                0.24,
              ),
              tone: "object",
            });
            nextLabels.push({
              key: "target",
              text: String(stepIndex + 1),
              world: { ...target, y: target.y + 0.03 },
              tone: "target",
            });
          }
          updateLabels(nextLabels);
        },
        clearPlan: () => {
          clearGroup(planGroup);
          planVisible = false;
          updateLabels([]);
        },
        clear: () => {
          clearGroup(planGroup);
          clearScanExtras();
          scanVisible = false;
          planVisible = false;
          updateLabels([]);
        },
      };
      view.current = api;
      updateScan(accumulator.current.getSnapshot());

      let lastCapture = -Infinity,
        lastScan = -Infinity;
      r.setAnimationLoop((time, frameData) => {
        if (!frameData || cleaned) return;
        const pose = frameData.getViewerPose(reference);
        const tracking =
          !!pose && !pose.emulatedPosition && xr?.visibilityState === "visible";
        if (tracking !== trackingOk.current) {
          trackingOk.current = tracking;
          setTrackingReady(tracking);
          if (!tracking) {
            voice.silence();
            if (phaseRef.current === "guide") {
              setPaused(true);
              setCue("Tracking lost. Hold steady.");
            } else {
              setCue("Hold steady.");
            }
          } else if (phaseRef.current === "guide") setCue("Follow the arrow.");
        }
        scanGroup.visible = scanVisible && tracking;
        planGroup.visible = planVisible && tracking;
        if (!tracking) {
          if (phaseRef.current === "scanning" && time > cueHoldUntil)
            setCue("Hold steady.");
          r.render(scene, camera);
          labelEls.current.forEach((node) => {
            node.style.opacity = "0";
            node.style.visibility = "hidden";
          });
          return;
        }
        if (pendingShot && captureTool && pose) {
          const xrView = pose.views[0];
          if (xrView) {
            try {
              const shot = captureTool.capture(frameData, xrView, reference);
              if (shot) {
                const t = shot.cameraWorld;
                const world =
                  t.length >= 14
                    ? { x: t[12], y: t[13], z: t[14] }
                    : { x: t[0] ?? 0, y: t[1] ?? 0, z: t[2] ?? 0 };
                const origin = frame.current?.origin;
                finishShot({
                  ...shot,
                  roomPoint: origin
                    ? { x: world.x - origin.x, y: world.z - origin.z }
                    : { x: 0, y: 0 },
                });
              }
            } catch {
              captureTool.dispose();
              captureTool = null;
              setCameraAccess(false);
              finishShot(null);
            }
            // Camera capture restores raw GL state; resync Three before drawing.
            r.state.reset();
          }
        }
        if (phaseRef.current === "scanning" && time - lastCapture > 90) {
          lastCapture = time;
          for (const source of sources) {
            const result = frameData.getHitTestResults(source)[0];
            const hit = result?.getPose(reference);
            if (!hit) continue;
            // The hit pose's Y axis is its surface normal. Ignore vertical wall hits.
            if (Math.abs(hit.transform.matrix[5]) < 0.65) continue;
            const p = hit.transform.position;
            accumulator.current.addHit({ x: p.x, y: p.y, z: p.z }, time);
          }
        }
        if (phaseRef.current === "scanning" && time - lastScan > 250) {
          lastScan = time;
          const detected = (
            frameData as XRFrame & { detectedPlanes?: Set<DetectedPlane> }
          ).detectedPlanes;
          for (const plane of detected ?? []) {
            const planePose = frameData.getPose(plane.planeSpace, reference);
            if (!planePose || plane.polygon.length < 3) continue;
            const transform = new THREE.Matrix4().fromArray(
              planePose.transform.matrix,
            );
            const vertices = plane.polygon.map((p) =>
              new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(transform),
            );
            accumulator.current.addPlane(
              vertices.map((p) => ({ x: p.x, y: p.y, z: p.z })),
              plane.semanticLabel,
            );
          }
          // CPU depth is requested opportunistically but never treated as measured
          // geometry: only hit-test points and detected floor planes are consumed.
          const next = accumulator.current.getSnapshot();
          updateScan(next);
          setSnapshot(next);
          if (time > cueHoldUntil) {
            setCue(
              scanHint.current ||
                (next.floorY === null
                  ? "Look toward the floor."
                  : next.ready
                    ? "Ready. Use scan."
                    : "Move slowly."),
            );
          }
        }
        r.render(scene, camera);
        projectLabels();
      });
      setActive(true);
      setStarting(false);
      startingRef.current = false;
      setPhase("scanning");
      setCue("Move slowly. Look toward the floor.");
    } catch (error) {
      void xr?.end().catch(() => {});
      cleanup();
      if (mounted.current) {
        setStarting(false);
        setPhase("intro");
        const message =
          error instanceof Error && error.message === "Controls unavailable"
            ? "Controls unavailable"
            : "Camera scanning could not start.";
        setFatal(message);
        setCue(message);
      }
    }
  }

  const weak = snapshot.floorY !== null && !snapshot.ready;
  const cueText = voice.error || cue;
  const goalField = (
    <form
      className="xr-goal"
      onSubmit={(event) => {
        event.preventDefault();
        if (phase === "review") void understand(goal);
      }}
    >
      <input
        value={goal}
        onChange={(event) => setGoal(event.target.value.slice(0, 500))}
        placeholder="What do you want to do?"
        aria-label="Goal"
        autoComplete="off"
      />
      {voice.supported && (
        <button
          type="button"
          className={voice.enabled ? "xr-goal-mic xr-on" : "xr-goal-mic"}
          aria-label={voice.enabled ? "Turn microphone off" : "Talk your goal"}
          aria-pressed={voice.enabled}
          onClick={toggleVoice}
        >
          {voice.enabled ? <Mic size={17} /> : <MicOff size={17} />}
        </button>
      )}
    </form>
  );

  return (
    <div ref={root} className={`xr-workspace ${active ? "xr-active" : ""}`}>
      <div ref={host} className="xr-canvas" />
      <div className="xr-labels">
        {labels.map((label) => (
          <span
            key={label.key}
            ref={(node) => {
              if (node) labelEls.current.set(label.key, node);
              else labelEls.current.delete(label.key);
            }}
            className={`xr-label xr-label-${label.tone}`}
          >
            {label.text}
          </span>
        ))}
      </div>
      <header className="xr-top">
        <span className="xr-brand">
          sorty<span>·</span>
        </span>
        <div>
          {!active && onPhone && (
            <button type="button" aria-label="Open on phone" onClick={onPhone}>
              <Smartphone size={19} />
            </button>
          )}
          {!active && (
            <button type="button" aria-label="Close scanner" onClick={close}>
              <X size={21} />
            </button>
          )}
          {active && (
            <button type="button" aria-label="Reset scan" onClick={resetScan}>
              <RotateCcw size={19} />
            </button>
          )}
          {active && voice.supported && (
            <button
              type="button"
              className={voice.enabled ? "xr-on" : ""}
              aria-label={
                voice.enabled ? "Turn microphone off" : "Start voice guidance"
              }
              aria-pressed={voice.enabled}
              onClick={toggleVoice}
            >
              {voice.enabled ? <Mic size={19} /> : <MicOff size={19} />}
            </button>
          )}
          {active && (
            <button type="button" aria-label="Close scanner" onClick={close}>
              <X size={21} />
            </button>
          )}
        </div>
      </header>

      {phase === "scanning" && (
        <div className="xr-reticle" aria-hidden="true" />
      )}
      {phase === "intro" ? (
        <main className="xr-intro">
          <div className="xr-reticle xr-reticle-intro" aria-hidden="true" />
          <h1>Scan your space</h1>
          <p className="xr-cue" role="status">
            {fatal || cue}
          </p>
          {voice.listening && <span className="xr-stat">Listening…</span>}
          <div className="xr-actions">
            {goalField}
            {!fatal && (
              <button
                type="button"
                className="xr-primary"
                disabled={supported !== true || starting}
                onClick={() => void start()}
              >
                {starting ? "Opening camera…" : "Start scan"}
              </button>
            )}
            {fatal && onAssistant && (
              <button
                type="button"
                className="xr-primary"
                onClick={onAssistant}
              >
                <Camera size={18} />
                <span>Use camera assistant</span>
              </button>
            )}
            {onDemo && (
              <button type="button" className="xr-sample" onClick={onDemo}>
                Try sample
              </button>
            )}
          </div>
        </main>
      ) : (
        <footer className="xr-bottom">
          {voice.listening && <span className="xr-stat">Listening…</span>}
          {phase === "scanning" && (
            <>
              <span className="xr-stat">
                Scan area <strong>{snapshot.area.toFixed(1)} m²</strong>
                {snapshot.samples ? ` · ${snapshot.samples} pts` : ""}
              </span>
              {weak && (
                <div className="xr-sweep" role="status">
                  <ChevronLeft size={14} />
                  <span>Sweep left</span>
                </div>
              )}
              <p className="xr-cue" role="status">
                {cueText}
              </p>
              {goalField}
              {snapshot.ready && (
                <button type="button" className="xr-primary" onClick={toReview}>
                  Use scan
                </button>
              )}
            </>
          )}
          {phase === "review" && (
            <>
              <span className="xr-stat">
                Scanned <strong>{snapshot.area.toFixed(1)} m²</strong>
              </span>
              <p className="xr-cue" role="status">
                {cueText}
              </p>
              {goalField}
              {cameraAccess === false ? (
                onAssistant && (
                  <button
                    type="button"
                    className="xr-primary"
                    onClick={onAssistant}
                  >
                    <Camera size={18} />
                    <span>Use camera assistant</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="xr-primary"
                  disabled={!room || !goal.trim() || cameraAccess === null}
                  onClick={() => void understand(goal)}
                >
                  Understand
                </button>
              )}
            </>
          )}
          {phase === "planning" && (
            <>
              <p className="xr-cue" role="status">
                {cueText}
              </p>
              <button type="button" className="xr-primary" disabled>
                <LoaderCircle className="spin" size={18} />
                <span>Working</span>
              </button>
            </>
          )}
          {phase === "guide" && (
            <>
              {task && task.steps.length > 0 && (
                <span className="xr-stat">
                  Step <strong>{Math.min(index + 1, task.steps.length)}</strong>{" "}
                  of {task.steps.length}
                </span>
              )}
              <p className="xr-cue" role="status">
                {paused ? "Paused." : cueText}
              </p>
              <button
                type="button"
                className="xr-primary"
                disabled={!trackingReady}
                onClick={() => (paused ? resume() : reportDone())}
              >
                {paused ? "Resume" : "Done"}
              </button>
              {!paused && (
                <button type="button" className="xr-secondary" onClick={pause}>
                  Pause
                </button>
              )}
            </>
          )}
          {phase === "done" && (
            <>
              <p className="xr-cue" role="status">
                {cueText}
              </p>
              {task ? (
                <>
                  <button
                    type="button"
                    className="xr-primary"
                    disabled={!trackingReady}
                    onClick={() => void checkTask()}
                  >
                    Check result
                  </button>
                  <button
                    type="button"
                    className="xr-secondary"
                    onClick={resetScan}
                  >
                    Scan again
                  </button>
                </>
              ) : (
                <button type="button" className="xr-primary" onClick={resetScan}>
                  Scan again
                </button>
              )}
            </>
          )}
        </footer>
      )}
    </div>
  );
}
