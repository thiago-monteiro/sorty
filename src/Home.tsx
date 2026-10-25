import {
  ArrowRight,
  Camera,
  Check,
  GitBranch,
  Mic,
  ScanLine,
  Smartphone,
} from "lucide-react";
import "./home.css";

export default function Home({
  onScan,
  onAssistant,
  onSample,
  onPhone,
}: {
  onScan: () => void;
  onAssistant: () => void;
  onSample: () => void;
  onPhone?: () => void;
}) {
  return (
    <main className="home">
      <div className="home-aurora" aria-hidden="true" />
      <header className="home-header">
        <span className="home-wordmark">
          sorty<span>·</span>
        </span>
        <div className="home-header-actions">
          {onPhone && (
            <button type="button" className="home-phone" onClick={onPhone}>
              <Smartphone size={15} />
              <span>Open on phone</span>
            </button>
          )}
          <a
            className="home-github"
            href="https://github.com/thiago-monteiro/sorty"
            target="_blank"
            rel="noreferrer"
            aria-label="Sorty on GitHub"
          >
            <GitBranch size={18} />
          </a>
        </div>
      </header>

      <section className="home-hero">
        <div className="home-copy">
          <p className="home-kicker">
            <i aria-hidden="true" />
            Spatial guidance for real rooms
          </p>
          <h1>
            See the room.
            <br />
            <em>Move the thing.</em>
          </h1>
          <p className="home-lede">
            Sorty turns your phone into a second pair of eyes. Scan the space,
            say what you need, and follow simple steps to clear it, pack it, or
            find your way through.
          </p>

          <div className="home-actions">
            <button type="button" className="home-start" onClick={onScan}>
              <ScanLine size={19} />
              Start scanning
              <ArrowRight size={19} />
            </button>
            <button type="button" className="home-alt" onClick={onAssistant}>
              <Camera size={18} />
              Camera assistant
            </button>
          </div>
          <button type="button" className="home-sample" onClick={onSample}>
            Try the sample room
            <ArrowRight size={14} />
          </button>

          <ul className="home-facts">
            <li>
              <Check size={13} /> Any phone
            </li>
            <li>
              <Check size={13} /> No headset
            </li>
            <li>
              <Check size={13} /> Hands free
            </li>
          </ul>
        </div>

        <div className="home-stage" aria-hidden="true">
          <div className="home-frame">
            <svg className="home-plan" viewBox="0 0 420 440">
              <defs>
                <pattern
                  id="home-grid"
                  width="24"
                  height="24"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M24 0H0V24"
                    fill="none"
                    stroke="#d2f78e"
                    strokeOpacity=".07"
                  />
                </pattern>
                <linearGradient
                  id="home-route"
                  x1="0"
                  y1="1"
                  x2="1"
                  y2="0"
                >
                  <stop offset="0" stopColor="#d2f78e" />
                  <stop offset="1" stopColor="#9fe4c8" />
                </linearGradient>
                <radialGradient id="home-floor" cx=".5" cy=".45" r=".7">
                  <stop offset="0" stopColor="#d2f78e" stopOpacity=".1" />
                  <stop offset="1" stopColor="#d2f78e" stopOpacity="0" />
                </radialGradient>
              </defs>

              <rect width="420" height="440" fill="url(#home-grid)" />
              <rect width="420" height="440" fill="url(#home-floor)" />
              <rect
                x="56"
                y="70"
                width="308"
                height="300"
                rx="22"
                fill="#d2f78e"
                fillOpacity=".035"
                stroke="#d2f78e"
                strokeOpacity=".3"
                strokeWidth="1.5"
              />

              <rect
                x="84"
                y="98"
                width="112"
                height="54"
                rx="11"
                fill="#ffffff"
                fillOpacity=".05"
                stroke="#ffffff"
                strokeOpacity=".18"
              />
              <rect
                x="258"
                y="102"
                width="74"
                height="58"
                rx="9"
                fill="#ffffff"
                fillOpacity=".05"
                stroke="#ffffff"
                strokeOpacity=".18"
              />
              <rect
                x="88"
                y="286"
                width="56"
                height="50"
                rx="8"
                fill="#ffffff"
                fillOpacity=".05"
                stroke="#ffffff"
                strokeOpacity=".18"
              />
              <rect
                x="154"
                y="302"
                width="42"
                height="34"
                rx="7"
                fill="#ffffff"
                fillOpacity=".05"
                stroke="#ffffff"
                strokeOpacity=".18"
              />

              <path
                d="M304 370v-58a58 58 0 0 1 58 58Z"
                fill="#d2f78e"
                fillOpacity=".09"
                stroke="#d2f78e"
                strokeOpacity=".4"
                strokeWidth="1.2"
              />
              <path
                className="home-route"
                d="M128 250c0 52 24 82 84 84s80-8 96-18"
                fill="none"
                stroke="url(#home-route)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="1 13"
              />

              <circle cx="128" cy="250" r="19" fill="#d2f78e" fillOpacity=".12" />
              <circle cx="128" cy="250" r="7.5" fill="#d2f78e" />
              <circle
                className="home-target"
                cx="304"
                cy="316"
                r="17"
                fill="none"
                stroke="#d2f78e"
                strokeOpacity=".55"
              />
              <circle
                cx="304"
                cy="316"
                r="6.5"
                fill="none"
                stroke="#d2f78e"
                strokeWidth="2"
              />
            </svg>

            <span className="home-scanline" />
            <span className="home-chip home-chip-live">
              <i />
              Live scan
            </span>
            <span className="home-chip home-chip-step">Step 2 of 4</span>
            <span className="home-chip home-chip-quote">
              <Mic size={12} />
              <span className="home-bars">
                <i />
                <i />
                <i />
                <i />
              </span>
              Clear a path to the door
            </span>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <span>Built for the room you are standing in.</span>
        <a
          href="https://github.com/thiago-monteiro/sorty"
          target="_blank"
          rel="noreferrer"
        >
          github.com/thiago-monteiro/sorty
        </a>
      </footer>
    </main>
  );
}
