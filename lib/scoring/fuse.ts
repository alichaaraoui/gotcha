// Signals + weights → one risk %, level, and what Sarah should do next.
// OWNER: Person 2
import type { Level, Question, Score, Signal, Weights, KnownAiAnswer } from "@/lib/types";
import { similarity } from "./text";

export const THRESHOLDS = { watch: 20, warn: 50, flag: 75 } as const;
export const FIRING = 0.6; // a method "fires" at >= 0.6
export const MIN_METHODS_FOR_FLAG = 2; // false-positive guardrail

export const DEFAULT_WEIGHTS: Weights = {
  eye_reading: 1.0, eye_offscreen: 0.6, eye_baseline: 0.8,
  latency: 0.9, pauses: 0.9, steady_rate: 0.6,
  ai_similarity: 1.3, llm_style: 1.1, github_mismatch: 1.0,
  easy_vs_hard: 1.0, manual: 0.5,
};

export function levelFor(risk: number): Level {
  if (risk >= THRESHOLDS.flag) return "flag";
  if (risk >= THRESHOLDS.warn) return "warn";
  if (risk >= THRESHOLDS.watch) return "watch";
  return "clear";
}

export function matchKnownAi(transcript: string, questionId: string, known: KnownAiAnswer[]) {
  let best: { id: string; similarity: number } | undefined;
  for (const k of known) {
    if (k.questionId !== questionId) continue;
    const s = similarity(transcript, k.text);
    if (!best || s > best.similarity) best = { id: k.id, similarity: s };
  }
  return best && best.similarity >= 0.55 ? best : undefined;
}

export function fuse(question: Question, signals: Signal[], weights: Weights, knownAi?: { id: string; similarity: number }): Score {
  // Weighted mean, but the strongest signals count extra so one quiet method can't hide a loud one.
  let num = 0, den = 0;
  for (const s of signals) {
    const w = weights[s.method] ?? 1;
    num += w * s.value * (s.value >= FIRING ? 1.4 : 1);
    den += w;
  }
  let risk = den ? Math.round(Math.min(100, (num / den) * 100)) : 0;
  const methodsFiring = new Set(signals.filter((s) => s.value >= FIRING).map((s) => s.method)).size;

  // Seen this exact AI answer in a past interview: jump straight to Warning (learning saves time)
  if (knownAi) risk = Math.max(risk, 65);

  // Guardrail: never reach red on fewer than 2 independent methods
  if (risk >= THRESHOLDS.flag && methodsFiring < MIN_METHODS_FOR_FLAG) risk = THRESHOLDS.flag - 1;

  const level = levelFor(risk);
  return { questionId: question.id, risk, level, signals, methodsFiring, knownAiMatch: knownAi, ...suggest(level, question) };
}

/** Plain-English next step for recruiters who aren't engineers. */
function suggest(level: Level, q: Question): Pick<Score, "suggestedText" | "suggestedQuestionId"> {
  switch (level) {
    case "flag":
      return { suggestedText: "Test now: switch to the Probe track. Ask them to explain their own code.", suggestedQuestionId: q.stage === "probe" ? undefined : "probe" };
    case "warn":
      return { suggestedText: "Check against their GitHub. Ask a follow-up on the same topic.", suggestedQuestionId: q.followUps?.[0] };
    case "watch":
      return { suggestedText: "Watch the next answer. Eye tracking and AI comparison are now highlighted." };
    default:
      return { suggestedText: "Looks organic. Carry on." };
  }
}
