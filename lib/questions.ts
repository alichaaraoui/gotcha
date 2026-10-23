// Personalized questions from the candidate's GitHub. Pure helpers + one Groq call with local fallbacks.
// Used by /api/questions (and scripts/score-demo.mjs, so the demo scores the same questions the app asks).
// OWNER: Person 2
import type { CandidateProfile, Question, Repo, Track } from "@/lib/types";
import { groqJson } from "@/lib/groq";
import { words } from "@/lib/scoring/text";

const BACKEND = ["Python", "Go", "Java", "Rust", "Ruby", "Kotlin", "C#", "Elixir", "PHP", "Scala", "C++", "C"];
const FRONTEND = ["TypeScript", "JavaScript", "Vue", "Svelte", "HTML", "CSS", "Astro"];
const SKIP = /^(dotfiles|\.github|config|notes|resume|cv|homework|test|tmp)$|\.github\.io$/i;

/** Repos ordered by how good they are to ask about: on-track language, described, starred, recent. */
export function rankRepos(profile: CandidateProfile, track?: Pick<Track, "id">): Repo[] {
  const langs = track?.id.startsWith("frontend") ? FRONTEND : BACKEND;
  const score = (r: Repo) =>
    (r.language && langs.includes(r.language) ? 3 : r.language ? 1 : 0) +
    (r.description ? 2 : 0) +
    Math.log10(r.stars + 1) +
    Math.max(0, 1 - (Date.now() - Date.parse(r.lastPush)) / (365 * 86400000));
  const usable = profile.repos.filter((r) => !SKIP.test(r.name) && r.name.toLowerCase() !== profile.login.toLowerCase());
  return [...(usable.length ? usable : profile.repos)].sort((a, b) => score(b) - score(a));
}

/** Words a real author would naturally use about this repo (for the recruiter's "good answer" hint). */
function repoWords(r: Repo): string[] {
  const generic = new Set(["the", "and", "for", "with", "that", "small", "simple", "app", "api", "service", "tool", "project", "built", "using", "backed", "front"]);
  return [...new Set(words(`${r.description ?? ""} ${r.language ?? ""}`).flatMap((w) => w.split("-")).filter((w) => w.length > 3 && !generic.has(w)))].slice(0, 4);
}

// Lowercase the first letter for mid-sentence use, but keep "I" and acronyms/names ("API", "Redis")
const lowerFirst = (s: string) => (/^(I\b|[A-Z]{2}|[A-Z][a-z]+[A-Z])/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** Fill {repo} in the track's own-code probes, including the AI shadow answer and the hint. */
export function personalizeTrack(track: Track, profile: CandidateProfile): Question[] {
  const repo = rankRepos(profile, track)[0];
  if (!repo) return [];
  const kw = repoWords(repo);
  return track.stages.flatMap((s) => s.questions).filter((q) => q.text.includes("{repo}")).map((q) => ({
    ...q,
    text: q.text.replaceAll("{repo}", repo.name),
    repoRef: repo.name,
    shadowAnswer: `In ${repo.name}, ${lowerFirst(q.shadowAnswer)}`,
    goodAnswerHint: `${q.goodAnswerHint}${repo.description ? ` ${repo.name} is "${repo.description}"` : ""}${kw.length ? `, so expect words like ${kw.join(", ")}.` : "."}`,
  }));
}

type GenQ = { text: string; topic: string; shadowAnswer: string; goodAnswerHint: string; repoRef: string };

/** Offline stand-ins for Groq's 2 personal questions. Shadow answers are what a chatbot would say. */
function fallbackPersonal(profile: CandidateProfile, track: Track): GenQ[] {
  const ranked = rankRepos(profile, track);
  const a = ranked[1] ?? ranked[0], b = ranked[0];
  if (!a || !b) return [];
  const what = (r: Repo) => (r.description ? `"${r.description.replace(/\.$/, "")}"` : `a ${r.language ?? "software"} project`);
  return [
    {
      text: `In ${a.name}, what was the hardest decision you made, and would you make it again?`,
      topic: "own-code",
      repoRef: a.name,
      shadowAnswer: `In ${a.name}, the hardest decision was choosing the right architecture. I evaluated the trade-offs between simplicity and scalability, and ultimately chose a modular approach that kept the code maintainable. In hindsight, I would make the same decision, while adding more comprehensive tests and documentation.`,
      goodAnswerHint: `${a.name}: ${what(a)}. The author names a specific library, file or bug straight away. Vague talk about "trade-offs" is a warning sign.`,
    },
    {
      text: `What broke first in ${b.name} once real people used it, and how did you find out?`,
      topic: "debugging",
      repoRef: b.name,
      shadowAnswer: `The first issue in ${b.name} was performance under load. I identified it through monitoring and logging, then optimized the bottleneck and added error handling. Additionally, I implemented automated tests to ensure the issue would not happen again. Overall, it highlighted the importance of observability.`,
      goodAnswerHint: `Real answers tell a small story: who noticed, what the error looked like, the actual fix. "Monitoring and optimization" with no details is generic.`,
    },
  ];
}

const PERSONAL_SYSTEM = `You help a non-technical recruiter interview a software engineer, using the engineer's real GitHub repos.
Write exactly 2 questions that only the real author of those repos could answer well: why they made a specific choice, what broke, what they would change, how a specific part works.
Each question will be read ALOUD by the recruiter, so: one question, under 25 words, casual spoken English, name the repo, no jargon the recruiter can't pronounce, not yes/no.
For each also write:
- shadowAnswer: what ChatGPT would answer if the candidate pasted the question in. Polished, generic, structured (firstly/additionally/overall), no real file names, 50-80 words, first person.
- goodAnswerHint: one plain-English sentence telling the recruiter what a real author's answer contains (specific files, libraries, bugs, numbers).
- topic: one lowercase word. repoRef: the exact repo name.
Return JSON {"questions":[{"text","topic","shadowAnswer","goodAnswerHint","repoRef"}]}.`;

const okText = (s: unknown, min: number, max: number): s is string => typeof s === "string" && s.trim().length >= min && s.trim().length <= max;

/** 2 extra personal questions. Groq when available (validated field by field), local templates otherwise. */
export async function personalQuestions(profile: CandidateProfile, track: Track): Promise<{ questions: Question[]; source: "groq" | "fallback" }> {
  const ranked = rankRepos(profile, track).slice(0, 5);
  const fb = fallbackPersonal(profile, track);
  const names = new Set(profile.repos.map((r) => r.name));
  const g = ranked.length
    ? await groqJson<{ questions?: Partial<GenQ>[] }>(
        PERSONAL_SYSTEM,
        `Role: ${track.role}\nTop languages: ${profile.topLanguages.map((l) => l.lang).join(", ")}\nRepos:\n${ranked.map((r) => `- ${r.name} (${r.language ?? "?"}, ${r.stars}★): ${r.description ?? "no description"}`).join("\n")}`,
        { timeoutMs: 6000, temperature: 0.4 },
      )
    : null;
  const gen = (g?.questions ?? []).filter((q) => okText(q.text, 15, 220) && q.text!.includes("?") && okText(q.shadowAnswer, 80, 900)).slice(0, 2);
  const merged: GenQ[] = fb.map((f, i) => {
    const q = gen[i];
    if (!q) return f;
    const repoRef = q.repoRef && names.has(q.repoRef) ? q.repoRef : [...names].find((n) => q.text!.includes(n)) ?? f.repoRef;
    return {
      text: q.text!.trim(),
      shadowAnswer: q.shadowAnswer!.trim(),
      goodAnswerHint: okText(q.goodAnswerHint, 10, 300) ? q.goodAnswerHint.trim() : f.goodAnswerHint,
      topic: okText(q.topic, 2, 30) ? q.topic.trim().toLowerCase() : f.topic,
      repoRef,
    };
  });
  return {
    questions: merged.map((q, i) => ({ ...q, id: `gh-${i}`, kind: "probe", stage: "probe", probeStyle: "own-code" })),
    source: gen.length ? "groq" : "fallback",
  };
}

const SHADOW_SYSTEM =
  'You are the AI copilot a candidate might secretly use in an interview. Answer the question exactly like ChatGPT would if it were pasted in: polished, structured (firstly/additionally/overall), generic, first person, 60-90 words. Return JSON {"answer": string, "hint": string} where hint is one plain-English sentence telling a non-technical recruiter what a REAL engineer\'s answer would include.';

/** Offline shadow answer for "Ask your own": the generic, scaffolded shape chatbot answers share. */
export function fallbackShadow(question: string): string {
  const q = question.trim().replace(/[?.!]+$/, "");
  const how = q.match(/^how (?:would|do|did|could|should|will|can) you (.+)$/i);
  const opener = how ? `To ${how[1]}, I would take a structured approach.` : `When it comes to "${q}", I would take a structured approach.`;
  return `Great question. ${opener} Firstly, I'd clarify the requirements and constraints. Additionally, I'd evaluate the trade-offs between the main options, considering scalability, performance and maintainability. Finally, I'd implement a robust solution, monitor it and iterate based on feedback. Overall, the key is balancing simplicity with best practices.`;
}

export async function customQuestion(text: string): Promise<{ question: Question; source: "groq" | "fallback" }> {
  const g = await groqJson<{ answer?: string; hint?: string }>(SHADOW_SYSTEM, text, { timeoutMs: 4000, temperature: 0.2 });
  const ok = okText(g?.answer, 60, 1200);
  return {
    question: {
      id: `custom-${Date.now()}`,
      text,
      kind: "custom",
      stage: "deep",
      topic: "custom",
      shadowAnswer: ok ? g!.answer!.trim() : fallbackShadow(text),
      goodAnswerHint: ok && okText(g?.hint, 10, 300) ? g!.hint!.trim() : "Real answers include specific details from their own work, and some thinking out loud.",
    },
    source: ok ? "groq" : "fallback",
  };
}
