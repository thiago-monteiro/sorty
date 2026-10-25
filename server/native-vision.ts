import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let starting: Promise<void> | null = null;

/** Recover the already-installed local model without making the user operate a server. */
export function startInstalledVision(): Promise<void> {
  if (starting) return starting;
  const installed = [
    "SmolVLM-256M-Instruct-Q8_0.gguf",
    "mmproj-SmolVLM-256M-Instruct-Q8_0.gguf",
  ].every((name) => existsSync(resolve(".runtime/models", name)));
  if (
    process.platform !== "win32" ||
    !installed ||
    process.env.AUTO_START_VISION === "0"
  )
    return Promise.resolve();
  starting = new Promise<void>((resolveStart) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve("scripts/setup-native-vision.ps1"),
      ],
      { windowsHide: true, detached: true, stdio: "ignore" },
    );
    child.on("error", () => resolveStart());
    child.unref();
    const deadline = Date.now() + 25000;
    async function probe() {
      try {
        const response = await fetch("http://127.0.0.1:1234/v1/models", {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          const result = (await response.json()) as { data?: { id: string }[] };
          if (result.data?.some((model) => model.id === "sorty-smolvlm")) {
            resolveStart();
            return;
          }
        }
      } catch {
        /* Model may still be loading. */
      }
      if (Date.now() >= deadline) resolveStart();
      else setTimeout(() => void probe(), 350);
    }
    void probe();
  }).finally(() => {
    starting = null;
  });
  return starting;
}
