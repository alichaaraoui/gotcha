// Detection methods 1–11 → Signal[]. Pure functions, no network.
// Each value is 0..1 "how suspicious"; fuse.ts treats anything under ~0.2 as noise.
// OWNER: Person 2 (eye methods 1–3 consume Person 3's GazeWindow)
import type { ScoreRequest, Signal, CandidateProfile, Question } from "@/lib/types";
import { closestShadow, consensusHits, fillerRate, fluentStart, llmStyleHeuristic, normalize, words } from "./text";

const clamp = (x: number) => Math.max(0, Math.min(1, x));

// Population norms, used until the candidate's own warm-up gives us a baseline.
// (easyLatencyMs includes ~300ms of Chrome speech-recognition lag.)
export const NORMS = { easyLatencyMs: 1300, wpm: 135, readingWpm: 145 } as const;

/**
 * When the first word was actually spoken. Chrome stamps words per interim result, so the first
 * stamp often covers 2–3 words; back-extrapolate over that first burst at their speaking pace.
 */
function firstWordTime(r: Pick<ScoreRequest, "event">): number | null {
  const ws = r.event.words, e = r.event;
  if (e.firstWordAt == null) return null;
  if (ws.length < 4) return e.firstWordAt;
  const first = ws[0].t, last = ws[ws.length - 1].t;
  const burst = ws.findIndex((w) => w.t !== first);
  if (burst <= 1 || last - first < 1500) return e.firstWordAt;
  const perWord = (last - first) / (ws.length - burst);
  return Math.max(e.askedAt, first - (burst - 1) * perWord);
}

export function latencyMs(r: Pick<ScoreRequest, "event">): number {
  const t = firstWordTime(r);
  return t != null ? t - r.event.askedAt : r.event.endedAt - r.event.askedAt;
}

export function wpm(r: Pick<ScoreRequest, "event">): number {
  const ws = r.event.words;
  const start = firstWordTime(r) ?? r.event.askedAt;
  // Word stamps give the real speaking span; fall back to "until they pressed Done"
  if (ws.length >= 4 && ws[ws.length - 1].t - start >= 1500) return (ws.length - 1) / ((ws[ws.length - 1].t - start) / 60000);
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

// Tech people claim out loud → how to spot it in speech, and the names it might go by on GitHub.
const TECH: { name: string; said: RegExp; gh: string[] }[] = [
  { name: "Kafka", said: /\bkafka\b/, gh: ["kafka"] },
  { name: "Redis", said: /\bredis\b/, gh: ["redis"] },
  { name: "Postgres", said: /\bpostgres(ql)?\b/, gh: ["postgres"] },
  { name: "MySQL", said: /\bmy ?sql\b/, gh: ["mysql"] },
  { name: "MongoDB", said: /\bmongo(db)?\b/, gh: ["mongo"] },
  { name: "Kubernetes", said: /\b(kubernetes|k8s)\b/, gh: ["kubernetes", "k8s", "helm"] },
  { name: "Docker", said: /\bdocker\b/, gh: ["docker", "container", "dockerfile"] },
  { name: "AWS", said: /\b(aws|amazon web services|lambda)\b/, gh: ["aws", "s3", "lambda", "dynamo"] },
  { name: "GCP", said: /\b(gcp|google cloud)\b/, gh: ["gcp", "google cloud", "bigquery"] },
  { name: "Terraform", said: /\bterraform\b/, gh: ["terraform", "hcl"] },
  { name: "GraphQL", said: /\bgraphql\b/, gh: ["graphql", "apollo"] },
  { name: "Rust", said: /\brust\b/, gh: ["rust"] },
  { name: "Go", said: /\b(golang|in go|go service|go services|written in go|wrote it in go)\b/, gh: ["go"] },
  { name: "Java", said: /\bjava\b(?!script)/, gh: ["java", "kotlin", "spring"] },
  { name: "Kotlin", said: /\bkotlin\b/, gh: ["kotlin"] },
  { name: "Swift", said: /\bswift\b/, gh: ["swift"] },
  { name: "Vue", said: /\bvue\b/, gh: ["vue", "nuxt"] },
  { name: "Angular", said: /\bangular\b/, gh: ["angular"] },
  { name: "Django", said: /\bdjango\b/, gh: ["django"] },
  { name: "FastAPI", said: /\bfast ?api\b/, gh: ["fastapi"] },
  { name: "Spring", said: /\bspring boot\b/, gh: ["spring"] },
  { name: "RabbitMQ", said: /\brabbit ?mq\b/, gh: ["rabbitmq", "amqp"] },
  { name: "Elasticsearch", said: /\belastic ?search\b/, gh: ["elastic"] },
  { name: "Cassandra", said: /\bcassandra\b/, gh: ["cassandra"] },
  { name: "DynamoDB", said: /\bdynamo ?db\b/, gh: ["dynamo"] },
  { name: "CI/CD", said: /\b(ci ?cd|ci pipelines?|cd pipelines?)\b/, gh: ["ci", "actions", "workflow", "pipeline"] },
];

function githubText(profile: CandidateProfile): string {
  return [
    ...profile.topLanguages.map((l) => l.lang),
    ...profile.repos.flatMap((r) => [r.language ?? "", r.name.replace(/[-_.]/g, " "), r.description ?? ""]),
  ].join(" ").toLowerCase();
}

/** Tech names mentioned in some text ("Postgres", "Kafka"), in list order. */
export function techMentioned(text: string): string[] {
  const t = normalize(text);
  return TECH.filter((x) => x.said.test(t)).map((x) => x.name);
}

/** Tech the candidate claims in the answer that shows up nowhere in their GitHub. */
export function unsupportedClaims(text: string, profile: CandidateProfile | null): string[] {
  if (!profile || !profile.repos.length) return [];
  const said = normalize(text);
  const gh = ` ${githubText(profile)} `;
  return TECH.filter((t) => t.said.test(said) && !t.gh.some((k) => gh.includes(k.length <= 3 ? ` ${k} ` : k))).map((t) => t.name);
}

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** "8 years of Kafka" from someone whose GitHub is 2 years old. */
function overstatedYears(text: string, profile: CandidateProfile | null): number | null {
  if (!profile) return null;
  const m = normalize(text).match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\+? years?\b/);
  if (!m) return null;
  const yrs = NUM[m[1]] ?? Number(m[1]);
  return yrs > profile.accountAgeYrs + 3 ? yrs : null;
}

/** For "your own code" probes: how many concrete things from that repo did they actually name? */
function repoSpecifics(text: string, q: Question, profile: CandidateProfile | null): { repo: string; hits: number } | null {
  if (q.probeStyle !== "own-code" || !profile) return null;
  const repo = profile.repos.find((r) => r.name === q.repoRef) ?? profile.repos[0];
  if (!repo) return null;
  const vocab = new Set(
    words(`${repo.name.replace(/[-_.]/g, " ")} ${repo.description ?? ""} ${repo.language ?? ""}`)
      .flatMap((w) => w.split("-"))
      .filter((w) => w.length > 2 && !["the", "and", "for", "with", "api", "app", "small", "that", "backed", "front"].includes(w)),
  );
  const said = words(text).flatMap((w) => w.split("-"));
  const hits = new Set(said.filter((w) => vocab.has(w))).size;
  const files = (text.match(/\b[\w-]+\.(py|go|ts|tsx|js|jsx|rs|java|rb|sql|yml|yaml|toml|json|lua|sh)\b/gi) ?? []).length;
  return { repo: repo.name, hits: hits + files * 2 };
}

/** "Never heard of it" / "I'd have to look it up": the honest answer to a trap question. */
const HONEST = /\b(not sure|never heard|haven't heard|don't think|don't know|do not know|haven't used|never used|look it up|doesn't exist|does not exist|no idea|not familiar)\b/;
export const admitsNotKnowing = (text: string) => HONEST.test(normalize(text));

export function computeSignals(r: ScoreRequest, llmStyleOverride?: { value: number; why: string }): Signal[] {
  const out: Signal[] = [];
  const q = r.question;
  const g = r.gaze;
  const text = r.event.transcript;
  const n = words(text).length;
  const lat = latencyMs(r);
  const rate = wpm(r);
  const easy = q.kind === "easy" || q.stage === "warmup";
  const ownCode = q.probeStyle === "own-code";
  const short = Math.min(1, n / 25); // short answers carry less evidence

  // 1–3 Eyes (from Person 3's tracker)
  if (g) {
    out.push({ method: "eye_reading", value: clamp((g.readingSweeps - 2) / 10), why: `${g.readingSweeps.toFixed(0)} left-to-right eye sweeps a minute, like reading a screen` });
    out.push({ method: "eye_offscreen", value: clamp((g.offScreenPct - 0.15) / 0.5 + Math.max(0, Math.abs(g.sideBias) - 0.3) * 0.4), why: `Looked away ${(g.offScreenPct * 100).toFixed(0)}% of the answer${Math.abs(g.sideBias) > 0.5 ? `, mostly to the ${g.sideBias > 0 ? "right" : "left"}` : ""}` });
    if (q.stage !== "warmup") out.push({ method: "eye_baseline", value: clamp((g.baselineDelta - 0.15) / 0.7), why: `Eye pattern ${(g.baselineDelta * 100).toFixed(0)}% different from their warm-up` });
  }

  // 4 Latency vs their own baseline. People are quick on easy questions and slower on hard ones;
  // a relay (someone reading an AI) has the SAME ~2s lag on everything, then starts fluently.
  {
    const base = r.baseline?.latencyMs;
    const s = (x: number) => (x / 1000).toFixed(1);
    let value = 0, why: string;
    if (easy) {
      value = clamp((lat - NORMS.easyLatencyMs) / 1200) * (fluentStart(text) ? 1 : 0.5);
      why = `${s(lat)}s before answering an easy question (most people: about 1s)`;
    } else if (base != null) {
      // not for "your own code": the real author SHOULD answer that as fast as a warm-up
      const sameLag = !ownCode && base > 1400 && lat > base * 0.75 && lat < base * 1.4;
      value = sameLag ? (fluentStart(text) ? 0.75 : 0.45) : 0;
      why = sameLag ? `Same ${s(lat)}s delay as on the easy warm-up (their normal: ${s(base)}s), even on a hard question` : `${s(lat)}s to start (their normal: ${s(base)}s); slower on hard questions is normal`;
    } else {
      value = lat > 1500 && lat < 3200 && fluentStart(text) ? 0.4 : 0;
      why = `${s(lat)}s before the first word`;
    }
    out.push({ method: "latency", value: clamp(value), why });
  }

  // 5 Pauses and fillers: people think out loud ("um", "I guess", gaps); read-out answers flow
  {
    const mid = midAnswerPauses(r);
    const perMin = mid / Math.max(0.1, (r.event.endedAt - (r.event.firstWordAt ?? r.event.askedAt)) / 60000);
    const fill = fillerRate(text);
    const human = Math.min(1, fill / 1.5) * 0.7 + Math.min(1, perMin / 4) * 0.5;
    out.push({ method: "pauses", value: clamp((0.85 - human) * short), why: `${mid} thinking pause${mid === 1 ? "" : "s"}, ${fill.toFixed(1)} "um"s or hedges per 50 words` });
  }

  // 6 Steady reading-speed delivery (reading aloud runs ~150 wpm with no slow-downs)
  {
    const baseWpm = r.baseline?.wpm;
    const fast = clamp((rate - 138) / 22);
    const noSlowdown = !easy && !ownCode && baseWpm != null && rate > baseWpm * 0.95 && rate > NORMS.readingWpm ? 0.2 : 0;
    out.push({ method: "steady_rate", value: clamp((fast + noSlowdown) * short), why: `${rate.toFixed(0)} words a minute${baseWpm != null ? ` (their warm-up: ${baseWpm.toFixed(0)})` : ""}; reading aloud is about 150` });
  }

  // 7 AI shadow answer similarity
  {
    // Compared with every AI answer we have (shadowAnswer + aiAnswers: the AI library and the Questions tab)
    const best = closestShadow(text, q);
    const shared = consensusHits(text, q);
    const consensus = shared.total ? clamp((shared.hits.length - 1) / 4) : 0; // 2+ shared AI phrases start to count
    const value = Math.max(clamp((best.similarity - 0.1) * 1.6), consensus);
    const who = best.of > 1 ? ` (closest: ${best.model}, of ${best.of} AI answers)` : "";
    out.push({ method: "ai_similarity", value, why: consensus > clamp((best.similarity - 0.1) * 1.6) ? `Uses ${shared.hits.length} phrases that several AI models all used, like "${shared.hits[0]}"` : `${(best.similarity * 100).toFixed(0)}% overlap with what an AI would say${who}` });
  }

  // 8 LLM style (Groq when available, else heuristic). Trap questions fold in here: confidently
  // describing a feature that doesn't exist is the classic chatbot tell.
  {
    let style = llmStyleOverride ?? (() => {
      const h = llmStyleHeuristic(text);
      return { value: h.value, why: h.markers.length ? `Chatbot-style phrasing: "${h.markers.slice(0, 3).join('", "')}"` : h.value > 0.3 ? "Polished, list-like wording with no thinking out loud" : "Sounds like natural speech" };
    })();
    if (q.kind === "trap" && n >= 6) {
      const honest = admitsNotKnowing(text);
      style = honest
        ? { value: Math.min(style.value, 0.1), why: "Admitted not knowing the made-up feature (honest)" }
        : { value: Math.max(style.value, 0.95), why: "Confidently described a feature that doesn't exist" };
    }
    out.push({ method: "llm_style", value: clamp(style.value), why: style.why });
  }

  // 9 GitHub consistency: claimed tech not in their repos, inflated years, or "your own code" with no specifics
  {
    const claims = unsupportedClaims(text, r.profile);
    const yrs = overstatedYears(text, r.profile);
    const spec = repoSpecifics(text, q, r.profile);
    let value = Math.min(0.7, claims.length * 0.35) + (yrs ? 0.4 : 0);
    const why: string[] = [];
    if (claims.length) why.push(`Mentions ${claims.join(", ")}, not found in their GitHub`);
    if (yrs) why.push(`Claims ${yrs} years; GitHub account is ${r.profile!.accountAgeYrs} years old`);
    if (spec && n >= 12) {
      if (spec.hits === 0) { value = Math.max(value, n >= 20 ? 0.9 : 0.75); why.unshift(`Talked about their own repo ${spec.repo} without naming anything actually in it`); }
      else if (spec.hits === 1) { value = Math.max(value, 0.35); why.push(`Only one concrete detail about ${spec.repo}`); }
      else why.push(`Named ${spec.hits} real details from ${spec.repo}`);
    }
    out.push({ method: "github_mismatch", value: clamp(value), why: why.join(". ") || (r.profile ? "Claims match their GitHub" : "No GitHub profile loaded") });
  }

  // 10 Easy vs hard: a hard question answered as fast and smoothly as the easy ones is backwards.
  // (Skipped for "your own code": the real author SHOULD answer that quickly.)
  // (Also skipped for an honest "never heard of it" on a trap: that answer is naturally quick.)
  if (r.easyVsHard && !easy && !ownCode && !(q.kind === "trap" && admitsNotKnowing(text))) {
    const latRatio = lat / Math.max(300, r.easyVsHard.easyLatencyMs);
    const rateRatio = rate / Math.max(60, r.easyVsHard.easyWpm);
    // Fast is only suspicious when it's also smooth: a quick answer full of "um"s and hedges is a fast thinker
    const smooth = Math.max(0.25, clamp(1 - fillerRate(text) / 2));
    const value = (clamp((1.6 - latRatio) / 0.6) * 0.6 + clamp((rateRatio - 0.92) / 0.1) * 0.4) * smooth;
    out.push({ method: "easy_vs_hard", value: clamp(value * short), why: latRatio < 1.4 ? `Hard question answered as fast as the easy ones (${latRatio.toFixed(1)}× their warm-up delay)` : "Took longer on the hard question than the easy ones (normal)" });
  }

  // 11 Manual: environment checklist
  const c = r.checklist;
  const ticks = [c.earpiece, c.glassesReflection, c.virtualBackground].filter(Boolean).length + (c.idShown ? 0 : 0.5);
  if (ticks > 0) out.push({ method: "manual", value: clamp(ticks * 0.35), why: [c.earpiece && "earpiece", c.glassesReflection && "glasses reflection", c.virtualBackground && "virtual background", !c.idShown && "no ID shown"].filter(Boolean).join(", ") });

  return out;
}
