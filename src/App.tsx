import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  MoreHorizontal,
  RotateCcw,
  ScanLine,
  Settings2,
  X,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  type Plan,
  type Point,
  type Room,
  type Settings,
} from "./domain/types";
import { SAMPLE_ROOM } from "./domain/sample";
import { applyReportedMove, excludeDestination } from "./domain/session";
import { assessRoom, pointInPolygon } from "./geometry";
import { solveRoomAsync } from "./planner/client";
import RoomMap from "./components/RoomMap";
import GuidancePanel from "./guidance/GuidancePanel";
import Home from "./Home";

const XRWorkspace = lazy(() => import("./xr/XRWorkspace"));
const PhoneConnect = lazy(() => import("./components/PhoneConnect"));
const RoomEditor = lazy(() => import("./components/RoomEditor"));
const SceneWorkspace = lazy(() => import("./scene/SceneWorkspace"));
const PROFILE: Settings = {
  ...DEFAULT_SETTINGS,
  checkDoorway: false,
  requireTurning: false,
};

export default function App() {
  const [screen, setScreen] = useState<
    "home" | "assistant" | "scan" | "room" | "guide"
  >("home");
  const [room, setRoom] = useState<Room | null>(null);
  const [original, setOriginal] = useState<Room | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [settings, setSettings] = useState<Settings>(PROFILE);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [proposed, setProposed] = useState(true),
    [phone, setPhone] = useState(false);
  const [menu, setMenu] = useState(false),
    [preferences, setPreferences] = useState(false),
    [editor, setEditor] = useState(false);
  const [picking, setPicking] = useState<"start" | "goal" | null>(null);
  const [scanMode, setScanMode] = useState<"scan" | "verify">("scan");
  const assessment = useMemo(
    () => (room ? assessRoom(room, settings) : null),
    [room, settings],
  );
  const onPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  useEffect(() => {
    if (!room) return;
    try {
      localStorage.setItem("sorty-room-v2", JSON.stringify(room));
    } catch {
      /* Session continues in memory. */
    }
  }, [room]);

  function receiveScan(captured: Room) {
    setRoom(captured);
    setOriginal(null);
    setPlan(null);
    setMessage("");
    setScreen("room");
    setPicking(null);
  }
  function sample() {
    receiveScan(structuredClone(SAMPLE_ROOM));
  }
  function scan(mode: "scan" | "verify" = "scan") {
    setScanMode(mode);
    setScreen("scan");
    setMenu(false);
  }
  function changeRoom(next: Room) {
    setRoom(next);
    setPlan(null);
    setOriginal(null);
    setMessage("");
  }
  async function solve(scene = room) {
    if (!scene || busy) return;
    setBusy(true);
    setMessage("");
    setPlan(null);
    try {
      const result = await solveRoomAsync(scene, settings);
      setRoom(scene);
      setOriginal(structuredClone(scene));
      setPlan(result);
      setProposed(true);
      if (result.status === "unsolved")
        setMessage(
          scene.obstacles.every((o) => !o.movable)
            ? "Scan the objects more closely."
            : "No route found. Try a wider scan.",
        );
    } catch {
      setMessage("Couldn’t find a route. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function report(id: string) {
    if (!room || !plan) return;
    const step = plan.steps.find((s) => s.id === id);
    if (!step || step.status !== "pending") return;
    setRoom(applyReportedMove(room, step));
    setPlan({
      ...plan,
      steps: plan.steps.map((s) =>
        s.id === id ? { ...s, status: "reported" } : s,
      ),
    });
  }
  function blocked(id: string, reason: "destination" | "immovable") {
    if (!room || !plan) return;
    const step = plan.steps.find((s) => s.id === id);
    if (!step) return;
    const scene =
      reason === "destination"
        ? excludeDestination(room, step, crypto.randomUUID())
        : {
            ...room,
            obstacles: room.obstacles.map((o) =>
              o.id === step.obstacleId ? { ...o, movable: false } : o,
            ),
          };
    setScreen("room");
    void solve(scene);
  }
  function choosePoint(p: Point) {
    if (!room || !picking || !pointInPolygon(p, room.boundary)) return;
    changeRoom({ ...room, [picking]: p });
    setPicking(picking === "start" ? "goal" : null);
  }

  const loading = (
    <div className="quiet-loading">
      <LoaderCircle className="spin" size={24} />
      <span>Opening camera…</span>
    </div>
  );
  if (screen === "home")
    return (
      <>
        <Home
          onScan={() => scan()}
          onAssistant={() => setScreen("assistant")}
          onSample={sample}
          onPhone={!onPhone ? () => setPhone(true) : undefined}
        />
        {phone && (
          <Suspense fallback={null}>
            <PhoneConnect onClose={() => setPhone(false)} />
          </Suspense>
        )}
      </>
    );
  if (screen === "assistant")
    return (
      <Suspense fallback={loading}>
        <SceneWorkspace
          onMeasure={() => scan()}
          onClose={() => setScreen("home")}
        />
      </Suspense>
    );
  if (screen === "scan")
    return (
      <>
        <Suspense fallback={loading}>
          <XRWorkspace
            mode={scanMode}
            room={room || undefined}
            plan={plan || undefined}
            onComplete={receiveScan}
            onClose={() => setScreen("home")}
            onDemo={sample}
            onAssistant={() => setScreen("assistant")}
            onPhone={!onPhone ? () => setPhone(true) : undefined}
          />
        </Suspense>
        {phone && (
          <Suspense fallback={null}>
            <PhoneConnect onClose={() => setPhone(false)} />
          </Suspense>
        )}
      </>
    );

  const displayRoom =
    proposed && plan ? plan.roomAfter : original && plan ? original : room;
  const displayAssessment =
    proposed && plan ? plan.after : original && plan ? plan.before : assessment;
  const ready = plan?.status === "ready";
  const allReported =
    plan?.steps.length && plan.steps.every((s) => s.status !== "pending");
  return (
    <main className="space-screen">
      <header className="space-header">
        <button
          className="round-button"
          onClick={() => scan()}
          aria-label="Scan a new room"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="wordmark">
          sorty<span>·</span>
        </span>
        <button
          className="round-button"
          onClick={() => setMenu(true)}
          aria-label="More options"
        >
          <MoreHorizontal size={21} />
        </button>
      </header>
      <section className="space-heading">
        <span className="small-label">
          {room?.source === "sample"
            ? "SAMPLE SPACE"
            : room?.reviewed
              ? "YOUR SCAN"
              : "SCAN ESTIMATE"}
        </span>
        <h1>
          {picking
            ? picking === "start"
              ? "Where do you start?"
              : "Where are you going?"
            : busy
              ? "Finding a way."
              : allReported
                ? "A little more room."
                : ready
                  ? `${plan.steps.length} ${plan.steps.length === 1 ? "move" : "moves"}. More room.`
                  : plan?.status === "clear"
                    ? "A route through your scan."
                    : "Here’s your space."}
        </h1>
        <p>
          {picking
            ? "Tap the map."
            : !room?.reviewed
              ? "Check the scan. Tap objects you can move."
              : ready
                ? "Follow the dotted line."
                : allReported
                  ? "Scan again to check the result."
                  : "Choose the space you need."}
        </p>
      </section>
      {room && displayRoom && displayAssessment && (
        <section className={`space-map ${picking ? "is-picking" : ""}`}>
          <RoomMap
            room={displayRoom}
            assessment={displayAssessment}
            settings={settings}
            plan={plan}
            beforeRoom={original || undefined}
            proposed={proposed && !!plan}
            dimensions={false}
            compact
            showRoute={!!plan}
            onPoint={picking ? choosePoint : undefined}
          />
          {!!plan && (
            <div className="map-switch">
              <button
                className={!proposed ? "active" : ""}
                onClick={() => setProposed(false)}
              >
                Before
              </button>
              <button
                className={proposed ? "active" : ""}
                onClick={() => setProposed(true)}
              >
                After
              </button>
            </div>
          )}
        </section>
      )}
      <footer className="space-bottom">
        {message && (
          <p className="short-message" role="status">
            {message}
          </p>
        )}
        <div className="route-tools">
          <button
            onClick={() => {
              setPicking("start");
              setPlan(null);
            }}
          >
            Change route
          </button>
          <button onClick={() => setPreferences(true)}>
            <Settings2 size={15} />
            {Math.round(settings.clearance * 100)} cm wide
          </button>
        </div>
        <button
          className="main-action"
          disabled={busy}
          onClick={() => {
            if (!room) return;
            if (picking) {
              setPicking(null);
              return;
            }
            if (!room.reviewed) {
              changeRoom({ ...room, reviewed: true });
              return;
            }
            if (allReported) {
              scan("verify");
              return;
            }
            if (ready) {
              setScreen("guide");
              return;
            }
            if (plan?.status === "clear") {
              scan("verify");
              return;
            }
            void solve();
          }}
        >
          {busy ? (
            <LoaderCircle className="spin" size={20} />
          ) : (
            <>
              {picking
                ? "Keep these points"
                : !room?.reviewed
                  ? "Use this scan"
                  : allReported || plan?.status === "clear"
                    ? "Scan again"
                    : ready
                      ? "Guide me"
                      : "Find a path"}
              <ArrowRight size={20} />
            </>
          )}
        </button>
        <span className="bottom-note">
          {room?.source === "sample"
            ? "Sample · no live sensing"
            : "Estimates from captured surfaces"}
        </span>
      </footer>
      {screen === "guide" && room && plan && (
        <GuidancePanel
          room={room}
          plan={plan}
          onStepReported={report}
          onBlocked={blocked}
          onRemeasure={() => scan("verify")}
          onClose={() => setScreen("room")}
        />
      )}
      {preferences && (
        <div className="sheet-backdrop" onClick={() => setPreferences(false)}>
          <section
            className="bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Route preferences"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-top">
              <h2>Room for you.</h2>
              <button
                className="round-button"
                onClick={() => setPreferences(false)}
                aria-label="Close preferences"
              >
                <X size={20} />
              </button>
            </div>
            <label className="width-control">
              <span>Path width</span>
              <strong>{Math.round(settings.clearance * 100)} cm</strong>
              <input
                type="range"
                min="0.6"
                max="1.5"
                step="0.01"
                value={settings.clearance}
                onChange={(e) => {
                  setSettings({
                    ...settings,
                    clearance: Number(e.target.value),
                  });
                  setPlan(null);
                }}
              />
            </label>
            <label className="turn-control">
              <span>Space to turn</span>
              <input
                type="checkbox"
                checked={settings.requireTurning}
                onChange={(e) => {
                  setSettings({
                    ...settings,
                    requireTurning: e.target.checked,
                  });
                  setPlan(null);
                }}
              />
            </label>
            <button
              className="main-action"
              onClick={() => setPreferences(false)}
            >
              Done
              <Check size={19} />
            </button>
          </section>
        </div>
      )}
      {menu && (
        <div className="sheet-backdrop" onClick={() => setMenu(false)}>
          <section
            className="bottom-sheet menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More options"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-top">
              <h2>Your space.</h2>
              <button
                className="round-button"
                onClick={() => setMenu(false)}
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>
            <button onClick={() => scan()}>
              <ScanLine size={18} />
              Scan again
            </button>
            <button
              onClick={() => {
                setMenu(false);
                setEditor(true);
              }}
            >
              <Settings2 size={18} />
              Correct measurements
            </button>
            <button
              onClick={() => {
                setMenu(false);
                sample();
              }}
            >
              <RotateCcw size={18} />
              Try sample
            </button>
            <details>
              <summary>What’s measured?</summary>
              <p>
                The scan collects visible surfaces. Hidden obstacles and
                unobserved areas may be missing. Widths and paths are estimates.
                Doorways, slopes and surfaces aren’t assessed here.
              </p>
            </details>
          </section>
        </div>
      )}
      {editor && room && (
        <Suspense fallback={null}>
          <RoomEditor
            room={room}
            onSave={(r) => {
              changeRoom(r);
              setEditor(false);
            }}
            onClose={() => setEditor(false)}
          />
        </Suspense>
      )}
    </main>
  );
}
