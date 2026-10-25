import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, ExternalLink, Smartphone, X } from "lucide-react";

export default function PhoneConnect({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState(
    location.protocol === "https:" ? location.origin : "",
  );
  const [qr, setQr] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/connection.json", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const parsed = new URL(d.url);
        if (parsed.protocol === "https:") setUrl(parsed.origin);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let active = true;
    if (url)
      QRCode.toDataURL(url, {
        width: 240,
        margin: 2,
        color: { dark: "#26352e", light: "#fbfcf6" },
        errorCorrectionLevel: "M",
      }).then((data) => {
        if (active) setQr(data);
      });
    return () => {
      active = false;
    };
  }, [url]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal phone-connect"
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span className="eyebrow">YOUR ROOM, IN THE REAL WORLD</span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close Android connection"
          >
            <X size={20} />
          </button>
        </header>
        <div className="phone-symbol">
          <Smartphone size={26} />
        </div>
        <h2 id="phone-title">Meet your space on Android.</h2>
        <p>
          Open in Chrome on an ARCore-compatible Android phone. Your phone
          measures the room; your laptop runs the optional vision model.
        </p>
        {qr && (
          <img
            className="phone-qr"
            src={qr}
            alt={`QR code to open Sorty at ${url}`}
            width="240"
            height="240"
          />
        )}
        {url ? (
          <>
            <a
              className="phone-url"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {url} <ExternalLink size={14} />
            </a>
            <button
              className="secondary phone-copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
              {copied ? "Link copied" : "Copy phone link"}
            </button>
            <p className="field-note">
              Temporary demo link. Keep this laptop and tunnel running. Anyone
              with the link can open the app.
            </p>
          </>
        ) : (
          <div className="phone-setup">
            <p>Start a secure phone link from the project terminal:</p>
            <code>powershell -File scripts/start-android.ps1</code>
            <p>
              Or connect by USB with Android debugging enabled, run{" "}
              <code>adb reverse tcp:5173 tcp:5173</code>, and open{" "}
              <code>http://localhost:5173</code> on your phone.
            </p>
          </div>
        )}
        <ol className="phone-checklist">
          <li>Allow AR and camera access when Chrome asks.</li>
          <li>Choose a recognizable floor corner and wall direction.</li>
          <li>Scan the room, then confirm the obstacles you captured.</li>
        </ol>
        <p className="field-note">
          The sample and your room are separate. Scans are saved in the browser
          where you made them.
        </p>
      </section>
    </div>
  );
}
