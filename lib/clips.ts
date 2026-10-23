"use client";
// Rolling ~10-second video buffer + frame snapshots, captured when a red flag fires.
// OWNER: Person 3
//
// Gluing the webm header onto the last few timeslice chunks doesn't play reliably (Chrome rarely
// emits keyframes, so the tail can't be decoded). Instead two recorders run staggered and each
// restarts every PERIOD: at any moment one of them has been recording for 10–20 s. On a flag we
// stop that one, which yields a complete, standalone webm ending "now", and restart it.

/** Placeholder clipUrl on a flag until the recorder flushes (EyePanel swaps in the real URL). */
export const PENDING_CLIP = "pending:";

const PERIOD = 20000;
const MIN_CLIP = 10000;

interface Slot {
  rec: MediaRecorder | null;
  startedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  want?: (url: string | undefined) => void;
}

export class ClipRecorder {
  private stream: MediaStream | null = null;
  private slots: Slot[] = [];
  private mime = "";

  start(stream: MediaStream) {
    if (typeof MediaRecorder === "undefined") return; // snapshots still work
    this.stream = stream;
    this.mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    this.slots = [{ rec: null, startedAt: 0 }, { rec: null, startedAt: 0 }];
    this.run(this.slots[0]);
    // Second recorder starts half a period later
    this.slots[1].timer = setTimeout(() => this.run(this.slots[1]), PERIOD / 2);
  }

  private run(slot: Slot) {
    if (!this.stream) return;
    clearTimeout(slot.timer);
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, { mimeType: this.mime || undefined, videoBitsPerSecond: 1_200_000 });
    } catch {
      return;
    }
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      const want = slot.want;
      slot.want = undefined;
      if (want) want(parts.length ? URL.createObjectURL(new Blob(parts, { type: rec.mimeType || "video/webm" })) : undefined);
      if (this.stream && slot.rec === rec) this.run(slot); // keep rolling
    };
    rec.start();
    slot.rec = rec;
    slot.startedAt = Date.now();
    slot.timer = setTimeout(() => rec.state === "recording" && rec.stop(), PERIOD);
  }

  /** Object URL of the last ~10–20 seconds (a complete webm). Resolves once the recorder flushes. */
  clip(): Promise<string | undefined> {
    const live = this.slots.filter((s) => s.rec?.state === "recording" && !s.want);
    if (!live.length) return Promise.resolve(undefined);
    // Prefer the one that already has >= 10 s, else the longest-running one
    const slot = live.find((s) => Date.now() - s.startedAt >= MIN_CLIP) ?? live.sort((a, b) => a.startedAt - b.startedAt)[0];
    return new Promise((resolve) => {
      slot.want = resolve;
      clearTimeout(slot.timer);
      slot.rec!.stop();
    });
  }

  stop() {
    const slots = this.slots;
    this.stream = null;
    this.slots = [];
    for (const s of slots) {
      clearTimeout(s.timer);
      if (s.rec?.state === "recording") s.rec.stop();
    }
  }
}

/** JPEG frame, cropped around the face when we know where it is (Zoom captures are mostly not face). */
export function snapshot(video: HTMLVideoElement, face?: { x0: number; y0: number; x1: number; y1: number }): string | undefined {
  if (!video.videoWidth) return;
  const W = video.videoWidth, H = video.videoHeight;
  let sx = 0, sy = 0, sw = W, sh = H;
  if (face) {
    // Face box (normalized) padded to a 4:3 head-and-shoulders crop
    const cx = ((face.x0 + face.x1) / 2) * W, cy = ((face.y0 + face.y1) / 2) * H;
    sh = Math.min(H, (face.y1 - face.y0) * H * 2.2);
    sw = Math.min(W, (sh * 4) / 3);
    sx = Math.max(0, Math.min(W - sw, cx - sw / 2));
    sy = Math.max(0, Math.min(H - sh, cy - sh / 2));
  }
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = Math.round((320 * sh) / sw);
  c.getContext("2d")?.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.75);
}

/**
 * MediaRecorder webm has no duration, so the player can't seek. This forces Chrome to compute it,
 * then jumps to the last `lastSec` seconds. Use as the <video> onLoadedMetadata handler.
 */
export function seekToTail(v: HTMLVideoElement, lastSec = 10) {
  const go = () => {
    if (Number.isFinite(v.duration)) v.currentTime = Math.max(0, v.duration - lastSec);
  };
  if (Number.isFinite(v.duration)) return go();
  const onTime = () => {
    v.removeEventListener("timeupdate", onTime);
    go();
  };
  v.addEventListener("timeupdate", onTime);
  v.currentTime = 1e101;
}
