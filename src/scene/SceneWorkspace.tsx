import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  ImagePlus,
  LoaderCircle,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Ruler,
  Volume2,
  X,
} from "lucide-react";
import useVoice from "../guidance/useVoice";
import { parseCommand } from "../guidance/commands";
import { captureFrame } from "./camera";
import { coverBox, type SceneObject, type ScenePlan } from "./types";
import "./scene.css";

export default function SceneWorkspace({
  onMeasure,
}: {
  onMeasure: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  const opening = useRef(false);
  const requesting = useRef(false);
  const sourceGeneration = useRef(0);
  const [camera, setCamera] = useState(false);
  const [photo, setPhoto] = useState("");
  const [goal, setGoal] = useState("");
  const [task, setTask] = useState("");
  const [objects, setObjects] = useState<SceneObject[]>([]);
  const [plan, setPlan] = useState<ScenePlan | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [error, setError] = useState("");
  const [dimensions, setDimensions] = useState({ width: 1280, height: 720 });
  const [viewport, setViewport] = useState({
    width: innerWidth,
    height: innerHeight,
  });
  const onSpeech = useRef<(text: string) => void>(() => {});
  const voice = useVoice((text) => onSpeech.current(text));
  const step = plan?.steps[index];
  const complete =
    plan?.status === "complete" ||
    (!!plan &&
      !plan.question &&
      index >= plan.steps.length &&
      plan.steps.length > 0);

  useEffect(() => {
    alive.current = true;
    const resize = () =>
      setViewport({ width: innerWidth, height: innerHeight });
    addEventListener("resize", resize);
    return () => {
      alive.current = false;
      request.current?.abort();
      stream.current?.getTracks().forEach((track) => track.stop());
      removeEventListener("resize", resize);
    };
  }, []);

  async function openCamera() {
    if (opening.current) return;
    if (
      stream.current
        ?.getVideoTracks()
        .some((track) => track.readyState === "live")
    ) {
      setPhoto("");
      setObjects([]);
      return;
    }
    opening.current = true;
    sourceGeneration.current++;
    setError("");
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (!alive.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = next;
      setPhoto("");
      setObjects([]);
      if (video.current) {
        video.current.srcObject = next;
        await video.current.play();
        setDimensions({
          width: video.current.videoWidth,
          height: video.current.videoHeight,
        });
      }
      setCamera(true);
    } catch {
      if (alive.current) setError("Camera unavailable. You can use a photo.");
    } finally {
      opening.current = false;
    }
  }

  async function loadPhoto(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image.");
      return;
    }
    const generation = ++sourceGeneration.current;
    request.current?.abort();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setCamera(false);
    // Boxes belong to one captured frame. A new photo starts a fresh plan.
    setPlan(null);
    setTask("");
    setGoal("");
    setIndex(0);
    setPaused(false);
    setObjects([]);
    setError("");
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 960 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas
        .getContext("2d")!
        .drawImage(img, 0, 0, canvas.width, canvas.height);
      if (!alive.current || generation !== sourceGeneration.current) return;
      setDimensions({ width: canvas.width, height: canvas.height });
      setPhoto(canvas.toDataURL("image/jpeg", 0.85));
    } catch {
      if (alive.current) setError("Could not open this photo.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function understand(
    text = goal,
    recheck = false,
    reported = index,
    imageOverride?: string,
  ) {
    const nextGoal = text.trim();
    if (!nextGoal || requesting.current) return;
    let image = imageOverride || photo;
    try {
      if (!imageOverride && camera && video.current)
        image = captureFrame(video.current);
    } catch {
      setError("Camera is still opening.");
      return;
    }
    if (!image) {
      setError("Open the camera or choose a photo first.");
      return;
    }
    voice.silence();
    setError("");
    setBusy(true);
    requesting.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 100000);
    const resolvedGoal = (
      plan?.question && !recheck
        ? `${task}. Clarification: ${nextGoal}`
        : nextGoal
    ).slice(0, 500);
    try {
      // Boxes are tied to the exact analyzed frame, never projected over a moved camera.
      setPhoto(image);
      setObjects([]);
      const response = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          image,
          goal: resolvedGoal,
          client: "camera",
          ...(recheck && plan
            ? {
                previous: {
                  summary: plan.summary,
                  steps: plan.steps,
                  currentStep: reported,
                },
              }
            : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not understand the scene.");
      if (!alive.current || controller.signal.aborted) return;
      if (!Array.isArray(result.steps) || typeof result.summary !== "string")
        throw new Error("The model did not return a usable plan.");
      setPlan(result);
      setObjects(result.objects || []);
      setTask(resolvedGoal);
      setGoal("");
      setIndex(0);
      if (voice.enabled && !pausedRef.current)
        voice.speak(
          result.question || result.steps[0]?.instruction || result.summary,
        );
    } catch (cause) {
      if (alive.current && request.current === controller)
        setError(
          controller.signal.aborted
            ? "That took too long. Try again."
            : cause instanceof Error
              ? cause.message
              : "Scene understanding unavailable.",
        );
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        requesting.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }

  function next() {
    if (!step || paused || busy) return;
    voice.silence();
    // The plan already contains the ordered actions. Flip locally; only an
    // explicit check spends another inference on a fresh frame.
    const nextIndex = index + 1;
    setIndex(nextIndex);
    if (!voice.enabled) return;
    const upcoming = plan?.steps[nextIndex];
    voice.speak(
      upcoming?.instruction ||
        (plan?.status === "complete"
          ? plan.summary
          : "All steps done. Check the result."),
    );
  }
  function reset() {
    request.current?.abort();
    requesting.current = false;
    setBusy(false);
    voice.silence();
    setPlan(null);
    setTask("");
    setGoal("");
    setIndex(0);
    setError("");
    setPaused(false);
    setObjects([]);
    if (camera) setPhoto("");
  }
  function lookAgain() {
    if (camera && photo) {
      setPhoto("");
      setObjects([]);
      return;
    }
    void understand(task, true);
  }
  onSpeech.current = (text) => {
    const command = parseCommand(text);
    if (plan && !plan.question) {
      if (command === "next") {
        next();
        return;
      }
      if (command === "pause") {
        voice.silence();
        setPaused(true);
        return;
      }
      if (command === "resume") {
        setPaused(false);
        if (step) voice.speak(step.instruction);
        return;
      }
      if (command === "repeat") {
        voice.speak(step?.instruction || plan.summary);
        return;
      }
      if (
        command === "check" ||
        command === "blocked" ||
        command === "immovable"
      ) {
        void understand(`${task}. ${text}`, true);
        return;
      }
      if (!complete) {
        void understand(`${task}. User update: ${text}`, true);
        return;
      }
    }
    setGoal(text);
    void understand(text);
  };

  // VLM-estimated boxes belong to the captured image, not a measured world position.
  const target = step?.targetId
    ? objects.find((object) => object.id === step.targetId)
    : undefined;
  const targetBox = target
    ? coverBox(target.box, dimensions, viewport, "contain")
    : null;
  const targetPoint = targetBox
    ? { x: targetBox.x + targetBox.width / 2, y: targetBox.y }
    : null;
  const marker = targetPoint
    ? {
        x: Math.max(38, Math.min(viewport.width - 38, targetPoint.x)),
        y: Math.max(115, Math.min(viewport.height - 335, targetPoint.y - 45)),
        arrow:
          targetPoint.x < 30
            ? "←"
            : targetPoint.x > viewport.width - 30
              ? "→"
              : targetPoint.y < 80
                ? "↑"
                : "↓",
      }
    : null;
  const cue = busy
    ? "Looking…"
    : paused
      ? "Paused"
      : error ||
        plan?.question ||
        (complete
          ? plan?.status === "complete"
            ? plan.summary
            : "All steps done. Check the result."
          : step?.instruction) ||
        (plan ? plan.summary : "What are we doing?");
  const hasImage = camera || !!photo;
  return (
    <main className="scene-workspace">
      <video
        ref={video}
        className={`scene-feed ${camera && !photo ? "scene-feed-visible" : ""}`}
        muted
        playsInline
      />
      {photo && (
        <img
          className="scene-feed scene-feed-visible"
          src={photo}
          alt="Your space"
        />
      )}
      <div className="scene-shade" />
      <header className="scene-header">
        <span className="scene-brand">
          sorty<span>·</span>
        </span>
        <div>
          <button
            aria-label="Measured room scan"
            onClick={() => {
              stream.current?.getTracks().forEach((t) => t.stop());
              onMeasure();
            }}
          >
            <Ruler size={20} />
          </button>
          {(plan || busy) && (
            <button aria-label="New task" onClick={reset}>
              <X size={21} />
            </button>
          )}
        </div>
      </header>
      {photo && plan && (
        <span className="scene-frame-note">Captured frame · AI estimates</span>
      )}
      <div className="scene-labels" aria-hidden="true">
        {hasImage &&
          !busy &&
          !paused &&
          objects
            .slice(0, 8)
            .map((object) => {
              const box = coverBox(object.box, dimensions, viewport, "contain");
              const selected = target?.id === object.id;
              return (
                <div
                  className={`scene-object ${selected ? "scene-object-target" : ""}`}
                  key={object.id}
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.width,
                    height: box.height,
                  }}
                >
                  <span className="scene-object-name">{object.label}</span>
                  {selected && step && (
                    <span className="scene-object-instruction">
                      {step.instruction}
                    </span>
                  )}
                </div>
              );
            })}
        {marker && !busy && !paused && (
          <span
            className="scene-target-arrow"
            style={{ left: marker.x, top: marker.y }}
          >
            {marker.arrow}
            <b>{index + 1}</b>
          </span>
        )}
      </div>
      {!hasImage && (
        <section className="scene-empty">
          <Camera size={35} strokeWidth={1} />
          <button className="scene-primary" onClick={() => void openCamera()}>
            Open camera
          </button>
          <button
            className="scene-photo-button"
            onClick={() => upload.current?.click()}
          >
            Use a photo
          </button>
        </section>
      )}
      <footer className="scene-bottom">
        {step && (
          <span className="scene-count">
            Step {index + 1} of {plan?.steps.length ?? 1}
          </span>
        )}
        <h1 className={busy ? "scene-thinking" : ""} role="status">
          {busy && <LoaderCircle className="spin" size={22} />} {cue}
        </h1>
        {!!error && (
          <button
            className="scene-retry"
            onClick={() => void understand(goal || task)}
          >
            Try again
          </button>
        )}
        {!(plan && !plan.question) && (
          <form
            className="scene-goal"
            onSubmit={(event) => {
              event.preventDefault();
              void understand();
            }}
          >
            <input
              aria-label={
                plan?.question ? "Your answer" : "What do you want to do?"
              }
              placeholder={
                plan?.question ? "Your answer…" : "Help me set this up…"
              }
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              maxLength={500}
              disabled={busy}
            />
            <button
              type="submit"
              aria-label="Understand this scene"
              disabled={!goal.trim() || busy || !hasImage}
            >
              <ArrowRight size={23} />
            </button>
          </form>
        )}
        <div className="scene-controls">
          <button
            aria-label={voice.enabled ? "Turn microphone off" : "Say your goal"}
            aria-pressed={voice.enabled}
            className={voice.enabled ? "scene-on" : ""}
            disabled={!voice.supported}
            onClick={() => voice.toggle()}
          >
            {voice.enabled ? <Mic /> : <MicOff />}
          </button>
          {plan && (
            <button
              aria-label="Repeat"
              onClick={() =>
                voice.speak(step?.instruction || plan.question || plan.summary)
              }
            >
              <Volume2 />
            </button>
          )}
          {step && (
            <button
              aria-label={paused ? "Resume" : "Pause"}
              onClick={() => {
                voice.silence();
                setPaused(!paused);
              }}
            >
              {paused ? <Play /> : <Pause />}
            </button>
          )}
          <button
            aria-label="Choose photo"
            disabled={busy}
            onClick={() => upload.current?.click()}
          >
            <ImagePlus />
          </button>
          {photo && (
            <button
              aria-label="Switch to live camera"
              disabled={busy}
              onClick={() => void openCamera()}
            >
              <Camera />
            </button>
          )}
          {plan && !step && (
            <button aria-label="New goal" onClick={reset}>
              <RotateCcw />
            </button>
          )}
        </div>
        {step && (
          <button
            className="scene-primary"
            disabled={busy || paused}
            onClick={next}
          >
            Done <Check size={20} />
          </button>
        )}
        {(step || complete) && (
          <button
            className={complete ? "scene-primary" : "scene-check"}
            disabled={busy}
            onClick={lookAgain}
          >
            {camera && !photo
              ? "Update view"
              : complete
                ? "Check result"
                : "Look again"}
          </button>
        )}
        {!plan && (
          <span className="scene-note">
            {!voice.supported
              ? "Voice needs the HTTPS link."
              : voice.listening
                ? "Listening"
                : photo
                  ? "Captured frame"
                  : ""}
          </span>
        )}
        {voice.error && (
          <span className="scene-note" role="status">
            {voice.error}
          </span>
        )}
      </footer>
      <input
        ref={upload}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void loadPhoto(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </main>
  );
}
