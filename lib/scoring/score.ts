// One answer → Score. Pure; the /api/score route and scripts/score-demo.mjs both call this,
// so what the demo script prints is exactly what the app shows.
// OWNER: Person 2
import type { Score, ScoreRequest } from "@/lib/types";
import { computeSignals } from "./signals";
import { fuse } from "./fuse";
import { llmStyleHeuristic } from "./text";
import { findRepeatAnswer, matchKnownAi } from "@/lib/learning";

/** groqStyle: Groq's 0..1 "reads like an LLM" verdict, or null/undefined offline. */
export function scoreAnswer(r: ScoreRequest, groqStyle?: { score: number; reason: string } | null): Score {
  // Blend Groq with the local heuristic so one odd LLM reply can't swing the score on stage
  const style = groqStyle && Number.isFinite(groqStyle.score)
    ? { value: 0.5 * Math.max(0, Math.min(1, groqStyle.score)) + 0.5 * llmStyleHeuristic(r.event.transcript).value, why: groqStyle.reason }
    : undefined;
  const signals = computeSignals(r, style);

  const known = matchKnownAi(r.event.transcript, r.question.id, r.knownAi ?? []);
  const repeat = known ? undefined : findRepeatAnswer(r.event.transcript, r.question.id, r.knownAi ?? []);
  const hit = known ?? (repeat && { id: repeat.id, similarity: 0.7 });
  if (hit) {
    const sim = signals.find((s) => s.method === "ai_similarity");
    const seen = (r.knownAi ?? []).find((k) => k.id === hit.id)?.seenCount ?? 1;
    const why = repeat ? `Same answer as one given to a different question before (seen ${seen}×)` : `Matches an AI answer seen in ${seen} past interview${seen === 1 ? "" : "s"}`;
    if (sim) Object.assign(sim, { value: Math.max(sim.value, 0.9), why });
  }
  return fuse(r.question, signals, r.weights, hit && { ...hit, repeat: !!repeat });
}
