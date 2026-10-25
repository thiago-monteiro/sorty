import { useEffect, useRef, useState } from "react";

import BrowserRecognition, {
  browserRecognitionSupported,
} from "./BrowserRecognition";
import LocalRecognition, { localSpeechSupported } from "./LocalRecognition";

export default function useVoice(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const recognition = useRef<
    BrowserRecognition | LocalRecognition | null
  >(null);
  const wanted = useRef(false),
    speakingRef = useRef(false),
    alive = useRef(true),
    restart = useRef<ReturnType<typeof setTimeout> | null>(null),
    speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = useRef(onTranscript);
  const utteranceGeneration = useRef(0);
  callback.current = onTranscript;
  const supported = browserRecognitionSupported() || localSpeechSupported();
  const clearSpeechTimer = () => {
    if (speechTimer.current) clearTimeout(speechTimer.current);
    speechTimer.current = null;
  };

  const startRecognition = () => {
    if (
      !alive.current ||
      !wanted.current ||
      speakingRef.current ||
      !recognition.current
    )
      return;
    try {
      recognition.current.start();
    } catch {
      /* An existing recognition session may still be ending. */
    }
  };
  const schedule = (delay = 350) => {
    if (restart.current) clearTimeout(restart.current);
    restart.current = setTimeout(startRecognition, delay);
  };
  useEffect(() => {
    alive.current = true;
    // Browser recognition handles accents far better than tiny Whisper and
    // needs no audio round trip. Local Whisper is only for browsers without it.
    const Engine = browserRecognitionSupported()
      ? BrowserRecognition
      : localSpeechSupported()
        ? LocalRecognition
        : null;
    if (Engine) {
      const r = new Engine();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = false;
      r.onresult = (e) => {
        if (!wanted.current || speakingRef.current) return;
        for (let i = e.resultIndex; i < e.results.length; i++)
          if (e.results[i].isFinal)
            callback.current(e.results[i][0].transcript);
      };
      r.onerror = (e) => {
        if (e.error === "aborted" || e.error === "no-speech") return;
        const fatal = [
          "not-allowed",
          "service-not-allowed",
          "audio-capture",
          "network",
        ].includes(e.error);
        setError(
          e.error === "not-allowed"
            ? "Microphone access was denied. Enable it in browser settings or use the controls."
            : e.error === "network"
              ? "Speech connection interrupted. Tap the microphone to retry."
              : e.error === "service-not-allowed"
                ? "Speech input is unavailable. Tap the microphone to retry."
                : "Microphone unavailable. Check its permission.",
        );
        if (fatal) {
          wanted.current = false;
          setEnabled(false);
          setListening(false);
        }
      };
      r.onend = () => {
        if (!alive.current) return;
        setListening(false);
        if (wanted.current && !speakingRef.current) schedule();
      };
      // onstart is not in the minimal interface, but is supported by browser implementations.
      r.onstart = () => {
        if (alive.current) setListening(true);
      };
      recognition.current = r;
    }
    return () => {
      alive.current = false;
      wanted.current = false;
      if (restart.current) clearTimeout(restart.current);
      clearSpeechTimer();
      const r = recognition.current;
      if (r) {
        r.onend = null;
        r.onresult = null;
        r.onerror = null;
        r.abort();
      }
      recognition.current = null;
      window.speechSynthesis?.cancel();
    };
  }, []);

  function toggle() {
    setError("");
    wanted.current = !wanted.current;
    setEnabled(wanted.current);
    if (wanted.current) {
      // Tapping the mic means "listen now". Some Android TTS engines never fire
      // end/error, so never let a stale utterance hold recognition off.
      utteranceGeneration.current++;
      clearSpeechTimer();
      window.speechSynthesis?.cancel();
      speakingRef.current = false;
      setSpeaking(false);
      startRecognition();
    } else {
      recognition.current?.abort();
      setListening(false);
    }
  }
  function silence() {
    utteranceGeneration.current++;
    clearSpeechTimer();
    window.speechSynthesis?.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    if (wanted.current) schedule(450);
  }
  function speak(text: string) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setError("Spoken output is unavailable. Instructions remain on screen.");
      return;
    }
    const generation = ++utteranceGeneration.current;
    window.speechSynthesis.cancel();
    clearSpeechTimer();
    speakingRef.current = true;
    setSpeaking(true);
    recognition.current?.abort();
    setListening(false);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    const voices = window.speechSynthesis.getVoices();
    const voice =
      voices.find(
        (v) =>
          v.lang === "en-US" &&
          /Natural|Google|Aria|Jenny|Samantha/.test(v.name),
      ) || voices.find((v) => v.lang === "en-US");
    if (voice) utterance.voice = voice;
    const finish = () => {
      clearSpeechTimer();
      if (!alive.current || generation !== utteranceGeneration.current) return;
      speakingRef.current = false;
      setSpeaking(false);
      // A short quiet window avoids recognizing the end of the app's own output.
      if (wanted.current) schedule(700);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
      return;
    }
    // Some engines (notably Android Google voices) report speaking forever and
    // never fire end/error. Unblock recognition after a generous reading budget.
    speechTimer.current = setTimeout(
      finish,
      Math.min(30000, Math.max(6000, text.length * 110)),
    );
  }
  return {
    listening,
    speaking,
    enabled,
    supported,
    error,
    toggle,
    speak,
    silence,
  };
}
