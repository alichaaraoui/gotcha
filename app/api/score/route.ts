// OWNER: Person 2
import { NextResponse } from "next/server";
import { groqJson } from "@/lib/groq";
import { scoreAnswer } from "@/lib/scoring/score";
import type { ScoreRequest } from "@/lib/types";

const STYLE_SYSTEM =
  "You detect whether a spoken interview answer was read aloud from an AI assistant like ChatGPT. Speech-to-text removes punctuation and casing, so judge only the wording. AI-like: connective scaffolding (firstly, additionally, overall, in summary), textbook phrasing, balanced lists, buzzwords (robust, scalable, leverage), no personal specifics, no hesitation. Human-like: fillers and hedges (um, I guess, probably), self-corrections, concrete names of files, bugs, people or numbers from their own work, admitting not knowing. Return JSON {\"verdict\": \"ai\" | \"human\" | \"unsure\", \"ai_likelihood\": number from 0 to 1 where 1 means it was almost certainly read from an AI and 0 means a real person talking naturally, \"reason\": one short plain-English sentence a non-technical recruiter understands, no accusations}.";

type StyleReply = { verdict?: string; ai_likelihood?: number; score?: number; reason?: string };

/** Map Groq's reply to 0..1 "AI-like". Models sometimes give a confidence instead of a likelihood,
 *  so when the verdict word and the number disagree, trust the word and flip the number. */
function styleScore(g: StyleReply | null): { score: number; reason: string } | null {
  const n = typeof g?.ai_likelihood === "number" ? g.ai_likelihood : g?.score;
  if (!g || typeof n !== "number" || !Number.isFinite(n) || typeof g.reason !== "string") return null;
  let score = Math.max(0, Math.min(1, n));
  if ((g.verdict === "human" && score > 0.5) || (g.verdict === "ai" && score < 0.5)) score = 1 - score;
  if (g.verdict === "unsure") score = Math.min(score, 0.5);
  return { score, reason: g.reason };
}

export async function POST(req: Request) {
  const r = (await req.json()) as ScoreRequest;

  // Method 8 via Groq (short timeout: the recruiter is waiting); null → local heuristic
  const g = r.event.transcript.split(/\s+/).length >= 8
    ? await groqJson<StyleReply>(
        STYLE_SYSTEM,
        `Question: ${r.question.text}\nAnswer (speech-to-text): ${r.event.transcript.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ")}`,
        { timeoutMs: 2500, temperature: 0, maxTokens: 150 },
      )
    : null;

  return NextResponse.json(scoreAnswer(r, styleScore(g)));
}
