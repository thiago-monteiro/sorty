import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Info,
  Mic,
  MicOff,
  MoreHorizontal,
  Pause,
  Volume2,
  X,
} from "lucide-react";
import type {
  Plan,
  PlanStep,
  Point,
  Room,
  VoiceCommand,
} from "../domain/types";
import { parseCommand } from "./commands";
import useVoice from "./useVoice";
import "./guidance.css";

type Props = {
  room: Room;
  plan: Plan;
  onStepReported: (stepId: string) => void;
  onBlocked: (stepId: string, reason: "destination" | "immovable") => void;
  onRemeasure: () => void;
  onClose: () => void;
};

const AMBER = "#f2b45c";
const LIME = "#d2f78e";

function pointLetter(room: Room, step: PlanStep): string {
  return String.fromCharCode(
    65 +
      Math.max(
        0,
        room.obstacles.findIndex((object) => object.id === step.obstacleId),
      ),
  );
}

function MoveMap({
  room,
  plan,
  index,
  step,
  mini = false,
}: {
  room: Room;
  plan: Plan;
  index: number;
  step: PlanStep;
  mini?: boolean;
}) {
  const points = room.boundary.length
    ? room.boundary
    : [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1;
  const height = Math.max(...ys) - minY || 1;
  const unit = Math.max(width, height);
  const pad = unit * 0.09;
  const object = room.obstacles.find((o) => o.id === step.obstacleId);
  const ow = object?.width ?? 0.4;
  const od = object?.depth ?? 0.4;
  const path =
    step.movementPath && step.movementPath.length > 1
      ? step.movementPath
      : [step.from, step.to];
  const center = (p: Point) => ({ x: p.x + ow / 2, y: p.y + od / 2 });
  const from = center(path[0]);
  const to = center(path[path.length - 1]);
  const markerId = "guide-arrow-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const pin = unit * 0.055;
  const arrow = unit * 0.06;

  return (
    <svg
      className={`guide-map${mini ? " guide-map-mini" : ""}`}
      viewBox={`${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`}
      role="img"
      aria-label={`Room map. ${step.label} is A. Point 1 is the target. The amber arrow shows the checked movement path.`}
    >
      <defs>
        <marker
          id={markerId}
          markerWidth={arrow}
          markerHeight={arrow}
          refX={arrow * 0.78}
          refY={arrow * 0.5}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d={`M0 0 L${arrow} ${arrow * 0.5} L0 ${arrow} Z`}
            fill={AMBER}
          />
        </marker>
      </defs>
      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="#14221c"
        stroke="#657b6d"
        strokeWidth={pad * 0.16}
        strokeLinejoin="round"
      />
      {room.obstacles
        .filter((o) => o.id !== step.obstacleId)
        .map((o) => {
          const prior = plan.steps
            .slice(0, index)
            .filter((s) => s.obstacleId === o.id)
            .at(-1);
          return (
            <rect
              key={o.id}
              x={prior?.to.x ?? o.x}
              y={prior?.to.y ?? o.y}
              width={o.width}
              height={o.depth}
              rx={pad * 0.1}
              fill="#33473b"
            />
          );
        })}
      <rect
        x={step.to.x}
        y={step.to.y}
        width={ow}
        height={od}
        rx={pad * 0.12}
        fill={LIME}
        fillOpacity="0.12"
        stroke={LIME}
        strokeWidth={pad * 0.13}
        strokeDasharray={`${pad * 0.28} ${pad * 0.2}`}
      />
      {path.slice(1).map((point, i) => {
        const a = center(path[i]);
        const b = center(point);
        const last = i === path.length - 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const end = last
          ? {
              x: b.x - (dx / length) * pin * 1.25,
              y: b.y - (dy / length) * pin * 1.25,
            }
          : b;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={end.x}
            y2={end.y}
            stroke={AMBER}
            strokeWidth={unit * 0.014}
            strokeLinecap="round"
            markerEnd={`url(#${markerId})`}
          />
        );
      })}
      <rect
        x={step.from.x}
        y={step.from.y}
        width={ow}
        height={od}
        rx={pad * 0.12}
        fill="#f0f1e6"
        fillOpacity="0.92"
        stroke={AMBER}
        strokeWidth={pad * 0.13}
      />
      <circle
        cx={from.x}
        cy={from.y}
        r={pin}
        fill="#f7f4e8"
        stroke="#101b17"
        strokeWidth={pin * 0.12}
      />
      <text
        x={from.x}
        y={from.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={pin * 1.08}
        fontWeight="700"
        fill="#101b17"
      >
        {pointLetter(room, step)}
      </text>
      <circle
        cx={to.x}
        cy={to.y}
        r={pin}
        fill={LIME}
        stroke="#101b17"
        strokeWidth={pin * 0.12}
      />
      <text
        x={to.x}
        y={to.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={pin * 1.08}
        fontWeight="700"
        fill="#101b17"
      >
        {index + 1}
      </text>
    </svg>
  );
}

function nameOf(step: PlanStep) {
  return step.label.toLowerCase().replace(/^the /, "");
}

export default function GuidancePanel({
  room,
  plan,
  onStepReported,
  onBlocked,
  onRemeasure,
  onClose,
}: Props) {
  const [index, setIndex] = useState(() => {
    const i = plan.steps.findIndex((s) => s.status === "pending");
    return i < 0 ? plan.steps.length : i;
  });
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [info, setInfo] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState("");
  const [sheet, setSheet] = useState(false);
  const [camera, setCamera] = useState(false);
  const [opening, setOpening] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [observation, setObservation] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const panel = useRef<HTMLElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const step = plan.steps[index];
  const voice = useVoice((text) => handle(parseCommand(text)));

  function narration(s: PlanStep | null | undefined = step) {
    return s
      ? `Move ${pointLetter(room, s)} to point ${plan.steps.findIndex((candidate) => candidate.id === s.id) + 1}. Follow the arrow.`
      : "Moves reported. Scan again when ready.";
  }

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      alive.current = false;
      generation.current++;
      request.current?.abort();
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (camera && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => {});
    }
  }, [camera]);

  function closeCamera() {
    generation.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
    setOpening(false);
  }
  function close() {
    closeCamera();
    request.current?.abort();
    voice.silence();
    onClose();
  }
  function next() {
    if (paused) {
      setFeedback("Continue when ready.");
      return;
    }
    if (!step) {
      setFeedback("Scan again to check the space.");
      return;
    }
    if (step.status === "pending") onStepReported(step.id);
    setIndex(index + 1);
    setFeedback("");
    setBlocked(false);
    if (voice.enabled) voice.speak(narration(plan.steps[index + 1]));
  }
  function handle(command: VoiceCommand) {
    setFeedback("");
    switch (command) {
      case "pause":
        voice.silence();
        setPaused(true);
        break;
      case "help":
        voice.silence();
        setPaused(true);
        setFeedback("Ask someone nearby for help.");
        break;
      case "resume":
        setPaused(false);
        if (voice.enabled) voice.speak(narration());
        break;
      case "repeat":
        voice.speak(narration());
        break;
      case "next":
        next();
        break;
      case "back":
        voice.silence();
        setIndex((i) => Math.max(0, i - 1));
        setFeedback("Reviewing a reported move.");
        break;
      case "blocked":
      case "immovable":
        if (step) {
          voice.silence();
          setBlocked(false);
          onBlocked(
            step.id,
            command === "blocked" ? "destination" : "immovable",
          );
        }
        break;
      case "check":
        if (camera) void capture();
        else void openCamera();
        break;
      case "remeasure":
        voice.silence();
        closeCamera();
        onRemeasure();
        break;
      default:
        setFeedback("Try done, pause, or repeat.");
    }
  }
  async function openCamera() {
    if (opening || camera) return;
    setMenu(false);
    setFeedback("");
    setOpening(true);
    const id = ++generation.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
        },
        audio: false,
      });
      if (!alive.current || id !== generation.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      setCamera(true);
    } catch {
      if (alive.current && id === generation.current)
        setFeedback("Camera unavailable. Upload a photo from the menu.");
    } finally {
      if (alive.current && id === generation.current) setOpening(false);
    }
  }
  async function inspect(image: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPhoto(image);
    setObservation(null);
    setSheet(true);
    setInspecting(true);
    setFeedback("");
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          image,
          ...(before ? { beforeImage: before } : {}),
          instruction: step
            ? `Briefly describe what is visible around the ${nameOf(step)}. Do not judge clearance.`
            : "Briefly describe what is visible. Do not judge clearance.",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not check this image.");
      if (alive.current && request.current === controller)
        setObservation(result.observation);
    } catch (error) {
      if (alive.current && request.current === controller)
        setObservation(
          controller.signal.aborted
            ? "Check timed out. Try again."
            : error instanceof Error
              ? error.message
              : "Could not check this image.",
        );
    } finally {
      clearTimeout(timeout);
      if (alive.current && request.current === controller) {
        request.current = null;
        setInspecting(false);
      }
    }
  }
  async function capture() {
    if (inspecting || !video.current) return;
    const v = video.current;
    if (!v.videoWidth) {
      setFeedback("Camera is starting. Try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(v.videoWidth, 1024);
    canvas.height = Math.round((v.videoHeight * canvas.width) / v.videoWidth);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.8);
    closeCamera();
    await inspect(image);
  }
  async function upload(file?: File) {
    if (!file) return;
    setMenu(false);
    if (!file.type.startsWith("image/") || file.size > 15000000) {
      setFeedback("Choose an image under 15 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(bitmap.width, 1024);
      canvas.height = Math.round((bitmap.height * canvas.width) / bitmap.width);
      canvas
        .getContext("2d")
        ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      if (alive.current) await inspect(canvas.toDataURL("image/jpeg", 0.8));
    } catch {
      if (alive.current) setFeedback("Could not read this photo.");
    }
  }

  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="guide-shell"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (blocked) setBlocked(false);
          else if (sheet) setSheet(false);
          else if (camera || opening) closeCamera();
          else if (menu) setMenu(false);
          else close();
        }
        if (e.key === "Tab") {
          const controls = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not([type="file"])',
            ) ?? [],
          ).filter((el) => el.getClientRects().length);
          const first = controls[0];
          const last = controls.at(-1);
          if (
            e.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === panel.current)
          ) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="guide-header">
        <span className="guide-brand">
          sorty<span>·</span>
        </span>
        <span className="guide-header-right">
          <span className="guide-step">
            {step ? `${index + 1}/${plan.steps.length}` : "Reported"}
          </span>
          <button
            className="guide-icon"
            onClick={close}
            aria-label="Close guidance"
          >
            <X />
          </button>
        </span>
      </header>

      <main className="guide-main">
        {step && !paused ? (
          <MoveMap room={room} plan={plan} index={index} step={step} />
        ) : (
          <div className="guide-symbol" aria-hidden="true">
            {paused ? <Pause size={48} /> : <Check size={48} />}
          </div>
        )}
        <h1 id="guide-title">
          {paused
            ? "Paused."
            : step
              ? `Move ${pointLetter(room, step)} to ${index + 1}.`
              : "Moves reported"}
        </h1>
        {step && !paused && <p className="guide-object">{step.label}</p>}
        {paused && <p className="guide-sub">Say continue when ready.</p>}
        {!step && <p className="guide-sub">Clearance not verified.</p>}
        {feedback && (
          <p className="guide-feedback" role="status">
            {feedback}
          </p>
        )}
      </main>

      <footer className="guide-footer">
        <div className="guide-tools">
          <button
            className={`guide-icon ${voice.enabled ? "guide-active" : ""}`}
            aria-label={
              voice.enabled ? "Turn microphone off" : "Start voice guidance"
            }
            aria-pressed={voice.enabled}
            disabled={!voice.supported}
            onClick={() => {
              if (!voice.enabled) voice.speak(narration());
              voice.toggle();
            }}
          >
            {voice.enabled ? <Mic /> : <MicOff />}
          </button>
          <button
            className="guide-icon"
            aria-label="Repeat instruction"
            onClick={() => voice.speak(narration())}
          >
            <Volume2 />
          </button>
          {step && !paused && (
            <button
              className="guide-icon"
              aria-label="Pause guidance"
              onClick={() => handle("pause")}
            >
              <Pause />
            </button>
          )}
          <button
            className="guide-icon"
            aria-label="Open camera check"
            disabled={opening}
            onClick={() => void openCamera()}
          >
            <Camera />
          </button>
          <button
            className="guide-icon"
            aria-label="More options"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal />
          </button>
        </div>

        {menu && (
          <div className="guide-menu">
            <button
              onClick={() => {
                setTyping(!typing);
                setMenu(false);
              }}
            >
              Type command
            </button>
            <button onClick={() => uploadInput.current?.click()}>
              Upload photo
            </button>
            {photo && (
              <button
                onClick={() => {
                  setBefore(photo);
                  setMenu(false);
                  setFeedback("Before photo saved.");
                }}
              >
                Use as before photo
              </button>
            )}
            {index > 0 && (
              <button
                aria-label="Review previous move"
                onClick={() => {
                  handle("back");
                  setMenu(false);
                }}
              >
                <ArrowLeft />
              </button>
            )}
            <button
              aria-label="About voice and image checks"
              onClick={() => {
                setInfo(!info);
                setMenu(false);
              }}
            >
              <Info />
            </button>
          </div>
        )}

        <input
          ref={uploadInput}
          className="guide-hidden"
          type="file"
          accept="image/*"
          aria-label="Upload room photo"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {info && (
          <p className="guide-info">
            Voice recognition may use your browser’s network service. Images are
            sent only when you choose Check or upload a photo. Image estimates
            do not verify measurements.
          </p>
        )}
        {voice.error && (
          <p className="guide-feedback" role="status">
            {voice.error}
          </p>
        )}
        {typing && (
          <form
            className="guide-command"
            onSubmit={(e) => {
              e.preventDefault();
              handle(parseCommand(typed));
              setTyped("");
            }}
          >
            <input
              aria-label="Type a voice command"
              placeholder="Type command"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button
              className="guide-icon"
              aria-label="Run command"
              disabled={!typed.trim()}
            >
              <ArrowRight />
            </button>
          </form>
        )}

        <button
          className="guide-primary"
          onClick={() =>
            paused ? handle("resume") : step ? next() : onRemeasure()
          }
        >
          {paused ? "Continue" : step ? "Done" : "Scan again"}
        </button>
        {step && !paused && (
          <button
            className="guide-secondary"
            aria-expanded={blocked}
            onClick={() => setBlocked(true)}
          >
            Can’t do this
          </button>
        )}
      </footer>

      {(camera || opening) && (
        <div
          className="guide-camera"
          role="dialog"
          aria-modal="true"
          aria-label="Camera check"
        >
          <video ref={video} autoPlay muted playsInline />
          {opening && <p className="guide-camera-loading">Opening camera…</p>}
          <button
            className="guide-icon guide-camera-close"
            aria-label="Close camera"
            onClick={closeCamera}
          >
            <X />
          </button>
          {step && (
            <div className="guide-camera-map">
              <MoveMap room={room} plan={plan} index={index} step={step} mini />
              <span>2D map · not camera-tracked</span>
            </div>
          )}
          <button
            className="guide-primary guide-camera-check"
            disabled={opening || inspecting}
            onClick={() => void capture()}
          >
            {opening ? "Opening…" : inspecting ? "Checking…" : "Check"}
          </button>
        </div>
      )}

      {sheet && (
        <div className="guide-sheet-shade" onClick={() => setSheet(false)}>
          <section
            className="guide-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Image observation"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <span>Image observation</span>
              <span className="guide-tag">Not verified</span>
              <button
                className="guide-icon"
                aria-label="Close image observation"
                onClick={() => setSheet(false)}
              >
                <X />
              </button>
            </header>
            <p role="status">{inspecting ? "Checking…" : observation}</p>
          </section>
        </div>
      )}

      {blocked && step && !paused && (
        <div className="guide-sheet-shade" onClick={() => setBlocked(false)}>
          <section
            className="guide-sheet guide-blocked-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="What is in the way?"
            onClick={(e) => e.stopPropagation()}
          >
            <p>What’s in the way?</p>
            <button onClick={() => handle("blocked")}>Spot is taken</button>
            <button onClick={() => handle("immovable")}>Too heavy</button>
          </section>
        </div>
      )}
    </section>
  );
}
