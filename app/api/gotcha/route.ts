// OWNER: Person 2
// The recruiter's question list → each question with an AI shadow answer + gotcha follow-ups.
// Works offline (templates); Groq when keyed.
import { NextResponse } from "next/server";
import { MAX_QUESTIONS, parseQuestionList, prepareGotchas, type GotchaRequest } from "@/lib/gotcha";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<GotchaRequest> & { text?: string };
  const questions = body.questions?.length ? body.questions : parseQuestionList(body.text ?? "");
  if (!questions.length) return NextResponse.json({ sets: [], error: "Write at least one question (one per line)." }, { status: 400 });
  const sets = await prepareGotchas({ questions: questions.slice(0, MAX_QUESTIONS), styles: body.styles, profile: body.profile, trackId: body.trackId });
  return NextResponse.json({ sets });
}
