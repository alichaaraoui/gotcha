// Learning from previous interviews. Runs client- and server-side (pure functions).
// OWNER: Person 2 (weights, ranking, known-AI matching) · Person 3 (insights page uses these)
import type { MethodId, PastInterview, Session, Weights, KnownAiAnswer, Track, Question } from "@/lib/types";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/fuse";
import { similarity } from "@/lib/scoring/text";

/** Each method's weight = default × how often its flags were confirmed (Laplace-smoothed). */
export function learnWeights(history: PastInterview[]): Weights {
  const hits: Record<string, { right: number; total: number }> = {};
  for (const p of history) {
    for (const f of p.flags) {
      const h = (hits[f.method] ??= { right: 0, total: 0 });
      h.total++;
      if (f.verdict === "suspicious") h.right++;
    }
  }
  const out = { ...DEFAULT_WEIGHTS };
  (Object.keys(out) as MethodId[]).forEach((m) => {
    const h = hits[m];
    if (!h) return;
    const precision = (h.right + 1) / (h.total + 2);
    out[m] = Math.round(DEFAULT_WEIGHTS[m] * (0.5 + precision) * 100) / 100;
  });
  return out;
}

/** Questions ranked by how well they separated assisted from organic candidates (gap in mean risk). */
export function rankQuestions(history: PastInterview[], trackId: string) {
  const agg: Record<string, { sus: number[]; gen: number[] }> = {};
  for (const p of history.filter((h) => h.trackId === trackId)) {
    for (const q of p.questionsAsked) {
      const a = (agg[q.questionId] ??= { sus: [], gen: [] });
      (p.outcome === "suspicious" ? a.sus : a.gen).push(q.risk);
    }
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return Object.entries(agg)
    .map(([questionId, a]) => ({ questionId, separation: Math.round(mean(a.sus) - mean(a.gen)), asked: a.sus.length + a.gen.length }))
    .sort((x, y) => y.separation - x.separation);
}

/** Put the best-separating questions first inside each stage, so problems surface sooner. */
export function orderTrack(track: Track, history: PastInterview[]): Track {
  const rank = new Map(rankQuestions(history, track.id).map((r, i) => [r.questionId, i]));
  return {
    ...track,
    stages: track.stages.map((s) => ({
      ...s,
      questions: [...s.questions].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)),
    })),
  };
}

export function timeToFlagTrend(history: PastInterview[]) {
  return history.filter((h) => h.minutesToFirstFlag != null).map((h) => ({ date: h.date, minutes: h.minutesToFirstFlag as number }));
}

export function preInterviewBrief(history: PastInterview[], track: Track) {
  const ranked = rankQuestions(history, track.id).slice(0, 3);
  const all = track.stages.flatMap((s) => s.questions);
  const trend = timeToFlagTrend(history);
  const recent = trend.slice(-5), early = trend.slice(0, 5);
  const avg = (xs: { minutes: number }[]) => (xs.length ? xs.reduce((a, b) => a + b.minutes, 0) / xs.length : 0);
  return {
    interviews: history.filter((h) => h.trackId === track.id).length,
    bestQuestions: ranked.map((r) => ({ ...r, text: all.find((q) => q.id === r.questionId)?.text ?? r.questionId })),
    minutesToFlagBefore: Math.round(avg(early) * 10) / 10,
    minutesToFlagNow: Math.round(avg(recent) * 10) / 10,
  };
}

/** Turn a finished session into history + any confirmed AI answers into the known-answer library. */
export function sessionToPast(s: Session): { past: PastInterview; newKnownAi: KnownAiAnswer[] } {
  const verdicts = Object.values(s.verdicts);
  const outcome = verdicts.includes("suspicious") ? "suspicious" : "genuine";
  const firstFlag = s.flags.find((f) => f.level === "flag");
  const flags = s.flags.map((f) => {
    const sc = s.scores.find((x) => x.questionId === f.questionId);
    const top = sc ? [...sc.signals].sort((a, b) => b.value - a.value)[0]?.method : undefined;
    return { method: (top ?? "manual") as MethodId, verdict: s.verdicts[f.id] ?? "genuine" };
  });
  const newKnownAi = s.flags
    .filter((f) => s.verdicts[f.id] === "suspicious")
    .map((f) => s.events.find((e) => e.questionId === f.questionId))
    .filter((e): e is NonNullable<typeof e> => !!e && e.transcript.length > 40)
    .map((e, i) => ({ id: `kai-${s.id}-${i}`, questionId: e.questionId, text: e.transcript, seenCount: 1 }));
  return {
    past: {
      id: s.id,
      date: new Date(s.startedAt).toISOString().slice(0, 10),
      trackId: s.trackId,
      outcome,
      minutesToFirstFlag: firstFlag ? Math.round(((firstFlag.at - s.startedAt) / 60000) * 10) / 10 : null,
      questionsAsked: s.scores.map((x) => ({ questionId: x.questionId, risk: x.risk })),
      flags,
    },
    newKnownAi,
  };
}

/** Same answer showing up across different candidates = likely a proxy interviewer or shared script. */
export function findRepeatAnswer(transcript: string, questionId: string, known: KnownAiAnswer[]): KnownAiAnswer | undefined {
  return known.find((k) => k.questionId === questionId && similarity(transcript, k.text) > 0.7);
}

export function fillRepo(q: Question, repo?: string): Question {
  return repo && q.text.includes("{repo}") ? { ...q, text: q.text.replace("{repo}", repo), repoRef: repo } : q;
}
