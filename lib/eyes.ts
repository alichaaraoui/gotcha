"use client";
// Eye-pattern recognition with MediaPipe FaceLandmarker (iris landmarks), all in the browser.
// Video source: webcam OR a screen capture of the Zoom window (candidate's tile).
// OWNER: Person 3
//
// GO/NO-GO: the tracker self-checks gaze quality (face found, eye size in pixels, iris jitter).
// If gaze isn't reliable it automatically falls back to head pose only: offScreenPct from
// yaw/pitch, readingSweeps = 0. The EyePanel lets you force either mode.
//
// Left/right in sideBias is from the CANDIDATE's point of view (their right = +1).
//
// Off-camera spots: besides looking off the screen, we catch looking at ANOTHER POINT ON the screen
// (a second window, a phone propped by the monitor). Gaze resting >= 250 ms is a fixation; fixations
// clearly away from where they look while talking to you are grouped into spots, and the spot they
// keep going back to is the hotspot. "Where they look while talking to you" is locked in during the
// warm-up so someone reading most of the time can't drag the reference onto their notes.
import type { GazeHotspot, GazeWindow } from "@/lib/types";

// Served locally first (works offline; see scripts/copy-mediapipe.mjs), CDN as a fallback.
const SOURCES = [
  { wasm: "/mediapipe/wasm", model: "/mediapipe/face_landmarker.task" },
  {
    wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    model: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  },
];

// Landmark indexes (478-point mesh with irises). Coordinates are of the UNMIRRORED frame.
const L = {
  irisL: 468, irisR: 473, lOuter: 33, lInner: 133, rInner: 362, rOuter: 263,
  lTop: 159, lBot: 145, rTop: 386, rBot: 374, nose: 1, cheekL: 234, cheekR: 454, forehead: 10, chin: 152,
};

export type GazeMode = "auto" | "gaze" | "head";

export interface GazeSample {
  t: number;
  x: number; // horizontal iris position inside the eye, 0 = image-left corner, 1 = image-right corner
  y: number; // vertical iris position, 0 = top lid, 1 = bottom lid
  yaw: number; // head turn, -0.5..0.5 (image-left negative)
  pitch: number; // head tilt, bigger = looking down
  blink: boolean;
  face: boolean;
  eyePx: number; // eye width in video pixels (small = iris unreliable)
}

export interface GazeQuality {
  faceRate: number; // share of recent frames with a face
  eyePx: number; // median eye width in pixels
  jitter: number; // median frame-to-frame iris movement
  gazeReliable: boolean;
}

// TODO(P3): tune these on your own face before the demo. All relative to the candidate's own centre.
export const TH = {
  x: 0.11, // iris left/right beyond this = looking off-screen
  yDown: 0.2, // iris down (notes, phone)
  yUp: 0.25,
  yaw: 0.1, // head turned away
  pitchDown: 0.08, // head tilted down
  minEyePx: 16, // below this the iris landmarks are mostly noise
  maxJitter: 0.03,
  minFaceRate: 0.6,
  sweepMinAmp: 0.05, // a reading line moves the iris at least this much
  sweepMinMs: 300,
  sweepMaxMs: 4000,
  sweepReturnMs: 400, // the "line return" has to be quick
  // Off-camera spots, in units where 1 = the off-screen threshold (TH.x sideways, TH.yDown vertically)
  camR: 0.35, // further than this from their normal point = not looking at you
  fixR: 0.2, // gaze stays within this radius = one fixation
  fixMinMs: 250,
  spotR: 0.3, // fixations this close are the same spot
};

export class EyeTracker {
  private landmarker: any = null;
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private samples: GazeSample[] = [];
  private prev: GazeSample | null = null;
  private blinkOn = false;
  private base = { n: 0, off: 0, sweeps: 0, side: 0, blinks: 0, offCam: 0 };
  private baseCentre: { n: number; x: number; y: number; yaw: number; pitch: number } | null = null;
  mode: GazeMode = "auto";
  onSample?: (s: GazeSample, landmarks: { x: number; y: number }[] | null) => void;

  async init() {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    let lastErr: unknown;
    for (const src of SOURCES) {
      for (const delegate of ["GPU", "CPU"] as const) {
        try {
          const fileset = await FilesetResolver.forVisionTasks(src.wasm);
          this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: src.model, delegate },
            runningMode: "VIDEO",
            numFaces: 3, // Zoom gallery: we keep the largest face
            outputFaceBlendshapes: true,
          });
          return;
        } catch (e) {
          lastErr = e;
        }
      }
    }
    throw lastErr;
  }

  static async webcam(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  }
  /** Pick the Zoom window; the tracker follows the largest face in it (use speaker view). */
  static async screen(): Promise<MediaStream> {
    return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  }

  start(video: HTMLVideoElement) {
    this.running = true;
    let last = -1;
    const loop = () => {
      if (!this.running) return;
      if (this.landmarker && video.readyState >= 2 && video.currentTime !== last) {
        last = video.currentTime;
        try {
          this.process(video);
        } catch (e) {
          console.warn("face landmarker", e);
        }
      }
      // rAF stops when the tab is hidden (recruiter is on Zoom): keep ticking with a timer then.
      if (document.hidden) this.timer = setTimeout(loop, 66);
      else this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
  }

  private process(video: HTMLVideoElement) {
    const r = this.landmarker.detectForVideo(video, performance.now());
    // Largest face = widest eyes (the candidate's tile, not the recruiter's self-view)
    let best = -1, bestW = 0;
    (r.faceLandmarks ?? []).forEach((lm: { x: number }[], i: number) => {
      const w = Math.abs(lm[L.lInner].x - lm[L.lOuter].x);
      if (w > bestW) { bestW = w; best = i; }
    });
    const lm = best >= 0 ? r.faceLandmarks[best] : null;
    const now = Date.now();
    let s: GazeSample;
    if (lm) {
      const raw = toSample(lm, video.videoWidth, r.faceBlendshapes?.[best], this.blinkOn, now);
      this.blinkOn = raw.blink;
      // Light smoothing (iris landmarks jitter); skip it across blinks and lost frames
      const p = this.prev;
      const a = 0.55;
      s = p && p.face && !raw.blink && !p.blink && now - p.t < 200
        ? { ...raw, x: p.x + a * (raw.x - p.x), y: p.y + a * (raw.y - p.y), yaw: p.yaw + a * (raw.yaw - p.yaw), pitch: p.pitch + a * (raw.pitch - p.pitch) }
        : raw;
    } else {
      s = { t: now, x: 0.5, y: 0.5, yaw: 0, pitch: 0, blink: false, face: false, eyePx: 0 };
    }
    this.prev = s;
    this.samples.push(s);
    if (this.samples.length > 4000) this.samples.splice(0, this.samples.length - 4000);
    this.onSample?.(s, lm);
  }

  /** Gaze quality over the last few seconds; drives the automatic head-pose fallback. */
  quality(ms = 5000): GazeQuality {
    return gazeQuality(this.samples.filter((s) => s.t >= Date.now() - ms));
  }

  /** Which mode is actually used right now. */
  effectiveMode(): "gaze" | "head" {
    if (this.mode !== "auto") return this.mode;
    return this.quality().gazeReliable ? "gaze" : "head";
  }

  /** Reference point: the warm-up centre once we have one, else the rolling median. */
  centre() {
    return this.baseCentre ?? centre(this.samples);
  }

  /** Is this sample off-screen? (for the live indicator) */
  isOff(s: GazeSample): boolean {
    return offScreen(s, this.centre(), this.effectiveMode());
  }

  /** On screen but resting away from the camera / interviewer (gaze mode only). */
  isOffCamera(s: GazeSample): boolean {
    if (this.effectiveMode() !== "gaze" || !s.face || s.blink) return false;
    const e = norm(s, this.centre());
    return Math.hypot(e.ex, e.ey) >= TH.camR && !this.isOff(s);
  }

  /** The off-camera spot of the last `ms` (for the live overlay). */
  liveHotspot(ms = 30000): GazeHotspot | null {
    if (this.effectiveMode() !== "gaze") return null;
    const s = this.samples.filter((x) => x.t >= Date.now() - ms);
    return offCamera(s, this.centre(), ms).hotspot;
  }

  /** Where the candidate is looking relative to their own centre, roughly -1..1 (for the gaze dot). */
  relative(s: GazeSample): { dx: number; dy: number } {
    const c = this.centre();
    const head = this.effectiveMode() === "head";
    const dx = head ? (s.yaw - c.yaw) / (TH.yaw * 2) : (s.x - c.x) / (TH.x * 2) + (s.yaw - c.yaw) / (TH.yaw * 4);
    const dy = head ? (s.pitch - c.pitch) / (TH.pitchDown * 2) : (s.y - c.y) / (TH.yDown * 2);
    return { dx: Math.max(-1, Math.min(1, dx)), dy: Math.max(-1, Math.min(1, dy)) };
  }

  /** Summarize samples between two timestamps into a GazeWindow. */
  window(questionId: string, from: number, to: number, isBaseline = false): GazeWindow {
    const s = this.samples.filter((x) => x.t >= from && x.t <= to);
    if (isBaseline && s.length > 30) {
      // Lock the "talking to you" point from the warm-up answers (running mean of their medians)
      const c = centre(s);
      const b = this.baseCentre, k = (b?.n ?? 0) + 1;
      this.baseCentre = b
        ? { n: k, x: b.x + (c.x - b.x) / k, y: b.y + (c.y - b.y) / k, yaw: b.yaw + (c.yaw - b.yaw) / k, pitch: b.pitch + (c.pitch - b.pitch) / k }
        : { n: 1, ...c };
    }
    const mode = this.effectiveMode();
    const m = summarize(s, this.centre(), mode, to - from);
    if (isBaseline) {
      // Running mean over the warm-up answers
      const b = this.base;
      const k = b.n + 1;
      this.base = { n: k, off: b.off + (m.off - b.off) / k, sweeps: b.sweeps + (m.sweeps - b.sweeps) / k, side: b.side + (m.side - b.side) / k, blinks: b.blinks + (m.blinks - b.blinks) / k, offCam: b.offCam + (m.offCam - b.offCam) / k };
    }
    const b = this.base;
    const baselineDelta = b.n
      ? Math.min(1,
          Math.abs(m.off - b.off) * 1.5 +
          Math.max(0, m.sweeps - b.sweeps) / 10 +
          Math.abs(m.side - b.side) * 0.5 +
          Math.max(0, m.offCam - b.offCam) * 1.2 +
          Math.min(0.3, (Math.abs(m.blinks - b.blinks) / Math.max(8, b.blinks)) * 0.3))
      : 0;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    const hotspot = m.hotspot && { dx: r2(m.hotspot.dx), dy: r2(m.hotspot.dy), visits: m.hotspot.visits, dwellPct: r2(m.hotspot.dwellPct) };
    return { questionId, offScreenPct: r2(m.off), readingSweeps: r2(m.sweeps), sideBias: r2(m.side), blinkRate: r2(m.blinks), baselineDelta: r2(baselineDelta), offCameraPct: r2(m.offCam), hotspot };
  }
}

// ---------- Pure helpers (exported for tests) ----------

function toSample(lm: { x: number; y: number }[], videoW: number, blend: { categories: { categoryName: string; score: number }[] } | undefined, wasBlinking: boolean, t: number): GazeSample {
  // Horizontal iris position inside each eye, 0 = image-left corner, averaged over both eyes
  const lx = (lm[L.irisL].x - lm[L.lOuter].x) / nz(lm[L.lInner].x - lm[L.lOuter].x);
  const rx = (lm[L.irisR].x - lm[L.rInner].x) / nz(lm[L.rOuter].x - lm[L.rInner].x);
  const ly = (lm[L.irisL].y - lm[L.lTop].y) / nz(lm[L.lBot].y - lm[L.lTop].y);
  const ry = (lm[L.irisR].y - lm[L.rTop].y) / nz(lm[L.rBot].y - lm[L.rTop].y);
  // Head yaw: nose between the cheeks (-0.5..0.5). Pitch: nose between forehead and chin.
  const yaw = (lm[L.nose].x - lm[L.cheekL].x) / nz(lm[L.cheekR].x - lm[L.cheekL].x) - 0.5;
  const pitch = (lm[L.nose].y - lm[L.forehead].y) / nz(lm[L.chin].y - lm[L.forehead].y);
  const blinkScore = blend?.categories.filter((c) => c.categoryName.startsWith("eyeBlink")).reduce((a, c) => Math.max(a, c.score), 0) ?? 0;
  const blink = wasBlinking ? blinkScore > 0.35 : blinkScore > 0.5; // hysteresis
  const eyePx = Math.abs(lm[L.lInner].x - lm[L.lOuter].x) * videoW;
  return { t, x: (lx + rx) / 2, y: (ly + ry) / 2, yaw, pitch, blink, face: true, eyePx };
}

const nz = (d: number) => (Math.abs(d) < 0.001 ? 0.001 : d);

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((p, q) => p - q);
  return a[Math.floor(a.length / 2)];
}

/** The candidate's own "looking at the screen" position: median over recent frames (people mostly look at the screen). */
export function centre(samples: GazeSample[]) {
  const s = samples.filter((x) => x.face && !x.blink).slice(-900); // ~30s
  if (s.length < 15) return { x: 0.5, y: 0.5, yaw: 0, pitch: 0.55 };
  return { x: median(s.map((x) => x.x)), y: median(s.map((x) => x.y)), yaw: median(s.map((x) => x.yaw)), pitch: median(s.map((x) => x.pitch)) };
}

export function offScreen(s: GazeSample, c: ReturnType<typeof centre>, mode: "gaze" | "head"): boolean {
  if (!s.face) return true;
  const head = Math.abs(s.yaw - c.yaw) > TH.yaw || s.pitch - c.pitch > TH.pitchDown;
  if (mode === "head" || s.blink) return head;
  const dx = s.x - c.x, dy = s.y - c.y;
  return head || Math.abs(dx) > TH.x || dy > TH.yDown || dy < -TH.yUp;
}

export function gazeQuality(s: GazeSample[]): GazeQuality {
  const faces = s.filter((x) => x.face);
  const open = faces.filter((x) => !x.blink);
  const moves: number[] = [];
  for (let i = 1; i < open.length; i++) if (open[i].t - open[i - 1].t < 150) moves.push(Math.abs(open[i].x - open[i - 1].x));
  const faceRate = s.length ? faces.length / s.length : 0;
  const eyePx = median(faces.map((x) => x.eyePx));
  const jitter = median(moves);
  return { faceRate, eyePx, jitter, gazeReliable: s.length > 10 && faceRate >= TH.minFaceRate && eyePx >= TH.minEyePx && jitter <= TH.maxJitter };
}

/** Raw per-window numbers: off-screen share, reading sweeps/min, side bias, blinks/min. */
export function summarize(s: GazeSample[], c: ReturnType<typeof centre>, mode: "gaze" | "head", durMs: number) {
  const n = Math.max(1, s.length);
  const mins = Math.max(0.05, durMs / 60000);
  const offFlags = s.map((x) => offScreen(x, c, mode));
  const off = offFlags.filter(Boolean).length / n;
  const open = s.filter((x) => x.face && !x.blink);
  const sweeps = mode === "gaze" ? Math.max(countSweeps(open, 1), countSweeps(open, -1)) / mins : 0;
  const cam = mode === "gaze" ? offCamera(s, c, durMs) : { pct: 0, hotspot: null };
  return { off, sweeps, side: sideBias(s, offFlags, c, mode), blinks: countBlinks(s) / mins, offCam: cam.pct, hotspot: cam.hotspot };
}

/** Gaze offset from their normal point, scaled so 1 = the off-screen threshold. */
function norm(s: GazeSample, c: ReturnType<typeof centre>) {
  return { ex: (s.x - c.x) / TH.x, ey: (s.y - c.y) / TH.yDown };
}

interface Fixation { ex: number; ey: number; t0: number; t1: number }

/** Runs of open-eye samples whose gaze stays within TH.fixR of their running mean for >= TH.fixMinMs. */
export function fixations(s: GazeSample[], c: ReturnType<typeof centre>): Fixation[] {
  const out: Fixation[] = [];
  let run: { ex: number; ey: number; n: number; t0: number; t1: number } | null = null;
  const close = () => {
    if (run && run.t1 - run.t0 >= TH.fixMinMs) out.push({ ex: run.ex, ey: run.ey, t0: run.t0, t1: run.t1 });
    run = null;
  };
  for (const x of s) {
    if (!x.face || x.blink) continue; // a blink doesn't end a fixation
    const e = norm(x, c);
    if (run && Math.hypot(e.ex - run.ex, e.ey - run.ey) <= TH.fixR && x.t - run.t1 < 300) {
      run.n++;
      run.ex += (e.ex - run.ex) / run.n;
      run.ey += (e.ey - run.ey) / run.n;
      run.t1 = x.t;
    } else {
      close();
      run = { ex: e.ex, ey: e.ey, n: 1, t0: x.t, t1: x.t };
    }
  }
  close();
  return out;
}

/**
 * Time spent resting on other points of the screen, and the spot they kept returning to.
 * A "visit" only counts after looking somewhere else (back at you, or another spot) in between.
 */
export function offCamera(s: GazeSample[], c: ReturnType<typeof centre>, durMs: number): { pct: number; hotspot: GazeHotspot | null } {
  const fx = fixations(s, c);
  const spots: { ex: number; ey: number; dwell: number; visits: number }[] = [];
  let last = -2; // -1 = looking at you, k = spot k
  for (const f of fx) {
    const r = Math.hypot(f.ex, f.ey);
    if (r < TH.camR) { last = -1; continue; }
    if (r > 2.5) continue; // way off the screen: offScreenPct already covers it
    let k = spots.findIndex((p) => Math.hypot(p.ex - f.ex, p.ey - f.ey) <= TH.spotR);
    if (k < 0) { spots.push({ ex: f.ex, ey: f.ey, dwell: 0, visits: 0 }); k = spots.length - 1; }
    const p = spots[k], d = f.t1 - f.t0;
    p.ex += ((f.ex - p.ex) * d) / (p.dwell + d);
    p.ey += ((f.ey - p.ey) * d) / (p.dwell + d);
    p.dwell += d;
    if (last !== k) p.visits++;
    last = k;
  }
  const dur = Math.max(1, durMs);
  const pct = Math.min(1, spots.reduce((a, p) => a + p.dwell, 0) / dur);
  const top = [...spots].sort((a, b) => b.visits - a.visits || b.dwell - a.dwell)[0];
  if (!top || top.visits < 2) return { pct, hotspot: null };
  // Image-left = candidate's right, so flip dx; scale so ±1 ≈ the screen edge
  return { pct, hotspot: { dx: -top.ex, dy: top.ey, visits: top.visits, dwellPct: Math.min(1, top.dwell / dur) } };
}

/**
 * Reading = gaze drifts steadily one way across a line, then snaps back quickly (line return).
 * Counted in both directions and the larger one wins, so a mirrored feed still works.
 */
export function countSweeps(s: GazeSample[], dir: 1 | -1): number {
  let n = 0;
  let i = 0;
  while (i < s.length - 1) {
    // Follow a slow drift in `dir` starting at i, tolerating small noise
    const startX = dir * s[i].x, startT = s[i].t;
    let peak = startX, peakT = startT, j = i + 1;
    for (; j < s.length; j++) {
      const x = dir * s[j].x;
      if (x > peak) { peak = x; peakT = s[j].t; }
      else if (x < peak - 0.02) break; // turning back
      if (s[j].t - startT > TH.sweepMaxMs) break;
    }
    const amp = peak - startX, dur = peakT - startT;
    if (j < s.length && amp >= TH.sweepMinAmp && amp <= 0.6 && dur >= TH.sweepMinMs && dur <= TH.sweepMaxMs) {
      // Quick return: most of the way back within sweepReturnMs
      let k = j;
      while (k < s.length && s[k].t - peakT <= TH.sweepReturnMs && dir * s[k].x > peak - 0.6 * amp) k++;
      if (k < s.length && s[k].t - peakT <= TH.sweepReturnMs) {
        n++;
        i = k;
        continue;
      }
    }
    i = Math.max(i + 1, j - 1);
  }
  return n;
}

/** Repeated glances to the same side: (right − left) / glances, damped until there are ~3 glances. */
export function sideBias(s: GazeSample[], offFlags: boolean[], c: ReturnType<typeof centre>, mode: "gaze" | "head"): number {
  let right = 0, left = 0;
  let i = 0;
  while (i < s.length) {
    if (!offFlags[i] || !s[i].face) { i++; continue; }
    let j = i, sum = 0;
    while (j < s.length && offFlags[j] && s[j].face) {
      // Image-left = candidate's right, so flip the sign
      sum += -((mode === "gaze" ? s[j].x - c.x : 0) + (s[j].yaw - c.yaw));
      j++;
    }
    if (s[j - 1].t - s[i].t >= 250 && Math.abs(sum) > 0) sum > 0 ? right++ : left++;
    i = j;
  }
  const total = right + left;
  if (!total) return 0;
  return ((right - left) / total) * Math.min(1, total / 3);
}

export function countBlinks(s: GazeSample[]): number {
  let n = 0, lastT = -Infinity;
  for (let i = 1; i < s.length; i++) {
    if (s[i].blink && !s[i - 1].blink && s[i].t - lastT > 150) { n++; lastT = s[i].t; }
  }
  return n;
}
