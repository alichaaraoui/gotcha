// The recruiter's own question list → checkable questions + "gotcha" follow-ups.
// Each question gets what an AI would answer (so the scorer can compare) and a plain-English hint.
// Gotchas use the probe styles the scorer understands: a constraint change, a made-up feature (trap),
// "the last time you actually did this", and their own repo when a GitHub profile is loaded.
// Groq when available (rotating models: free limits are per model), offline templates otherwise.
// OWNER: Person 2
import type { CandidateProfile, ProbeStyle, Question, QuestionKind, StageId } from "@/lib/types";
import { GROQ_MODELS, MODEL_LABEL, groqJson } from "@/lib/groq";
import { fallbackShadow, rankRepos } from "@/lib/questions";
import { techMentioned } from "@/lib/scoring/signals";
import { words } from "@/lib/scoring/text";

export type GotchaStyle = "constraint-change" | "knowledge-boundary" | "real-experience" | "own-code";
export const GOTCHA_STYLES: { id: GotchaStyle; label: string; explain: string }[] = [
  { id: "constraint-change", label: "Change the rules", explain: "Same problem, one thing changes. Real engineers adapt; a read-out answer starts over." },
  { id: "knowledge-boundary", label: "Made-up feature", explain: "Asks about something that doesn't exist. \"Not sure\" is the honest answer." },
  { id: "real-experience", label: "Last time you did it", explain: "Forces a real story: what broke, who noticed, the actual fix." },
  { id: "own-code", label: "Their own code", explain: "Ties it to their GitHub repo. Only the author knows the details." },
];

export interface GotchaRequest {
  questions: string[];
  styles?: GotchaStyle[];
  profile?: CandidateProfile | null;
  trackId?: string;
}
export interface GotchaSet {
  question: Question; // the recruiter's question, now with a shadow answer + hint
  gotchas: Question[];
  source: "groq" | "fallback";
}

export const MAX_QUESTIONS = 12;
const okText = (s: unknown, min: number, max: number): s is string => typeof s === "string" && s.trim().length >= min && s.trim().length <= max;

/** Stable short id from text, so preparing the same list twice doesn't duplicate questions. */
function hashId(text: string): string {
  let h = 2166136261;
  for (const c of text.toLowerCase().trim()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}

export function parseQuestionList(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim())
    .filter((l) => l.length >= 8 && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()))
    .slice(0, MAX_QUESTIONS);
}

const EASY = /^(what('s| is) your (favou?rite|go-to)|tell me about (yourself|your background)|why do you want|what do you (like|enjoy)|how did you get into|what are you (learning|working on))/i;
const STOPWORDS = new Set("what how why when where which who would could should your you the a an and or to of in on for is are do does did have has with that this it about me tell walk through explain describe".split(" "));

function guessTopic(text: string): string {
  const tech = techMentioned(text)[0];
  if (tech) return tech.toLowerCase();
  return words(text).find((w) => w.length > 4 && !w.includes("'") && !STOPWORDS.has(w)) ?? "general";
}

// ---------- offline templates ----------
const TWISTS = ["traffic is 100 times higher", "you have one day to ship it", "the main database just went down", "you only have a tenth of the budget", "the data has to stay in the EU"];
// Invented on purpose (never let the LLM invent these: it once offered Redis's real DEBUG SLEEP as "fake").
const FAKES = ["--safe-replay flag", "shadow-commit option", "lazy-quorum flag", "--fold-index flag", "twin-lock mode"];

function fallbackSet(text: string, styles: GotchaStyle[], profile?: CandidateProfile | null, trackId?: string): GotchaSet {
  const id = hashId(text);
  const n = parseInt(id, 36);
  const kind: QuestionKind = EASY.test(text) ? "easy" : "hard";
  const topic = guessTopic(text);
  const tech = techMentioned(text)[0] ?? profile?.topLanguages[0]?.lang;
  const repo = profile ? rankRepos(profile, trackId ? { id: trackId } : undefined)[0] : undefined;
  const gotchas: Question[] = [];
  const add = (style: GotchaStyle, g: Pick<Question, "text" | "shadowAnswer" | "goodAnswerHint"> & { repoRef?: string }) =>
    gotchas.push(toGotcha(id, gotchas.length, style, topic, g));

  for (const style of styles) {
    if (style === "constraint-change") {
      const twist = TWISTS[n % TWISTS.length];
      add(style, {
        text: `Same question, but now ${twist}. What would you change?`,
        shadowAnswer: `If ${twist}, I would revisit my approach. Firstly, I'd prioritize the most critical components and identify bottlenecks. Additionally, I'd evaluate trade-offs between cost, performance and reliability. Overall, the key is to adapt the design while ensuring scalability and maintainability.`,
        goodAnswerHint: "A real engineer says which part of their first answer breaks first, and why. Starting over with a fresh generic list is a warning sign.",
      });
    } else if (style === "knowledge-boundary" && tech) {
      const fake = FAKES[n % FAKES.length];
      add(style, {
        text: `Have you used the ${fake} in ${tech}? How did it behave?`,
        shadowAnswer: `Yes, the ${fake} in ${tech} is useful for improving consistency under load. It ensures operations are coordinated more strictly, which enhances reliability, though it can increase latency in high-throughput scenarios. I'd recommend enabling it selectively.`,
        goodAnswerHint: `The ${fake} doesn't exist. "Not sure, I haven't heard of it" is the honest answer; a confident description is a red flag.`,
      });
    } else if (style === "real-experience") {
      add(style, {
        text: "Think of the last time you actually did this. What went wrong, and how did you find out?",
        shadowAnswer: "In a previous project, we encountered performance issues in production. I identified the root cause through monitoring and logging, then implemented a fix and added automated tests. Additionally, I documented the incident to prevent recurrence. Overall, it highlighted the importance of observability.",
        goodAnswerHint: "Real stories have small specifics: who noticed, what the error said, a date or a number, what they'd do differently. \"Monitoring and logging\" with no details is generic.",
      });
    } else if (style === "own-code" && repo) {
      add(style, {
        text: `Where in ${repo.name} did you deal with something like this? Walk me through the actual code.`,
        repoRef: repo.name,
        shadowAnswer: `In ${repo.name}, I handled this by following a modular architecture to separate concerns. I implemented the core logic in a dedicated service layer and added error handling and tests. Looking back, I would improve documentation and add more comprehensive testing.`,
        goodAnswerHint: `They wrote ${repo.name}${repo.description ? ` ("${repo.description}")` : ""}, so they should name a real file or function right away.`,
      });
    }
  }
  return {
    question: { id: `mine-${id}`, text, kind, stage: stageFor(kind), topic, shadowAnswer: fallbackShadow(text), goodAnswerHint: "Real answers include specific details from their own work, and some thinking out loud.", followUps: gotchas.map((g) => g.id) },
    gotchas,
    source: "fallback",
  };
}

const stageFor = (kind: QuestionKind): StageId => (kind === "easy" ? "warmup" : "core");

const PROBE_STYLE: Record<GotchaStyle, ProbeStyle | undefined> = {
  "constraint-change": "constraint-change",
  "knowledge-boundary": "knowledge-boundary",
  "own-code": "own-code",
  "real-experience": undefined,
};

function toGotcha(parentId: string, i: number, style: GotchaStyle, topic: string, g: Pick<Question, "text" | "shadowAnswer" | "goodAnswerHint"> & { repoRef?: string }): Question {
  return {
    id: `gotcha-${parentId}-${i}`,
    text: g.text,
    // a made-up feature is a trap: the scorer rewards "not sure" and flags confident answers
    kind: style === "knowledge-boundary" ? "trap" : "probe",
    stage: "probe",
    topic,
    probeStyle: PROBE_STYLE[style],
    shadowAnswer: g.shadowAnswer,
    goodAnswerHint: g.goodAnswerHint,
    ...(g.repoRef ? { repoRef: g.repoRef } : {}),
  };
}

// ---------- Groq ----------
const SYSTEM = (styles: GotchaStyle[], repo?: string) => `You help a non-technical recruiter catch candidates who secretly read answers from ChatGPT during a live technical interview.
For the interview question given, return JSON:
{"topic": one lowercase word,
 "shadowAnswer": what ChatGPT would answer if the question were pasted in (polished, structured, first person, 50-70 words),
 "goodAnswerHint": one plain-English sentence on what a REAL engineer's answer contains,
 "gotchas": [{"style", "text", "shadowAnswer", "goodAnswerHint"}]}
Write exactly one gotcha for each of these styles, in this order: ${styles.join(", ")}.
- constraint-change: same problem, but one concrete constraint changes (scale, time, budget, an outage).
- real-experience: make them describe the last real time they did this (what broke, who noticed, the fix).
- own-code: tie the question to their GitHub repo ${repo ? `"${repo}"` : "(none: skip)"} and ask them to walk through the actual code.
Every gotcha "text" is ONE question under 25 words, natural to say aloud, no jargon a recruiter can't pronounce.
Gotcha shadowAnswer: what ChatGPT would say, 30-50 words. goodAnswerHint: one plain sentence, no accusations.`;

const ANSWER_SYSTEM =
  'A job candidate secretly pasted this interview question into an AI assistant. Write exactly what that assistant would answer: first person, polished, structured, 50-70 words, no real file or company names. Return JSON {"answer": string}.';

/** The same question answered by other models: candidates use different AIs, so we compare against several. */
async function otherAnswers(text: string, models: string[]): Promise<{ model: string; text: string }[]> {
  const got = await Promise.all(
    models.map(async (model) => {
      const g = await groqJson<{ answer?: string }>(ANSWER_SYSTEM, `Interview question: ${text}`, { timeoutMs: 9000, temperature: 0.7, maxTokens: 300, model, retry429: true });
      return okText(g?.answer, 60, 1200) ? { model: MODEL_LABEL[model] ?? model, text: g!.answer!.trim() } : null;
    }),
  );
  return got.filter((x): x is { model: string; text: string } => !!x);
}

type GroqSet = { topic?: string; shadowAnswer?: string; goodAnswerHint?: string; gotchas?: { style?: string; text?: string; shadowAnswer?: string; goodAnswerHint?: string }[] };

async function groqSet(text: string, styles: GotchaStyle[], model: string, profile?: CandidateProfile | null, trackId?: string): Promise<GotchaSet | null> {
  const repo = profile ? rankRepos(profile, trackId ? { id: trackId } : undefined)[0] : undefined;
  const asked = styles.filter((s) => s !== "own-code" || repo);
  // Traps always come from our own invented names (see FAKES), never from the LLM
  const forGroq = asked.filter((s) => s !== "knowledge-boundary");
  const [g, others] = await Promise.all([
    groqJson<GroqSet>(SYSTEM(forGroq, repo?.name), `Interview question: ${text}${repo ? `\nTheir repo: ${repo.name}: ${repo.description ?? ""}` : ""}`, { timeoutMs: 9000, temperature: 0.5, maxTokens: 1000, model, retry429: true }),
    otherAnswers(text, GROQ_MODELS.filter((m) => m !== model)),
  ]);
  if (!g || !okText(g.shadowAnswer, 60, 1200)) return null;
  const fb = fallbackSet(text, asked, profile, trackId); // fills any field Groq got wrong
  const id = fb.question.id.slice("mine-".length);
  const kind = fb.question.kind; // our rule, not the LLM's: "easy" makes it a warm-up (the baseline)
  const topic = okText(g.topic, 2, 30) ? g.topic.trim().toLowerCase().split(/\s+/)[0] : fb.question.topic;
  const gotchas: Question[] = [];
  for (const style of asked) {
    const x = style === "knowledge-boundary" ? undefined : (g.gotchas ?? []).find((y) => y.style === style);
    const valid = x && okText(x.text, 12, 220) && x.text.includes("?") && okText(x.shadowAnswer, 40, 900);
    const backup = fb.gotchas.find((q) => q.probeStyle === PROBE_STYLE[style] && (style !== "real-experience" || !q.probeStyle));
    if (valid) gotchas.push(toGotcha(id, gotchas.length, style, topic, { text: x.text!.trim(), shadowAnswer: x.shadowAnswer!.trim(), goodAnswerHint: okText(x.goodAnswerHint, 10, 300) ? x.goodAnswerHint.trim() : backup?.goodAnswerHint ?? "", repoRef: style === "own-code" ? repo?.name : undefined }));
    else if (backup) gotchas.push({ ...backup, id: `gotcha-${id}-${gotchas.length}` });
  }
  return {
    question: { ...fb.question, kind, stage: stageFor(kind), topic, shadowAnswer: g.shadowAnswer!.trim(), shadowAnswers: [{ model: MODEL_LABEL[model] ?? model, text: g.shadowAnswer!.trim() }, ...others], goodAnswerHint: okText(g.goodAnswerHint, 10, 300) ? g.goodAnswerHint.trim() : fb.question.goodAnswerHint, followUps: gotchas.map((q) => q.id) },
    gotchas,
    source: "groq",
  };
}

/** Prepare the whole list: up to 3 questions in flight (one per model), each falling back on its own. */
export async function prepareGotchas(req: GotchaRequest): Promise<GotchaSet[]> {
  const styles = (req.styles?.length ? req.styles : GOTCHA_STYLES.map((s) => s.id)).filter((s, i, a) => a.indexOf(s) === i);
  const list = req.questions.map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUESTIONS);
  const out: GotchaSet[] = new Array(list.length);
  let next = 0;
  await Promise.all(
    GROQ_MODELS.map(async (model, lane) => {
      while (next < list.length) {
        const i = next++;
        // first try this lane's model, then one other model, then the offline template
        out[i] =
          (await groqSet(list[i], styles, model, req.profile, req.trackId)) ??
          (await groqSet(list[i], styles, GROQ_MODELS[(lane + 1) % GROQ_MODELS.length], req.profile, req.trackId)) ??
          fallbackSet(list[i], styles, req.profile, req.trackId);
      }
    }),
  );
  return out;
}
