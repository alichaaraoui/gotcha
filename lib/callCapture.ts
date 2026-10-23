"use client";
// Captures the Zoom call (a Chrome tab running Zoom's web client) instead of the laptop mic:
// video → shown in the panel + eye tracking; tab audio → only the OTHER people on the call, i.e. the candidate.
// Audio is cut into ~3.5s files and transcribed by /api/transcribe, so the transcript is the candidate's words.
// OWNER: Person 1
import { useCallback, useRef, useState } from "react";
import type { WordStamp } from "@/lib/types";

const CHUNK_MS = 3500;

export function useCallCapture() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string>();
  const words = useRef<WordStamp[]>([]);
  const markAt = useRef<number | null>(null); // start of the current answer
  const running = useRef(false);

  const refresh = () => {
    const from = markAt.current;
    setTranscript(from == null ? "" : words.current.filter((x) => x.t >= from).map((x) => x.w).join(" "));
  };

  const transcribe = async (blob: Blob, startedAt: number) => {
    const form = new FormData();
    form.append("audio", blob);
    form.append("startedAt", String(startedAt));
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (data.error === "no-key") return setError("Add GROQ_API_KEY to .env.local to transcribe the call.");
      if (data.error) return setError("Transcription hiccup, retrying…");
      setError(undefined);
      words.current = [...words.current, ...data.words].sort((a, b) => a.t - b.t);
      refresh();
    } catch {
      setError("Transcription hiccup, retrying…");
    }
  };

  // A fresh MediaRecorder per chunk, so every chunk is a complete, decodable file
  const loop = (audio: MediaStream) => {
    if (!running.current) return;
    const rec = new MediaRecorder(audio, { mimeType: "audio/webm" });
    const startedAt = Date.now();
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      transcribe(new Blob(parts, { type: "audio/webm" }), startedAt);
      loop(audio);
    };
    rec.start();
    setTimeout(() => rec.state === "recording" && rec.stop(), CHUNK_MS);
  };

  /** Ask Chrome for the Zoom tab, with its audio. */
  const connect = useCallback(async () => {
    setError(undefined);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints, // keep hearing the call yourself
        // @ts-expect-error Chrome-only hints: offer tabs first, include tab audio
        preferCurrentTab: false, selfBrowserSurface: "exclude", surfaceSwitching: "include", systemAudio: "include",
      });
      const audioTracks = s.getAudioTracks();
      setStream(s);
      setHasAudio(audioTracks.length > 0);
      if (!audioTracks.length) setError('No call audio. Share the Zoom TAB and tick "Also share tab audio".');
      s.getVideoTracks()[0]?.addEventListener("ended", () => disconnect());
      if (audioTracks.length) {
        running.current = true;
        loop(new MediaStream(audioTracks));
      }
    } catch {
      setError("Sharing was cancelled.");
    }
  }, []);

  const disconnect = useCallback(() => {
    running.current = false;
    setStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setHasAudio(false);
  }, []);

  /** Recruiter tapped "I asked it": the answer starts now. */
  const startAnswer = useCallback((at: number) => {
    markAt.current = at;
    refresh();
  }, []);

  /** Recruiter tapped "They finished": wait for the last chunk, then return the answer's words. */
  const endAnswer = useCallback(async (): Promise<{ transcript: string; words: WordStamp[] }> => {
    const from = markAt.current ?? 0;
    await new Promise((r) => setTimeout(r, CHUNK_MS + 1200)); // let the in-flight chunk come back
    markAt.current = null;
    const ws = words.current.filter((x) => x.t >= from);
    return { transcript: ws.map((x) => x.w).join(" "), words: ws };
  }, []);

  return { stream, hasAudio, connected: !!stream, transcript, error, connect, disconnect, startAnswer, endAnswer };
}
