"use client";
// Eye-pattern recognition with MediaPipe FaceLandmarker (iris landmarks), all in the browser.
// Video source: webcam OR a screen capture of the Zoom window (candidate's tile).
// OWNER: Person 3
// TODO(P3): GO/NO-GO at 1:00. Tune thresholds on a real webcam; if gaze is unreliable,
// fall back to head yaw only (offScreenPct) and keep readingSweeps = 0.
import type { GazeWindow } from "@/lib/types";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Landmark indexes (478-point mesh with irises)
const L = { irisL: 468, irisR: 473, lOuter: 33, lInner: 133, rInner: 362, rOuter: 263, lTop: 159, lBot: 145, nose: 1, cheekL: 234, cheekR: 454 };

export interface GazeSample { t: number; x: number; y: number; yaw: number; blink: boolean; face: boolean }

export class EyeTracker {
  private landmarker: any = null;
  private raf = 0;
  private samples: GazeSample[] = [];
  private baseline: { off: number; sweeps: number; side: number } | null = null;
  onSample?: (s: GazeSample, landmarks: { x: number; y: number }[] | null) => void;

  async init() {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
  }

  static async webcam(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
  }
  /** Pick the Zoom window; the tracker finds the (largest) face in it. */
  static async screen(): Promise<MediaStream> {
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  }

  start(video: HTMLVideoElement) {
    let last = -1;
    const loop = () => {
      if (this.landmarker && video.readyState >= 2 && video.currentTime !== last) {
        last = video.currentTime;
        const r = this.landmarker.detectForVideo(video, performance.now());
        const lm = r.faceLandmarks?.[0];
        const sample = lm ? toSample(lm, r.faceBlendshapes?.[0]) : { t: Date.now(), x: 0.5, y: 0.5, yaw: 0, blink: false, face: false };
        this.samples.push(sample);
        if (this.samples.length > 3000) this.samples.shift();
        this.onSample?.(sample, lm ?? null);
      }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  /** Summarize samples between two timestamps into a GazeWindow. */
  window(questionId: string, from: number, to: number, isBaseline = false): GazeWindow {
    const s = this.samples.filter((x) => x.t >= from && x.t <= to);
    const n = Math.max(1, s.length);
    const mins = Math.max(0.05, (to - from) / 60000);
    const off = s.filter(isOffScreen).length / n;
    const side = s.reduce((a, x) => a + (isOffScreen(x) ? Math.sign(x.x - 0.5 + x.yaw) : 0), 0) / n;
    const sweeps = countSweeps(s) / mins;
    const blinks = countBlinks(s) / mins;

    if (isBaseline) {
      // Running average over warm-up answers
      const b = this.baseline;
      this.baseline = b ? { off: (b.off + off) / 2, sweeps: (b.sweeps + sweeps) / 2, side: (b.side + side) / 2 } : { off, sweeps, side };
    }
    const b = this.baseline;
    const baselineDelta = b ? Math.min(1, Math.abs(off - b.off) * 1.5 + Math.max(0, sweeps - b.sweeps) / 10 + Math.abs(side - b.side) * 0.5) : 0;
    return { questionId, offScreenPct: off, readingSweeps: sweeps, sideBias: side, blinkRate: blinks, baselineDelta };
  }
}

function toSample(lm: { x: number; y: number }[], blend?: { categories: { categoryName: string; score: number }[] }): GazeSample {
  // Horizontal iris position inside each eye (0 = outer corner, 1 = inner), averaged
  const lx = (lm[L.irisL].x - lm[L.lOuter].x) / (lm[L.lInner].x - lm[L.lOuter].x);
  const rx = (lm[L.irisR].x - lm[L.rInner].x) / (lm[L.rOuter].x - lm[L.rInner].x);
  const y = (lm[L.irisL].y - lm[L.lTop].y) / Math.max(0.001, lm[L.lBot].y - lm[L.lTop].y);
  // Head yaw: nose position between the cheeks (-0.5..0.5)
  const yaw = (lm[L.nose].x - lm[L.cheekL].x) / Math.max(0.001, lm[L.cheekR].x - lm[L.cheekL].x) - 0.5;
  const blinkScore = blend?.categories.filter((c) => c.categoryName.startsWith("eyeBlink")).reduce((a, c) => Math.max(a, c.score), 0) ?? 0;
  return { t: Date.now(), x: (lx + rx) / 2, y, yaw, blink: blinkScore > 0.5, face: true };
}

// TODO(P3): tune these on your own face before the demo
const isOffScreen = (s: GazeSample) => !s.face || Math.abs(s.yaw) > 0.12 || s.x < 0.3 || s.x > 0.7 || s.y > 0.85;

/** Reading = gaze drifts steadily one way then snaps back (like line returns). */
function countSweeps(s: GazeSample[]): number {
  let sweeps = 0, drift = 0;
  for (let i = 1; i < s.length; i++) {
    const dx = s[i].x - s[i - 1].x;
    if (dx > 0.002 && dx < 0.03) drift += dx;
    else if (dx < -0.06 && drift > 0.12) { sweeps++; drift = 0; }
    else if (Math.abs(dx) > 0.03) drift = 0;
  }
  return sweeps;
}

function countBlinks(s: GazeSample[]): number {
  let n = 0;
  for (let i = 1; i < s.length; i++) if (s[i].blink && !s[i - 1].blink) n++;
  return n;
}
