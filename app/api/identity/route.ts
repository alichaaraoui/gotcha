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

  return NextResponse.json(
    buildIdentityReport(gh.facts, body, clean, {
      githubSource: gh.source,
      textSource: clean ? "groq" : text ? "heuristic" : "none",
      matches: login ? undefined : matches,
    }),
  );
}
