"use client";
// Hears the CANDIDATE, not the recruiter. Two ways in:
//  • Zoom desktop app: Zoom's speaker output → virtual audio cable (BlackHole / VB-CABLE) → picked here as an input.
//    Works in any browser. The Zoom window can be shared separately for video + eye tracking.
//  • Zoom in a browser tab: share that tab with "Also share tab audio" (Chrome / Edge only).
// Either way the audio is cut into ~5s files and transcribed by /api/transcribe (Groq Whisper).
// OWNER: Person 1
import { useCallback, useRef, useState } from "react";
import type { WordStamp } from "@/lib/types";

const CHUNK_MS = 5000; // ~12 requests/min: comfortable on Groq's free plan
const VIRTUAL = /blackhole|vb-?cable|cable output|loopback|soundflower|zoomaudio/i;

export interface AudioInput { deviceId: string; label: string; virtual: boolean }

export function useCallCapture() {
  const [video, setVideo] = useState<MediaStream | null>(null);
  const [audioLabel, setAudioLabel] = useState<string | null>(null); // what we're listening to
  const [inputs, setInputs] = useState<AudioInput[]>([]);
  const [transcript, setTranscript] = useState("");
  const [heard, setHeard] = useState(false); // got words back at least once
  const [error, setError] = useState<string>();
  const words = useRef<WordStamp[]>([]);
  const chunks = useRef<{ startedAt: number; words: WordStamp[] }[]>([]);
  const markAt = useRef<number | null>(null); // start of the current answer
  const audioStream = useRef<MediaStream | null>(null);
  const running = useRef(false);

  const answerWords = (from: number) => words.current.filter((x) => x.t >= from - 300);

  const refresh = () => {
    const from = markAt.current;
    setTranscript(from == null ? "" : answerWords(from).map((x) => x.w).join(" "));
  };

  const transcribe = async (blob: Blob, startedAt: number) => {
    const form = new FormData();
    form.append("audio", blob);
    form.append("startedAt", String(startedAt));
    try {
      const data = await fetch("/api/transcribe", { method: "POST", body: form }).then((r) => r.json());
      if (data.error === "no-key") return setError("Add your Groq key to .env.local, then restart the app.");
      if (data.error) return setError("Transcription hiccup, retrying…");
      setError(undefined);
      if (data.words.length) setHeard(true);
      // Chunks can come back out of order; keep each chunk's own word order, slot chunks by start time
      chunks.current = [...chunks.current.filter((c) => c.startedAt !== startedAt), { startedAt, words: data.words }].sort((x, y) => x.startedAt - y.startedAt);
      words.current = chunks.current.flatMap((c) => c.words);
      refresh();
    } catch {
      setError("Transcription hiccup, retrying…");
    }
  };

  // A fresh MediaRecorder per chunk, so every chunk is a complete, decodable file
  const loop = (audio: MediaStream) => {
    if (!running.current || audioStream.current !== audio) return;
    const rec = new MediaRecorder(audio);
    const startedAt = Date.now();
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      transcribe(new Blob(parts, { type: rec.mimeType || "audio/webm" }), startedAt);
      loop(audio);
    };
    rec.start();
    setTimeout(() => rec.state === "recording" && rec.stop(), CHUNK_MS);
  };

  const listenTo = (audio: MediaStream, label: string) => {
    audioStream.current?.getTracks().forEach((t) => t.stop());
    audioStream.current = audio;
    running.current = true;
    setAudioLabel(label);
    setHeard(false);
    loop(audio);
  };

  /** List audio inputs; virtual cables (BlackHole etc.) first. Labels need mic permission once. */
  const loadInputs = useCallback(async () => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      const all = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "Audio input", virtual: VIRTUAL.test(d.label) }))
        .sort((a, b) => Number(b.virtual) - Number(a.virtual));
      setInputs(all);
      return all;
    } catch {
      setError("Allow microphone access so GotCha can list your audio inputs.");
      return [];
    }
  }, []);

  /** Zoom desktop app: listen to the virtual cable Zoom is playing into. Raw audio, no voice processing. */
  const useInput = useCallback(async (deviceId: string) => {
    setError(undefined);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const label = s.getAudioTracks()[0]?.label ?? "Audio input";
      if (!VIRTUAL.test(label)) setError("Heads-up: this looks like a real microphone, so it will hear you too. Pick BlackHole for the candidate only.");
      listenTo(s, label);
    } catch {
      setError("Couldn't open that audio input.");
    }
  }, []);

  /** Share the Zoom window (desktop app) or the Zoom tab (browser). A tab can also bring its audio. */
  const shareCall = useCallback(async () => {
    setError(undefined);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints, // keep hearing the call yourself
        // @ts-expect-error Chrome-only hints
        selfBrowserSurface: "exclude", surfaceSwitching: "include", systemAudio: "include",
      });
      setVideo(s);
      s.getVideoTracks()[0]?.addEventListener("ended", () => setVideo(null));
      const tabAudio = s.getAudioTracks();
      if (tabAudio.length) listenTo(new MediaStream(tabAudio), "Zoom tab audio");
    } catch {
      setError("Sharing was cancelled.");
    }
  }, []);

  const disconnect = useCallback(() => {
    running.current = false;
    audioStream.current?.getTracks().forEach((t) => t.stop());
    audioStream.current = null;
    setVideo((v) => {
      v?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setAudioLabel(null);
    setHeard(false);
  }, []);

  /** Recruiter tapped "I asked it": the answer starts now. */
  const startAnswer = useCallback((at: number) => {
    markAt.current = at;
    refresh();
  }, []);

  /** Recruiter tapped "They finished": wait for the last chunk, then return the answer's words. */
  const endAnswer = useCallback(async (): Promise<{ transcript: string; words: WordStamp[] }> => {
    const from = markAt.current ?? 0;
    await new Promise((r) => setTimeout(r, CHUNK_MS + 1500)); // let the in-flight chunk come back
    markAt.current = null;
    const ws = answerWords(from);
    return { transcript: ws.map((x) => x.w).join(" "), words: ws };
  }, []);

  return {
    video, audioLabel, listening: !!audioLabel, heard, inputs, transcript, error,
    loadInputs, useInput, shareCall, disconnect, startAnswer, endAnswer,
  };
}
