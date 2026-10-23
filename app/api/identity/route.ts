// Identity consistency check: GitHub facts + pasted LinkedIn/resume text → IdentityReport.
import { NextResponse } from "next/server";
import { groqJson } from "@/lib/groq";
import { buildIdentityReport, type TextRating } from "@/lib/identity";
import { getFacts, searchMatches } from "@/lib/identityGithub";
import type { GithubMatch, IdentityRequest } from "@/lib/types";

const SYSTEM = `You review a job candidate's pasted LinkedIn/resume text for a recruiter.
Rate how generic, AI-written, or copied-from-a-template the wording is (0 = specific and personal, 1 = pure template).
Flag at most 3 lines that look copied or templated: identical phrasing across roles, buzzword strings, claims with no concrete detail.
Reply as JSON: {"score": number, "lines": [{"text": "<exact line, max 100 chars>", "why": "<max 8 words>"}]}`;

const STORY = `You help a recruiter read who a job candidate is at a glance.
From the facts given (their own claims + public GitHub evidence + checks), write 3-4 short plain sentences (70 words max):
who they say they are, what their GitHub shows (since when, main languages, recent work), and how that fits the role.
If some checks are warn or risk, end with one neutral sentence on what is worth asking about; if all are ok, say the story holds together.
Never accuse, never guess motives, never use the word "cheater". Use only the facts given.
Reply as JSON: {"summary": "<3-4 sentences>"}`;

export async function POST(req: Request) {
  const body = (await req.json()) as IdentityRequest;
  const login = body.login?.trim();
  const text = body.pastedText?.trim() ?? "";

  const [gh, rating, matches] = await Promise.all([
    login ? getFacts(login) : Promise.resolve({ facts: null, source: "none" as const }),
    text.split(/\s+/).length >= 25 ? groqJson<TextRating>(SYSTEM, text.slice(0, 6000), 8000) : Promise.resolve(null),
    login ? Promise.resolve<GithubMatch[]>([]) : searchMatches(body.email, body.fullName, body.claimedLocation),
  ]);

  const clean: TextRating | null = rating && typeof rating.score === "number"
    ? { score: Math.max(0, Math.min(1, rating.score)), lines: Array.isArray(rating.lines) ? rating.lines.filter((l) => l?.text) : [] }
    : null;

  const report = buildIdentityReport(gh.facts, body, clean, {
    githubSource: gh.source,
    textSource: clean ? "groq" : text ? "heuristic" : "none",
    matches: login ? undefined : matches,
  });

  // Narrative from the merged facts; the deterministic summary stays if Groq is off or slow
  if (gh.facts || text) {
    const facts = {
      claims: report.story.timeline.filter((e) => e.source === "claimed").map((e) => `${e.date}: ${e.label}`),
      github: report.story.timeline.filter((e) => e.source === "github").map((e) => `${e.date}: ${e.label}`),
      checks: report.checks.filter((c) => c.status !== "unknown").map((c) => `${c.label}: ${c.status} (${c.why})`),
      draft: report.story.summary,
    };
    const g = await groqJson<{ summary: string }>(STORY, JSON.stringify(facts), 6000);
    if (g?.summary && typeof g.summary === "string" && !/cheat/i.test(g.summary)) report.story = { ...report.story, summary: g.summary.trim(), summarySource: "groq" };
  }
  return NextResponse.json(report);
}
