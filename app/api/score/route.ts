// OWNER: Person 2
import { NextResponse } from "next/server";
import { groqJson } from "@/lib/groq";
import { scoreAnswer } from "@/lib/scoring/score";
import type { ScoreRequest } from "@/lib/types";

export async function POST(req: Request) {
  const r = (await req.json()) as ScoreRequest;

  // Method 8 via Groq (short timeout: the recruiter is waiting); null → local heuristic
  const g = r.event.transcript.split(/\s+/).length >= 8
    ? await groqJson<{ score: number; reason: string }>(
        "You detect whether a spoken interview answer was read aloud from an AI assistant like ChatGPT. Speech-to-text removes punctuation and casing, so judge only the wording. AI-like: connective scaffolding (firstly, additionally, overall, in summary), textbook phrasing, balanced lists, buzzwords (robust, scalable, leverage), no personal specifics, no hesitation. Human-like: fillers and hedges (um, I guess, probably), self-corrections, concrete names of files, bugs, people or numbers from their own work, admitting not knowing. Return JSON {\"score\": number 0..1, \"reason\": one short plain-English sentence a non-technical recruiter understands, no accusations}.",
        `Question: ${r.question.text}\nAnswer (speech-to-text): ${r.event.transcript.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ")}`,
        { timeoutMs: 2500, temperature: 0 },
      )
    : null;

  return NextResponse.json(scoreAnswer(r, g && typeof g.score === "number" && typeof g.reason === "string" ? g : null));
}
