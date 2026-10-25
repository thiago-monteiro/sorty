import type { Plan, Room, Settings } from "../domain/types";

export function solveRoomAsync(room: Room, settings: Settings): Promise<Plan> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          "Planning exceeded its time budget. Try fewer objects or review room dimensions.",
        ),
      );
    }, 8000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (
      event: MessageEvent<{ result?: Plan; error?: string }>,
    ) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else
        reject(
          new Error(event.data.error || "The planner returned no result."),
        );
    };
    worker.onerror = (event) => {
      finish();
      reject(
        new Error(event.message || "The planning worker could not start."),
      );
    };
    worker.postMessage({ room, settings });
  });
}
