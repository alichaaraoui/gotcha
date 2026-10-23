// OWNER: Person 2
// Personalizes the track's probe questions with real repos, asks Groq for 2 extra personal
// questions + shadow answers, and generates a shadow answer for "Ask your own".
import { NextResponse } from "next/server";
import { groqJson } from "@/lib/groq";
import type { Question, QuestionsRequest, QuestionsResponse } from "@/lib/types";

const SHADOW_SYSTEM =
  "You are the AI copilot a cheating interview candidate would use. Answer like ChatGPT would: polished, structured, 60-90 words. Return JSON {\"answer\": string, \"hint\": string} where hint is one plain-English sentence telling a non-technical recruiter what a REAL engineer's answer would include.";

export async function POST(req: Request) {
  const body = (await req.json()) as QuestionsRequest;
  const { profile } = body;

  // "Ask your own" question typed live by the recruiter
  if (body.custom) {
    const g = await groqJson<{ answer: string; hint: string }>(SHADOW_SYSTEM, body.custom);
    const q: Question = {
      id: `custom-${Date.now()}`,
      text: body.custom,
      kind: "custom",
      stage: "deep",
      topic: "custom",
      shadowAnswer: g?.answer ?? "AI answer unavailable offline. Judge on specifics: real names, real problems, real mistakes.",
      goodAnswerHint: g?.hint ?? "Real answers include specific details and some thinking out loud.",
    };
    return NextResponse.json({ personalized: [q], source: g ? "groq" : "fallback" } satisfies QuestionsResponse);
  }

  // TODO(P2): tune this prompt; check generated questions sound natural spoken aloud
  const repos = profile.repos.slice(0, 5).map((r) => `${r.name} (${r.language ?? "?"}): ${r.description ?? ""}`).join("\n");
  const g = await groqJson<{ questions: { text: string; topic: string; shadowAnswer: string; goodAnswerHint: string; repoRef: string }[] }>(
    "You help a non-technical recruiter interview a software engineer. From their GitHub repos, write 2 interview questions only the real author could answer well (why they made a choice, what broke, what they'd change). For each also write shadowAnswer: what ChatGPT would answer if asked, polished and generic, 50-80 words. Return JSON {\"questions\":[{text, topic, shadowAnswer, goodAnswerHint, repoRef}]}.",
    `Role track: ${body.trackId}\nRepos:\n${repos}`,
    6000
  );

  const top = profile.repos[0]?.name ?? "your main project";
  const personalized: Question[] = g?.questions?.length
    ? g.questions.map((q, i) => ({ ...q, id: `gh-${i}`, kind: "hard", stage: "core" }))
    : [
        {
          id: "gh-0",
          text: `In ${top}, what was the hardest decision you made, and would you make it again?`,
          kind: "hard",
          stage: "core",
          topic: "own-code",
          repoRef: top,
          shadowAnswer: `In ${top}, the hardest decision was choosing the right architecture. I evaluated trade-offs between simplicity and scalability, ultimately choosing a modular approach. In hindsight, I would make the same decision while adding more comprehensive tests.`,
          goodAnswerHint: "The author names a specific file, library or bug instantly. Vague trade-off talk is a warning sign.",
        },
      ];
  return NextResponse.json({ personalized, source: g ? "groq" : "fallback" } satisfies QuestionsResponse);
}
