// Detection methods 1–11 → Signal[]. Pure functions, no network.
// OWNER: Person 2 (eye methods 1–3 consume Person 3's GazeWindow)
import type { ScoreRequest, Signal, CandidateProfile } from "@/lib/types";
import { fillerRate, llmStyleHeuristic, similarity, words } from "./text";

const clamp = (x: number) => Math.max(0, Math.min(1, x));

export function latencyMs(r: ScoreRequest): number {
  return r.event.firstWordAt ? r.event.firstWordAt - r.event.askedAt : r.event.endedAt - r.event.askedAt;
}

export function wpm(r: ScoreRequest): number {
  const start = r.event.firstWordAt ?? r.event.askedAt;
  const mins = Math.max(0.05, (r.event.endedAt - start) / 60000);
  return words(r.event.transcript).length / mins;
}

/** Gaps > 700ms between words that happen mid-answer (humans pause while thinking). */
function midAnswerPauses(r: ScoreRequest): number {
  const ws = r.event.words;
  let n = 0;
  for (let i = 1; i < ws.length; i++) if (ws[i].t - ws[i - 1].t > 700) n++;
  return n;
}

const TECH = ["kafka", "redis", "postgres", "postgresql", "mongodb", "kubernetes", "docker", "aws", "gcp", "terraform", "graphql", "rust", "go", "java", "kotlin", "swift", "react", "vue", "angular", "django", "flask", "fastapi", "spring", "rabbitmq", "elasticsearch", "cassandra", "dynamodb"];

/** Tech the candidate claims in the answer that shows up nowhere in their GitHub. */
export function unsupportedClaims(text: string, profile: CandidateProfile | null): string[] {
  if (!profile) return [];
  const said = new Set(words(text));
  const gh = [
    ...profile.topLanguages.map((l) => l.lang),
    ...profile.repos.flatMap((r) => [r.language ?? "", r.name, r.description ?? ""]),
  ].join(" ").toLowerCase();
  return TECH.filter((t) => said.has(t) && !gh.includes(t));
}

export function computeSignals(r: ScoreRequest, llmStyleOverride?: { value: number; why: string }): Signal[] {
  const out: Signal[] = [];
  const g = r.gaze;
  const lat = latencyMs(r);
  const rate = wpm(r);

  // 1–3 Eyes (from Person 3's tracker)
  if (g) {
    out.push({ method: "eye_reading", value: clamp(g.readingSweeps / 12), why: `${g.readingSweeps.toFixed(0)} left-to-right sweeps/min, looks like reading` });
    // Also: kept going back to the same spot ON the screen, away from the camera (P3: second window, notes, phone)
    const offScreen = clamp((g.offScreenPct - 0.15) / 0.5 + Math.abs(g.sideBias) * 0.3);
    const h = g.hotspot;
    const spot = h && h.visits >= 3 ? clamp((h.visits - 2) / 4 + h.dwellPct) : 0;
    const where = h ? [h.dy > 0.3 ? "below" : h.dy < -0.3 ? "above" : "", Math.abs(h.dx) > 0.3 ? `to their ${h.dx > 0 ? "right" : "left"}` : ""].filter(Boolean).join(" and ") || "off-camera" : "";
    out.push(spot > offScreen
      ? { method: "eye_offscreen", value: spot, why: `Kept looking at the same spot on their screen (${where}), ${h!.visits} times, ${(h!.dwellPct * 100).toFixed(0)}% of the answer` }
      : { method: "eye_offscreen", value: offScreen, why: `Looked away ${(g.offScreenPct * 100).toFixed(0)}% of the answer${Math.abs(g.sideBias) > 0.5 ? `, mostly to the ${g.sideBias > 0 ? "right" : "left"}` : ""}` });
    out.push({ method: "eye_baseline", value: clamp(g.baselineDelta), why: `Eye pattern ${(g.baselineDelta * 100).toFixed(0)}% different from their warm-up` });
  }

  // 4 Latency vs their own baseline; a consistent ~2s lag is the relay signature
  const base = r.baseline?.latencyMs ?? 1200;
  const lagLike = lat > 1600 && lat < 2600 ? 0.35 : 0;
  out.push({ method: "latency", value: clamp((lat - base) / 2500 + lagLike), why: `${(lat / 1000).toFixed(1)}s before first word (their normal: ${(base / 1000).toFixed(1)}s)` });

  // 5 Pauses: AI-fed answers pause before, then flow with no mid-thought pauses or fillers
  const mid = midAnswerPauses(r);
  const fill = fillerRate(r.event.transcript);
  out.push({ method: "pauses", value: clamp((mid === 0 ? 0.5 : 0.1) + (fill < 0.5 ? 0.4 : 0)), why: `${mid} thinking pauses, ${fill.toFixed(1)} fillers per 50 words` });

  // 6 Steady reading-speed delivery
  const baseWpm = r.baseline?.wpm ?? 135;
  out.push({ method: "steady_rate", value: clamp((rate - baseWpm) / 40 + (rate > 145 ? 0.3 : 0)), why: `${rate.toFixed(0)} words/min (their normal: ${baseWpm.toFixed(0)})` });

  // 7 Similarity to AI answers: the shadow answer plus every model in the research library
  const candidates = [{ model: "the AI answer", text: r.question.shadowAnswer }, ...(r.question.aiAnswers ?? [])];
  const best = candidates.map((c) => ({ model: c.model, sim: similarity(r.event.transcript, c.text) })).sort((a, b) => b.sim - a.sim)[0];
  const sim = best?.sim ?? 0;
  out.push({
    method: "ai_similarity",
    value: clamp(sim * 1.4),
    why: candidates.length > 1 ? `${(sim * 100).toFixed(0)}% overlap with ${best.model}'s answer (closest of ${candidates.length} AI answers)` : `${(sim * 100).toFixed(0)}% overlap with what an AI would say`,
  });

  // 8 LLM style (Groq when available, else heuristic)
  const style = llmStyleOverride ?? (() => {
    const h = llmStyleHeuristic(r.event.transcript);
    return { value: h.value, why: h.markers.length ? `AI-style phrasing: "${h.markers.slice(0, 3).join('", "')}"` : "No strong AI-style phrasing" };
  })();
  out.push({ method: "llm_style", value: clamp(style.value), why: style.why });

  // 9 GitHub consistency
  const claims = unsupportedClaims(r.event.transcript, r.profile);
  out.push({ method: "github_mismatch", value: clamp(claims.length * 0.4), why: claims.length ? `Mentions ${claims.join(", ")}, not found in their GitHub` : "Claims match their GitHub" });

  // 10 Easy vs hard: hard answered faster/smoother than easy is backwards
  if (r.easyVsHard && r.question.kind !== "easy") {
    const faster = r.easyVsHard.easyLatencyMs - lat;
    const smoother = rate - r.easyVsHard.easyWpm;
    out.push({ method: "easy_vs_hard", value: clamp(faster / 1500 + smoother / 40), why: faster > 0 ? "Hard question answered faster than the easy ones" : "Hard question took longer than easy ones (normal)" });
  }

  // Trap question: confidently answering about something that doesn't exist
  if (r.question.kind === "trap") {
    const honest = /(not sure|never heard|don't know|do not know|haven't used|look it up|doesn't exist)/i.test(r.event.transcript);
    out.push({ method: "llm_style", value: honest ? 0 : 0.95, why: honest ? "Admitted not knowing the made-up feature (honest)" : "Confidently described a feature that doesn't exist" });
  }

  // 11 Manual: environment checklist
  const c = r.checklist;
  const ticks = [c.earpiece, c.glassesReflection, c.virtualBackground].filter(Boolean).length + (c.idShown ? 0 : 0.5);
  if (ticks > 0) out.push({ method: "manual", value: clamp(ticks * 0.3), why: [c.earpiece && "earpiece", c.glassesReflection && "glasses reflection", c.virtualBackground && "virtual background", !c.idShown && "no ID shown"].filter(Boolean).join(", ") });

  return out;
}
