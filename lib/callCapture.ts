"use client";
// Hears the CANDIDATE, not the recruiter: the recruiter shares the browser tab running Zoom with
// "Also share tab audio". Tab audio only contains the other people on the call (Chrome / Edge).
// Video → the panel + eye tracking. Audio → ~5s files transcribed by /api/transcribe (Groq Whisper).
// OWNER: Person 1
import { useCallback, useRef, useState } from "react";
import type { WordStamp } from "@/lib/types";

const CHUNK_MS = 5000; // ~12 requests/min: comfortable on Groq's free plan

export function useCallCapture() {
  const [video, setVideo] = useState<MediaStream | null>(null);
  const [audioLabel, setAudioLabel] = useState<string | null>(null); // what we're listening to
  const [transcript, setTranscript] = useState("");
  const [heard, setHeard] = useState(false); // got words back at least once
  const [error, setError] = useState<string>();
  const words = useRef<WordStamp[]>([]);
  const chunks = useRef<{ startedAt: number; words: WordStamp[] }[]>([]);
  const markAt = useRef<number | null>(null); // start of the current answer
  const audioStream = useRef<MediaStream | null>(null); // the shared tab's audio
  const recordStream = useRef<MediaStream | null>(null); // Web Audio copy we actually record
  const audioCtx = useRef<AudioContext | null>(null);
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
  const loop = (audio: MediaStream, failures = 0) => {
    if (!running.current || recordStream.current !== audio) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(audio);
      rec.start();
    } catch (e) {
      // Never crash the page over a recorder hiccup: retry a few times, then explain
      console.error("recorder failed", e);
      if (failures < 5) setTimeout(() => loop(audio, failures + 1), 400);
      else setError("Couldn't record the call audio. Click Disconnect and share the tab again.");
      return;
    }
    const startedAt = Date.now();
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      transcribe(new Blob(parts, { type: rec.mimeType || "audio/webm" }), startedAt);
      loop(audio);
    };
    setTimeout(() => rec.state === "recording" && rec.stop(), CHUNK_MS);
  };

  const listenTo = (audio: MediaStream, label: string) => {
    stopAudio();
    // Chrome won't reliably record a shared tab's audio track directly, so pass it through
    // Web Audio and record that copy. (Not connected to the speakers: no double playback.)
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(audio).connect(dest);
    audioCtx.current = ctx;
    audioStream.current = audio;
    recordStream.current = dest.stream;
    running.current = true;
    setAudioLabel(label);
    setHeard(false);
    loop(dest.stream);
  };

  const stopAudio = () => {
    running.current = false;
    audioStream.current?.getTracks().forEach((t) => t.stop());
    audioCtx.current?.close().catch(() => {});
    audioStream.current = recordStream.current = audioCtx.current = null;
  };

  /** Share the Zoom tab; its audio is the candidate. */
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
      else setError('No sound came with that share. Pick the Zoom TAB (not a window) and keep "Also share tab audio" on.');
    } catch (e) {
      // Say what actually went wrong instead of a generic "cancelled"
      const err = e as DOMException;
      console.error("share failed", err.name, err.message);
      setError(
        err.name === "NotAllowedError" && /system/i.test(err.message)
          ? "macOS is blocking Chrome from capturing the screen. Pick a Chrome Tab instead (no permission needed), or allow Chrome in System Settings → Privacy & Security → Screen & System Audio Recording, then restart Chrome."
          : err.name === "NotAllowedError"
            ? "Sharing didn't start. In Chrome's popup choose the Chrome Tab with the call, then click Share."
            : `Sharing failed (${err.name}): ${err.message}`
      );
    }
  }, []);

  const disconnect = useCallback(() => {
    stopAudio();
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
    video, audioLabel, listening: !!audioLabel, heard, transcript, error,
    shareCall, disconnect, startAnswer, endAnswer,
  };
}
