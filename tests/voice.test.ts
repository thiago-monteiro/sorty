import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import useVoice from "../src/guidance/useVoice";

function globals(dom: JSDOM) {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const set = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  };
  set("window", dom.window);
  set("document", dom.window.document);
  set("navigator", dom.window.navigator);
  set("IS_REACT_ACT_ENVIRONMENT", true);
  return {
    set,
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

async function harness(dom: JSDOM) {
  let voice: ReturnType<typeof useVoice> | undefined;
  const transcripts: string[] = [];
  function Harness() {
    voice = useVoice((text) => transcripts.push(text));
    return null;
  }
  const root = createRoot(dom.window.document.getElementById("app")!);
  await act(async () => {
    root.render(React.createElement(Harness));
  });
  return {
    voice: () => voice!,
    transcripts,
    unmount: () => act(async () => root.unmount()),
  };
}

test("browser speech recognition is the primary engine and needs no audio upload", async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: "https://sorty.test" });
  const { set, restore } = globals(dom);
  let audioRequests = 0;
  set("fetch", async () => {
    audioRequests++;
    return Response.json({ text: "whisper" });
  });
  const languages: string[] = [];
  class Recognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onstart: (() => void) | null = null;
    onresult:
      | ((event: {
          resultIndex: number;
          results: {
            [index: number]: {
              isFinal: boolean;
              [index: number]: { transcript: string };
            };
            length: number;
          };
        }) => void)
      | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      languages.push(this.lang);
      this.onstart?.();
      this.onresult?.({
        resultIndex: 0,
        results: {
          0: { isFinal: true, 0: { transcript: "move the chair" } },
          length: 1,
        },
      });
      this.onend?.();
    }
    abort() {}
    stop() {}
  }
  Object.assign(dom.window, { webkitSpeechRecognition: Recognition });
  const app = await harness(dom);
  try {
    assert.equal(app.voice().supported, true);
    await act(async () => {
      app.voice().toggle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(languages, ["en-US"]);
    assert.deepEqual(app.transcripts, ["move the chair"]);
    assert.equal(audioRequests, 0, "Chrome recognition must not upload audio");
    assert.equal(app.voice().enabled, true);
  } finally {
    await app.unmount();
    restore();
  }
});

test("local Whisper is used when the browser has no speech recognizer", async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: "https://sorty.test" });
  const { set, restore } = globals(dom);
  let audioRequests = 0;
  const processor = {
    connect() {},
    disconnect() {},
    onaudioprocess: null as
      | null
      | ((event: {
          inputBuffer: { getChannelData: () => Float32Array };
        }) => void),
  };
  set("fetch", async (input: unknown, init: RequestInit) => {
    assert.equal(input, "/api/speech");
    audioRequests++;
    const body = JSON.parse(String(init.body));
    assert.equal(
      Buffer.from(body.audio, "base64").toString("ascii", 0, 4),
      "RIFF",
    );
    return Response.json({ text: "done" });
  });
  let stopped = 0;
  Object.assign(dom.window, {
    AudioContext: class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createScriptProcessor() {
        return processor;
      }
      createGain() {
        return { gain: { value: 1 }, connect() {}, disconnect() {} };
      }
    },
    speechSynthesis: { cancel() {} },
  });
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    value: {
      getUserMedia: async () => ({
        getTracks: () => [
          {
            stop() {
              stopped++;
            },
          },
        ],
      }),
    },
  });
  const app = await harness(dom);
  try {
    await act(async () => {
      app.voice().toggle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(app.voice().listening, true);
    await act(async () => {
      const feed = (level: number) =>
        processor.onaudioprocess?.({
          inputBuffer: {
            getChannelData: () => new Float32Array(4096).fill(level),
          },
        });
      for (let i = 0; i < 5; i++) feed(0.1);
      for (let i = 0; i < 11; i++) feed(0);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(audioRequests, 1);
    assert.deepEqual(app.transcripts, ["done"]);
  } finally {
    await app.unmount();
    restore();
  }
  assert.ok(stopped > 0, "Unmount must release the microphone");
});
