// OWNER: Person 2
import { NextResponse } from "next/server";
import { groqJson } from "@/lib/groq";
import { computeSignals } from "@/lib/scoring/signals";
import { fuse, matchKnownAi } from "@/lib/scoring/fuse";
import type { ScoreRequest } from "@/lib/types";

export async function POST(req: Request) {
  const r = (await req.json()) as ScoreRequest;

  // Method 8 via Groq; computeSignals falls back to the local heuristic if this is null
  const g = r.event.transcript.length > 30
    ? await groqJson<{ score: number; reason: string }>(
        "You detect whether a spoken interview answer was read from an AI assistant. Speech-to-text removes punctuation, so judge wording: ChatGPT-style structure (firstly/additionally/in summary), generic textbook phrasing, balanced lists, no personal specifics, no hesitation. Return JSON {\"score\": 0..1, \"reason\": one short plain-English sentence}.",
        `Question: ${r.question.text}\nAnswer: ${r.event.transcript}`,
        2500
      )
    : null;

  const signals = computeSignals(r, g ? { value: g.score, why: g.reason } : undefined);
  const known = matchKnownAi(r.event.transcript, r.question.id, r.knownAi);
  return NextResponse.json(fuse(r.question, signals, r.weights, known));
}
