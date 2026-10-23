// Transcribes a few seconds of the candidate's Zoom audio with Groq Whisper.
// Returns words with absolute timestamps so response-time and pause checks stay accurate.
// OWNER: Person 1 (uses Person 2's GROQ_API_KEY)
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return NextResponse.json({ error: "no-key" }, { status: 503 });

  const form = await req.formData();
  const audio = form.get("audio") as Blob | null;
  const startedAt = Number(form.get("startedAt"));
  if (!audio || audio.size < 2000) return NextResponse.json({ words: [] }); // silence / too short

  const body = new FormData();
  // Keep the real file type (Chrome/Edge send webm, Safari sends mp4)
  const name = (audio as File).name && (audio as File).name !== "blob" ? (audio as File).name : audio.type.includes("mp4") ? "chunk.mp4" : "chunk.webm";
  body.append("file", audio, name);
  body.append("model", process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo");
  body.append("response_format", "verbose_json");
  body.append("timestamp_granularities[]", "word");
  body.append("language", "en");

  try {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ error: `groq ${res.status}` }, { status: 502 });
    const data = await res.json();
    // Prefer word timestamps; fall back to spreading segment text evenly
    const words: { w: string; t: number }[] = data.words?.length
      ? data.words.map((x: { word: string; start: number }) => ({ w: x.word.trim(), t: startedAt + Math.round(x.start * 1000) }))
      : (data.segments ?? []).flatMap((sg: { text: string; start: number; end: number }) => {
          const ws = sg.text.trim().split(/\s+/).filter(Boolean);
          const step = ((sg.end - sg.start) * 1000) / Math.max(1, ws.length);
          return ws.map((w, i) => ({ w, t: startedAt + Math.round(sg.start * 1000 + i * step) }));
        });
    return NextResponse.json({ words: words.filter((x) => x.w) });
  } catch {
    return NextResponse.json({ error: "timeout" }, { status: 504 });
  }
}
