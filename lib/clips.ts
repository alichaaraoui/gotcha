"use client";
// Rolling 10-second video buffer + frame snapshots, captured when a red flag fires.
// OWNER: Person 3

export class ClipRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: { t: number; blob: Blob }[] = [];

  start(stream: MediaStream) {
    try {
      this.rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    } catch {
      return; // recording not supported; snapshots still work
    }
    this.rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      this.chunks.push({ t: Date.now(), blob: e.data });
      // keep the first chunk (has the webm header) + last ~12s
      const cutoff = Date.now() - 12000;
      this.chunks = this.chunks.filter((c, i) => i === 0 || c.t >= cutoff);
    };
    this.rec.start(1000);
  }

  /** Object URL of roughly the last 10 seconds. TODO(P3): verify it plays in Chrome. */
  clip(): string | undefined {
    if (!this.chunks.length) return;
    return URL.createObjectURL(new Blob(this.chunks.map((c) => c.blob), { type: "video/webm" }));
  }

  stop() {
    this.rec?.state === "recording" && this.rec.stop();
  }
}

export function snapshot(video: HTMLVideoElement): string | undefined {
  if (!video.videoWidth) return;
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = Math.round((320 * video.videoHeight) / video.videoWidth);
  c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}
