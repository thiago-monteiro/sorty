import { solveRoom } from "./index";
import type { Room, Settings } from "../domain/types";

self.onmessage = (event: MessageEvent<{ room: Room; settings: Settings }>) => {
  try {
    self.postMessage({
      result: solveRoom(event.data.room, event.data.settings),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Planning failed.",
    });
  }
};
