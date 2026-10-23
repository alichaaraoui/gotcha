// OWNER: Person 2
// Personalizes the track's probe questions with real repos, asks Groq for 2 extra personal
// questions + shadow answers, and generates a shadow answer for "Ask your own".
// Every path has a local fallback, so this works with the Wi-Fi off.
import { NextResponse } from "next/server";
import tracks from "@/data/tracks.json";
import fallbackProfile from "@/data/fixtures/github_fallback.json";
import { customQuestion, personalQuestions, personalizeTrack } from "@/lib/questions";
import type { CandidateProfile, QuestionsRequest, QuestionsResponse, Track } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as QuestionsRequest;

  // "Ask your own" question typed live by the recruiter
  if (body.custom?.trim()) {
    const { question, source } = await customQuestion(body.custom.trim());
    return NextResponse.json({ personalized: [question], source } satisfies QuestionsResponse);
  }

  const profile = body.profile?.repos ? body.profile : (fallbackProfile as CandidateProfile);
  const track = (tracks as Track[]).find((t) => t.id === body.trackId) ?? (tracks as Track[])[0];
  // Same ids as the track's {repo} probes (e.g. be-p1), so they replace the generic version in place
  const probes = personalizeTrack(track, profile);
  const extra = await personalQuestions(profile, track);
  return NextResponse.json({ personalized: [...probes, ...extra.questions], source: extra.source } satisfies QuestionsResponse);
}
