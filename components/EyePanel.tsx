// Small eye-tracking box in the Live Room: video, face-mesh dots, gaze direction.
// OWNER: Person 3
"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { EyeTracker, type GazeMode, type GazeQuality, type GazeSample } from "@/lib/eyes";
import { ClipRecorder, PENDING_CLIP, snapshot } from "@/lib/clips";
import { useStore } from "@/lib/store";
import type { GazeWindow } from "@/lib/types";

export interface EyePanelHandle {
  window: (questionId: string, from: number, to: number, isBaseline: boolean) => GazeWindow | null;
  /** Sync: snapshot now; clipUrl is a "pending:" token that EyePanel swaps for the real clip on the flag once it's ready. */
  capture: () => { clipUrl?: string; snapshot?: string };
}

type Box = { x0: number; y0: number; x1: number; y1: number };

// `stream` (optional): the shared Zoom call (Person 1's useCallCapture). When given, tracking runs on the
// candidate's face in the call, the source buttons are hidden, and we never stop its tracks (the call owns them).
export const EyePanel = forwardRef<EyePanelHandle, { emphasize: boolean; stream?: MediaStream | null }>(function EyePanel({ emphasize, stream: shared }, ref) {
  const { update } = useStore();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef<EyeTracker | null>(null);
  const recorder = useRef(new ClipRecorder());
  const stream = useRef<MediaStream | null>(null);
  const faceBox = useRef<Box | undefined>();
  const lastUi = useRef(0);
  const [status, setStatus] = useState<"off" | "loading" | "on" | "error">("off");
  const [source, setSource] = useState<"webcam" | "screen" | "call">("webcam");
  const [mode, setMode] = useState<GazeMode>("auto");
  const [ui, setUi] = useState<{ off: boolean; offCam: boolean; used: "gaze" | "head"; q: GazeQuality | null; face: boolean }>({ off: false, offCam: false, used: "gaze", q: null, face: false });
  const hotspot = useRef<ReturnType<EyeTracker["liveHotspot"]>>(null);
  const [error, setError] = useState("");

  useImperativeHandle(ref, () => ({
    window: (qid, from, to, base) => (tracker.current && status === "on" ? tracker.current.window(qid, from, to, base) : null),
    capture: () => {
      if (status !== "on") return {};
      const token = `${PENDING_CLIP}${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      recorder.current.clip().then((url) =>
        update((s) => ({ ...s, flags: s.flags.map((f) => (f.clipUrl === token ? { ...f, clipUrl: url } : f)) })),
      );
      return { clipUrl: token, snapshot: video.current ? snapshot(video.current, faceBox.current) : undefined };
    },
  }), [status, update]);

  useEffect(() => {
    if (tracker.current) tracker.current.mode = mode;
  }, [mode]);

  // Follow the shared call: start when it connects, stop when it goes away
  useEffect(() => {
    if (shared) begin(shared);
    else if (source === "call") { shutdown(); setStatus("off"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  // Stop camera / screen share when leaving the Live Room
  useEffect(() => () => shutdown(), []);

  function shutdown() {
    tracker.current?.stop();
    recorder.current.stop();
    if (stream.current && stream.current !== shared) stream.current.getTracks().forEach((t) => t.stop());
    tracker.current = null;
    stream.current = null;
  }

  async function begin(src: "webcam" | "screen" | MediaStream) {
    try {
      shutdown();
      setError("");
      setStatus("loading");
      const isCall = src instanceof MediaStream;
      setSource(isCall ? "call" : src);
      const s = isCall ? src : src === "webcam" ? await EyeTracker.webcam() : await EyeTracker.screen();
      stream.current = s;
      if (!isCall) s.getVideoTracks()[0]?.addEventListener("ended", () => { shutdown(); setStatus("off"); });
      video.current!.srcObject = s;
      await video.current!.play();
      const t = new EyeTracker();
      t.mode = mode;
      await t.init();
      t.onSample = (smp, lm) => {
        faceBox.current = lm ? bbox(lm) : faceBox.current;
        draw(t, smp, lm);
        const now = performance.now();
        if (now - lastUi.current > 250) {
          lastUi.current = now;
          setUi({ off: t.isOff(smp), offCam: t.isOffCamera(smp), used: t.effectiveMode(), q: t.quality(), face: smp.face });
          hotspot.current = t.liveHotspot();
        }
      };
      t.start(video.current!);
      tracker.current = t;
      recorder.current.start(s);
      setStatus("on");
    } catch (e) {
      console.error(e);
      shutdown();
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function draw(t: EyeTracker, smp: GazeSample, lm: { x: number; y: number }[] | null) {
    const c = canvas.current, v = video.current;
    if (!c || !v || !v.videoWidth) return;
    // Canvas matches the displayed (object-contain) video rect
    const scale = Math.min(v.clientWidth / v.videoWidth, v.clientHeight / v.videoHeight);
    const w = v.videoWidth * scale, h = v.videoHeight * scale, ox = (v.clientWidth - w) / 2, oy = (v.clientHeight - h) / 2;
    if (c.width !== v.clientWidth || c.height !== v.clientHeight) { c.width = v.clientWidth; c.height = v.clientHeight; }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!lm) return;
    ctx.fillStyle = "rgba(129,140,248,0.55)";
    for (let i = 0; i < 468; i += 4) ctx.fillRect(ox + lm[i].x * w, oy + lm[i].y * h, 1.5, 1.5);
    ctx.fillStyle = "#f43f5e";
    [468, 473].forEach((i) => { ctx.beginPath(); ctx.arc(ox + lm[i].x * w, oy + lm[i].y * h, 2.5, 0, 7); ctx.fill(); });

    // Gaze dot inside a mini "screen", relative to the candidate's own centre. Drawn in frame
    // coordinates like the mesh, so the CSS mirror flips both together; the box lands top-right.
    const { dx, dy } = t.relative(smp);
    const bw = 64, bh = 40, bx = source === "webcam" ? 6 : c.width - bw - 6, by = 6;
    ctx.strokeStyle = "rgba(148,163,184,0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    // Camera / "talking to you" point, and the spot they keep going back to (last 30 s)
    ctx.strokeStyle = "rgba(148,163,184,0.5)";
    ctx.beginPath();
    ctx.moveTo(bx + bw / 2 - 4, by + bh / 2); ctx.lineTo(bx + bw / 2 + 4, by + bh / 2);
    ctx.moveTo(bx + bw / 2, by + bh / 2 - 4); ctx.lineTo(bx + bw / 2, by + bh / 2 + 4);
    ctx.stroke();
    const hs = hotspot.current;
    if (hs && hs.visits >= 3) {
      // hotspot dx is from the candidate's view (their right = +) → back to frame coordinates
      ctx.strokeStyle = "#f97316";
      ctx.beginPath();
      ctx.arc(bx + bw / 2 - hs.dx * (bw / 2), by + bh / 2 + hs.dy * (bh / 2), 6, 0, 7);
      ctx.stroke();
    }
    const off = t.isOff(smp) || t.isOffCamera(smp);
    const gx = bx + bw / 2 + dx * (bw / 2 + 6);
    const gy = by + bh / 2 + dy * (bh / 2 + 6);
    ctx.fillStyle = off ? "#f97316" : "#22c55e";
    ctx.beginPath();
    ctx.arc(Math.max(bx - 6, Math.min(bx + bw + 6, gx)), Math.max(by - 6, Math.min(by + bh + 6, gy)), 4, 0, 7);
    ctx.fill();
  }

  const mirrored = source === "webcam";
  const q = ui.q;

  return (
    <div className={`card space-y-2 ${emphasize ? "ring-2 ring-watch/60" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="label">Eye patterns</span>
        <span className={`text-xs ${status !== "on" ? "text-slate-400" : !ui.face ? "text-slate-400" : ui.off ? "text-warn" : ui.offCam ? "text-watch" : "text-clear"}`}>
          {status === "on" ? (!ui.face ? "No face found" : ui.off ? "Looking away" : ui.offCam ? "Looking elsewhere on screen" : "Looking at you") : status === "loading" ? "Loading model…" : status === "error" ? "Couldn't start" : "Off"}
        </span>
      </div>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video ref={video} muted playsInline className={`h-full w-full object-contain ${mirrored ? "-scale-x-100" : ""}`} />
        <canvas ref={canvas} className={`pointer-events-none absolute inset-0 h-full w-full ${mirrored ? "-scale-x-100" : ""}`} />
      </div>
      {status === "on" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span title="Gaze = iris direction. Head pose = only where the head points (used automatically when the face is too small or the iris too noisy).">
            Using <b className="text-slate-200">{ui.used === "gaze" ? "eye gaze" : "head pose"}</b>
          </span>
          {q && <span className="tabular-nums">· eye {Math.round(q.eyePx)}px · face {Math.round(q.faceRate * 100)}%</span>}
          <select className="ml-auto rounded border border-slate-700 bg-slate-950 px-1 py-0.5" value={mode} onChange={(e) => setMode(e.target.value as GazeMode)}>
            <option value="auto">Auto</option>
            <option value="gaze">Force gaze</option>
            <option value="head">Head pose only</option>
          </select>
          {source !== "call" && <button className="rounded border border-slate-700 px-1.5 py-0.5 hover:bg-slate-800" onClick={() => { shutdown(); setStatus("off"); }}>Stop</button>}
        </div>
      )}
      {status === "on" && source !== "webcam" && <p className="text-[11px] text-slate-500">Tip: Zoom speaker view keeps the candidate's face big enough for gaze.</p>}
      {status !== "on" && !shared && (
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" disabled={status === "loading"} onClick={() => begin("webcam")}>Use webcam</button>
          <button className="btn-ghost text-xs" disabled={status === "loading"} onClick={() => begin("screen")}>Capture Zoom window</button>
        </div>
      )}
      {error && <p className="text-xs text-warn">{error}</p>}
    </div>
  );
});

function bbox(lm: { x: number; y: number }[]): Box {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of lm) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}
