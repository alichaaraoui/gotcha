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

  // "Dig deeper": 3 ready-to-ask ideas, about one repo or about their last answer
  if (body.ideas) {
    const { focus, repo: repoName, lastQuestion, lastAnswer } = body.ideas;
    const repos = profile.repos.filter((r) => !repoName || r.name === repoName).slice(0, 4);
    const repoList = repos.map((r) => `${r.name} (${r.language ?? "?"}, last push ${r.lastPush.slice(0, 10)}): ${r.description ?? ""}`).join("\n");
    const ask =
      focus === "github"
        ? `Write 3 questions about this repo work. Mix: one about a design choice (why), one about something that broke or was hard, one about what they'd change now.\nRepos:\n${repoList}`
        : `Write 3 follow-up questions that push deeper on their last answer and connect it to their real repos.\nQuestion: ${lastQuestion}\nTheir answer: ${lastAnswer}\nTheir repos:\n${repoList}`;
    const g = await groqJson<{ questions: { text: string; why: string; repoRef?: string; shadowAnswer: string; goodAnswerHint: string }[] }>(
      "You help a NON-technical recruiter dig deeper in a live software-engineering interview and tell real experience from AI-fed answers. Questions must be short (max 28 words), natural to say out loud, and specific: name the repo, file type, library or decision. For each give: why (max 10 words, what it reveals), shadowAnswer (the generic polished answer ChatGPT would give, 40-60 words), goodAnswerHint (one plain sentence: what a genuine answer sounds like). Return JSON {questions:[{text, why, repoRef, shadowAnswer, goodAnswerHint}]}.",
      ask,
      8000
    );
    const r0 = repos[0];
    const ideas: Question[] = (g?.questions?.length
      ? g.questions.slice(0, 3).map((q, i) => ({ ...q, repoRef: q.repoRef || r0?.name, id: `idea-${Date.now()}-${i}` }))
      : (focus === "github" && r0
          ? [
              { text: `Why did you build ${r0.name} in ${r0.language ?? "that language"}? What did you consider instead?`, why: "Design choices only the author knows" },
              { text: `What was the hardest bug in ${r0.name}, and how did you finally track it down?`, why: "Real debugging stories have odd details" },
              { text: `If you rewrote ${r0.name} today, what's the first thing you'd change?`, why: "Authors have specific regrets" },
            ]
          : [
              { text: "Can you walk me through a specific time you actually did that? What went wrong?", why: "Moves from theory to a real story" },
              { text: "What would break first if the traffic were ten times higher?", why: "Tests thinking, not memorized answers" },
              { text: "Where in your own code could I see that? Which file?", why: "Ties the claim to their GitHub" },
            ]
        ).map((q, i) => ({ ...q, repoRef: r0?.name, id: `idea-${Date.now()}-${i}`, shadowAnswer: "AI answer unavailable offline. Judge on specifics: real names, real problems, real mistakes.", goodAnswerHint: "A real answer names specific files, tools or mistakes without pausing to 'look it up'." }))
    ).map((q) => ({ ...q, kind: "probe" as const, stage: "deep" as const, topic: focus === "github" ? "own-code" : "follow-up" }));
    return NextResponse.json({ personalized: ideas, source: g ? "groq" : "fallback" } satisfies QuestionsResponse);
  }

  // "Push for more": one follow-up tailored to their GitHub and to what just sounded off
  if (body.followUp) {
    const f = body.followUp;
    const repoList = profile.repos.slice(0, 6).map((r) => `${r.name} (${r.language ?? "?"}): ${r.description ?? ""}`).join("\n");
    const g = await groqJson<{ question: string; repoRef: string; topic: string; shadowAnswer: string; goodAnswerHint: string }>(
      "You help a NON-technical recruiter catch candidates who read AI-generated answers in live interviews. Write ONE short follow-up question (max 30 words, natural to say out loud) that only the real author of their GitHub work could answer: tie it to a SPECIFIC repo by name and to what they just claimed. Prefer asking why they made a choice, what broke, or what they'd change. Also write shadowAnswer: the polished, generic answer ChatGPT would give (50-70 words), and goodAnswerHint: one plain-English sentence on what a genuine answer sounds like. Return JSON {question, repoRef, topic, shadowAnswer, goodAnswerHint}.",
      `Their repos:\n${repoList}\nTop languages: ${profile.topLanguages.map((l) => l.lang).join(", ")}\n\nQuestion asked: ${f.question}\nTheir answer: ${f.answer}\nWhy it looked off: ${f.reasons.join("; ")}`,
      6000
    );
    const repo = profile.repos[0];
    const q: Question = g?.question
      ? { id: `fu-${Date.now()}`, text: g.question, kind: "probe", stage: "probe", probeStyle: "own-code", topic: g.topic || "own-code", repoRef: g.repoRef || repo?.name, shadowAnswer: g.shadowAnswer, goodAnswerHint: g.goodAnswerHint }
      : {
          id: `fu-${Date.now()}`,
          text: repo
            ? `Let's make that concrete: in ${repo.name}, show me where you actually did that. Which file, and what went wrong the first time?`
            : "Let's make that concrete: tell me about one specific time you did that, and what went wrong.",
          kind: "probe",
          stage: "probe",
          probeStyle: "own-code",
          topic: "own-code",
          repoRef: repo?.name,
          shadowAnswer: `In ${repo?.name ?? "that project"}, I implemented this in the core module, following best practices for modularity. Initially I faced some challenges with edge cases, which I resolved through thorough testing and refactoring.`,
          goodAnswerHint: "The real author names a file or function right away and remembers a specific mistake. Vague 'best practices' talk is a warning sign.",
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
