// Pre-interview brief from past interviews (learning).
// OWNER: Person 1 (display) · logic in lib/learning.ts
import type { PastInterview, Track } from "@/lib/types";
import { preInterviewBrief } from "@/lib/learning";

export function BriefCard({ history, track }: { history: PastInterview[]; track: Track }) {
  const b = preInterviewBrief(history, track);
  return (
    <div className="card space-y-2">
      <div className="label">Learned from {b.interviews} past interviews</div>
      <p className="text-sm">Time to spot an AI-assisted answer: <b>{b.minutesToFlagBefore} min</b> → <b className="text-clear">{b.minutesToFlagNow} min</b></p>
      <div className="text-sm text-slate-300">Questions that work best for this track:</div>
      <ol className="list-decimal pl-5 text-sm text-slate-400">
        {b.bestQuestions.map((q) => <li key={q.questionId}>{q.text} <span className="text-xs text-slate-500">(+{q.separation} risk gap)</span></li>)}
      </ol>
    </div>
  );
}
