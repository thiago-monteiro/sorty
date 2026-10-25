import type { ResultEvent } from "./LocalRecognition";

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: ResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  abort(): void;
  stop(): void;
};
type RecognitionConstructor = new () => BrowserSpeechRecognition;
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

function constructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const speech = window as SpeechWindow;
  return speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
}

export function browserRecognitionSupported(): boolean {
  return !!constructor();
}

/**
 * The browser's own speech recognizer. Chrome/Safari send the audio to their
 * speech service, which handles accents far better than tiny local models.
 */
export default class BrowserRecognition {
  lang = "en-US";
  continuous = true;
  interimResults = false;
  onresult: ((event: ResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  private recognition: BrowserSpeechRecognition | null = null;
  private active = false;

  start() {
    if (this.active) throw new Error("Already listening");
    const Ctor = constructor();
    if (!Ctor) throw new Error("Speech recognition unavailable");
    this.active = true;
    const recognition = new Ctor();
    this.recognition = recognition;
    recognition.lang = this.lang;
    recognition.continuous = this.continuous;
    recognition.interimResults = this.interimResults;
    recognition.onstart = () => {
      if (this.active) this.onstart?.();
    };
    recognition.onresult = (event) => {
      if (this.active) this.onresult?.(event);
    };
    recognition.onerror = (event) => {
      // Keep the session active: the browser fires end after errors, and that
      // is what lets the hook restart after "no-speech".
      if (this.active) this.onerror?.({ error: event.error });
    };
    recognition.onend = () => {
      if (!this.active) return;
      this.active = false;
      this.recognition = null;
      this.onend?.();
    };
    try {
      recognition.start();
    } catch (error) {
      this.active = false;
      this.recognition = null;
      throw error;
    }
  }

  abort() {
    const wasActive = this.active;
    this.active = false;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        /* Chrome can throw if the session already ended. */
      }
    }
    if (wasActive) this.onend?.();
  }
}
