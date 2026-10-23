"use client";
// Web Speech API (Chrome only) → live transcript with a timestamp per word.
// OWNER: Person 1
import { useCallback, useEffect, useRef, useState } from "react";
import type { WordStamp } from "@/lib/types";

export function useSpeech() {
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const words = useRef<WordStamp[]>([]);
  const finalText = useRef("");
  const rec = useRef<any>(null);

  // Checked after mount so server and client render the same first frame
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported("webkitSpeechRecognition" in window || "SpeechRecognition" in window), []);

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    words.current = [];
    finalText.current = "";
    setTranscript("");
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText.current += t + " ";
        else interim += t;
      }
      const full = (finalText.current + interim).trim();
      // Stamp each newly seen word with "now" (interim results arrive ~word by word)
      const ws = full.split(/\s+/).filter(Boolean);
      const now = Date.now();
      for (let i = words.current.length; i < ws.length; i++) words.current.push({ w: ws[i], t: now });
      setTranscript(full);
    };
    r.onend = () => {
      // Chrome stops after silence; restart while we still want to listen
      if (rec.current === r) try { r.start(); } catch {}
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    r?.stop();
    setListening(false);
    return { transcript: (finalText.current || transcript).trim(), words: [...words.current] };
  }, [transcript]);

  /** Replay mode: feed a scripted answer word by word at a given speed. */
  const replay = useCallback((text: string, delayMs: number, wpm: number, onDone: (t: string, w: WordStamp[]) => void) => {
    const ws = text.split(/\s+/);
    const gap = 60000 / wpm;
    words.current = [];
    setTranscript("");
    setListening(true);
    let i = 0;
    const tick = () => {
      if (i >= ws.length) {
        setListening(false);
        onDone(text, [...words.current]);
        return;
      }
      words.current.push({ w: ws[i], t: Date.now() });
      setTranscript(ws.slice(0, ++i).join(" "));
      setTimeout(tick, gap * (0.85 + Math.random() * 0.3));
    };
    setTimeout(tick, delayMs);
  }, []);

  return { supported, transcript, listening, start, stop, replay, setTranscript };
}
