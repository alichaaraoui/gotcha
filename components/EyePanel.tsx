// Small eye-tracking box in the Live Room: video, face-mesh dots, gaze direction.
// OWNER: Person 3
"use client";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { EyeTracker } from "@/lib/eyes";
import { ClipRecorder, snapshot } from "@/lib/clips";
import type { GazeWindow } from "@/lib/types";

export interface EyePanelHandle {
  window: (questionId: string, from: number, to: number, isBaseline: boolean) => GazeWindow | null;
  capture: () => { clipUrl?: string; snapshot?: string };
}

export const EyePanel = forwardRef<EyePanelHandle, { emphasize: boolean }>(function EyePanel({ emphasize }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef<EyeTracker | null>(null);
  const recorder = useRef(new ClipRecorder());
  const [status, setStatus] = useState<"off" | "loading" | "on" | "error">("off");
  const [gaze, setGaze] = useState({ x: 0.5, off: false });

  useImperativeHandle(ref, () => ({
    window: (qid, from, to, base) => (tracker.current && status === "on" ? tracker.current.window(qid, from, to, base) : null),
    capture: () => ({ clipUrl: recorder.current.clip(), snapshot: video.current ? snapshot(video.current) : undefined }),
  }), [status]);

  async function begin(source: "webcam" | "screen") {
    try {
      setStatus("loading");
      const stream = source === "webcam" ? await EyeTracker.webcam() : await EyeTracker.screen();
      video.current!.srcObject = stream;
      await video.current!.play();
      const t = new EyeTracker();
      await t.init();
      t.onSample = (s, lm) => {
        setGaze({ x: s.x, off: !s.face || Math.abs(s.yaw) > 0.12 || s.x < 0.3 || s.x > 0.7 });
        draw(lm);
      };
      t.start(video.current!);
      tracker.current = t;
      recorder.current.start(stream);
      setStatus("on");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  function draw(lm: { x: number; y: number }[] | null) {
    const c = canvas.current, v = video.current;
    if (!c || !v) return;
    c.width = v.clientWidth;
    c.height = v.clientHeight;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!lm) return;
    ctx.fillStyle = "rgba(129,140,248,0.6)";
    for (let i = 0; i < lm.length; i += 6) ctx.fillRect(lm[i].x * c.width, lm[i].y * c.height, 1.5, 1.5);
    ctx.fillStyle = "#f43f5e";
    [468, 473].forEach((i) => { ctx.beginPath(); ctx.arc(lm[i].x * c.width, lm[i].y * c.height, 3, 0, 7); ctx.fill(); });
  }

  return (
    <div className={`card space-y-2 ${emphasize ? "ring-2 ring-watch/60" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="label">Eye patterns</span>
        <span className={`text-xs ${gaze.off ? "text-warn" : "text-clear"}`}>{status === "on" ? (gaze.off ? "Looking away" : "On screen") : status}</span>
      </div>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video ref={video} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
        <canvas ref={canvas} className="pointer-events-none absolute inset-0 -scale-x-100" />
        {status === "on" && <div className="absolute bottom-1 h-1 w-full bg-slate-800"><div className="h-1 w-2 bg-indigo-400" style={{ marginLeft: `${(1 - gaze.x) * 100}%` }} /></div>}
      </div>
      {status !== "on" && (
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={() => begin("webcam")}>Use webcam</button>
          <button className="btn-ghost text-xs" onClick={() => begin("screen")}>Capture Zoom window</button>
        </div>
      )}
    </div>
  );
});
