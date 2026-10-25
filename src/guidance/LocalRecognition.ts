import { encodeWav, UtteranceSegmenter } from "./audio";

export type ResultEvent = {
  resultIndex: number;
  results: {
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string };
    };
    length: number;
  };
};
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };
export function localSpeechSupported() {
  return (
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof (
      window.AudioContext || (window as AudioWindow).webkitAudioContext
    ) === "function"
  );
}

/** Same lifecycle as SpeechRecognition, backed by microphone PCM and local Whisper. */
export default class LocalRecognition {
  lang = "en-US";
  continuous = true;
  interimResults = false;
  onresult: ((event: ResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  private active = false;
  private generation = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private request: AbortController | null = null;
  private sending = false;
  private segmenter = new UtteranceSegmenter();
  start() {
    if (this.active) throw new Error("Already listening");
    this.active = true;
    const generation = ++this.generation;
    try {
      const Constructor =
        window.AudioContext || (window as AudioWindow).webkitAudioContext!;
      const context = new Constructor();
      this.context = context;
      // Resume within the microphone button's user gesture (required on phones).
      const resumed = context.resume();
      void resumed.catch(() => {});
      void this.open(generation, context, resumed);
    } catch {
      this.fail("audio-capture");
    }
  }
  private async open(
    generation: number,
    context: AudioContext,
    resumed: Promise<void>,
  ) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!this.active || generation !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      await resumed;
      if (!this.active || generation !== this.generation) return;
      this.source = context.createMediaStreamSource(stream);
      this.processor = context.createScriptProcessor(4096, 1, 1);
      this.gain = context.createGain();
      this.gain.gain.value = 0;
      this.processor.onaudioprocess = (event) => {
        if (!this.active || this.sending || generation !== this.generation)
          return;
        const samples = this.segmenter.push(
          event.inputBuffer.getChannelData(0),
          context.sampleRate,
        );
        if (samples)
          void this.transcribe(samples, context.sampleRate, generation);
      };
      this.source.connect(this.processor);
      this.processor.connect(this.gain);
      this.gain.connect(context.destination);
      this.onstart?.();
    } catch (error) {
      if (this.active && generation === this.generation)
        this.fail(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "not-allowed"
            : "audio-capture",
        );
    }
  }
  private async transcribe(
    samples: Float32Array,
    rate: number,
    generation: number,
  ) {
    this.sending = true;
    const controller = new AbortController();
    this.request = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const bytes = new Uint8Array(encodeWav(samples, rate));
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: btoa(binary) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Transcription unavailable");
      const result = (await response.json()) as { text?: string };
      if (
        this.active &&
        generation === this.generation &&
        typeof result.text === "string" &&
        result.text.trim()
      )
        this.onresult?.({
          resultIndex: 0,
          results: {
            0: { isFinal: true, 0: { transcript: result.text.trim() } },
            length: 1,
          },
        });
    } catch {
      if (this.active && generation === this.generation)
        this.fail("service-not-allowed");
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) {
        this.sending = false;
        this.request = null;
        this.segmenter.reset();
      }
    }
  }
  private fail(error: string) {
    this.onerror?.({ error });
    this.abort();
  }
  abort() {
    const wasActive = this.active;
    this.active = false;
    this.generation++;
    this.sending = false;
    this.request?.abort();
    this.request = null;
    this.segmenter.reset();
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.gain?.disconnect();
    this.gain = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    if (wasActive) this.onend?.();
  }
}
