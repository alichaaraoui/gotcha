// Signals + weights → one risk %, level, and what Sarah should do next.
// OWNER: Person 2
//
// How the % is built: every method above the noise floor adds evidence (scaled by its learned
// weight); evidence saturates toward 100%. Quiet methods add nothing rather than diluting loud
// ones, so turning the webcam on (3 more, mostly calm, methods) can't hide anything.
import type { Level, MethodId, Question, Score, Signal, Weights } from "@/lib/types";

export const THRESHOLDS = { watch: 20, warn: 50, flag: 75 } as const;
export const FIRING = 0.6; // a method "fires" at >= 0.6
export const MIN_METHODS_FOR_FLAG = 2; // false-positive guardrail: red needs 2+ independent methods
export const NOISE_FLOOR = 0.2; // signal values below this are treated as noise
const EVIDENCE_SCALE = 2.3; // evidence needed for ~63% risk; tuned on data/demo_scripts.json
// How much one answer can prove, by question kind. Polished intros and textbook answers to common
// questions are also what well-prepared humans give; own-code probes and traps are hard to fake.
export const QUESTION_POWER: Record<Question["kind"], number> = { easy: 0.35, hard: 0.55, custom: 0.6, probe: 1, trap: 1 };

export const DEFAULT_WEIGHTS: Weights = {
  eye_reading: 1.0, eye_offscreen: 0.6, eye_baseline: 0.8,
  latency: 0.9, pauses: 0.9, steady_rate: 0.6,
  ai_similarity: 1.3, llm_style: 1.1, github_mismatch: 1.0,
  easy_vs_hard: 1.0, manual: 0.5,
};

const VOICE: MethodId[] = ["latency", "pauses", "steady_rate", "easy_vs_hard"];
const EYES: MethodId[] = ["eye_reading", "eye_offscreen", "eye_baseline"];

export function levelFor(risk: number): Level {
  if (risk >= THRESHOLDS.flag) return "flag";
  if (risk >= THRESHOLDS.warn) return "warn";
  if (risk >= THRESHOLDS.watch) return "watch";
  return "clear";
}

export function fuse(
  question: Question,
  signals: Signal[],
  weights: Weights,
  knownAi?: { id: string; similarity: number; repeat?: boolean },
): Score {
  const power = question.stage === "warmup" ? QUESTION_POWER.easy : QUESTION_POWER[question.kind] ?? 0.6;
  // The 3 eye methods read the same webcam signal, so they count as one family:
  // strongest in full, the others at half (no triple-counting one glance).
  let evidence = 0;
  const eyes: number[] = [];
  for (const s of signals) {
    const w = weights[s.method] ?? DEFAULT_WEIGHTS[s.method] ?? 1;
    const e = (w * Math.max(0, s.value - NOISE_FLOOR)) / (1 - NOISE_FLOOR);
    if (EYES.includes(s.method)) eyes.push(e);
    else evidence += e;
  }
  if (eyes.length) evidence += Math.max(...eyes) + 0.5 * (eyes.reduce((a, b) => a + b, 0) - Math.max(...eyes));
  let risk = Math.round(100 * (1 - Math.exp((-evidence * power) / EVIDENCE_SCALE)));
  const firing = new Set(signals.filter((s) => s.value >= FIRING).map((s) => s.method));
  const methodsFiring = firing.size;

  // Seen this exact AI answer in a past interview: jump straight to Warning (learning saves time)
  if (knownAi) risk = Math.max(risk, 65);

  // Guardrails: Warning needs at least one strong method; red needs 2+ independent ones;
  // warm-up answers ARE the baseline, so they can raise a Watch but never more
  if (methodsFiring === 0 || question.stage === "warmup") risk = Math.min(risk, THRESHOLDS.warn - 1);
  if (methodsFiring < MIN_METHODS_FOR_FLAG) risk = Math.min(risk, THRESHOLDS.flag - 1);

  const level = levelFor(risk);
  return { questionId: question.id, risk, level, signals, methodsFiring, knownAiMatch: knownAi && { id: knownAi.id, similarity: knownAi.similarity }, ...suggest(level, question, signals, knownAi) };
}

/** Plain-English next step for recruiters who aren't engineers. Never accuses; always a question to ask. */
function suggest(level: Level, q: Question, signals: Signal[], knownAi?: { repeat?: boolean }): Pick<Score, "suggestedText" | "suggestedQuestionId"> {
  if (level === "clear") return { suggestedText: "Looks organic. Carry on." };
  const top = [...signals].sort((a, b) => b.value - a.value)[0]?.method;
  const why = (() => {
    if (knownAi) return knownAi.repeat ? "This answer matches one we've heard from another candidate." : "This answer matches an AI answer from a past interview.";
    if (top === "github_mismatch") return "What they said doesn't match their GitHub.";
    if (top === "ai_similarity" || top === "llm_style") return "The answer sounds like a chatbot wrote it.";
    if (top && VOICE.includes(top)) return "The timing sounds read out rather than thought through.";
    if (top && EYES.includes(top)) return "Their eyes look like they're reading.";
    return "";
  })();
  const ask = (() => {
    if (top === "github_mismatch") return q.repoRef ? `Ask them to name one file in ${q.repoRef} and what it does.` : "Ask where exactly they used that, and what went wrong.";
    if (top && EYES.includes(top)) return "Ask them to look at the camera and walk you through it slowly.";
    if (top && VOICE.includes(top)) return "Interrupt with a quick \"why?\" and see if they can answer straight away.";
    return "Ask for one specific example from their own work: names, numbers, a mistake.";
  })();
  switch (level) {
    case "flag":
      return { suggestedText: `Test now: switch to the Probe track. ${why} ${ask}`.trim(), suggestedQuestionId: q.followUps?.[0] };
    case "warn":
      return { suggestedText: `${why} Check against their GitHub, then ask a follow-up on the same topic. ${ask}`.trim(), suggestedQuestionId: q.followUps?.[0] };
    default:
      return { suggestedText: `Watch the next answer. ${why} Eye tracking and the AI comparison are now highlighted.`.replace("  ", " ") };
  }
}
