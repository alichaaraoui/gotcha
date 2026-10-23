// Storyboard-style strip of the interview so far: one tile per answered question.
// OWNER: Person 1
import type { Flag, Question, Score } from "@/lib/types";
import { LEVEL_STYLE } from "@/components/ui";

export function Timeline({ path, questions, scores, flags, onPick }: {
  path: string[]; questions: Question[]; scores: Score[]; flags: Flag[]; onPick: (q: Question) => void;
}) {
  if (!path.length) return <div className="text-xs text-white/40">The interview timeline fills in as you ask questions.</div>;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {path.map((id, i) => {
        const q = questions.find((x) => x.id === id);
        const sc = scores.find((x) => x.questionId === id);
        const flagged = flags.some((f) => f.questionId === id);
        if (!q) return null;
        return (
          <button key={id} onClick={() => onPick(q)} className="group relative w-40 shrink-0 rounded-2xl border border-white/10 bg-white/[0.07] p-3 text-left hover:bg-white/[0.12]">
            <div className="flex items-center justify-between text-[10px] text-white/45">
              <span>{String(i + 1).padStart(2, "0")} · {q.stage}</span>
              {flagged && <span className="text-flag">⚑</span>}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-white/85">{q.text}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-1 flex-1 rounded-full bg-white/10">
                <span className={`block h-1 rounded-full ${sc ? LEVEL_STYLE[sc.level].dot : "bg-white/30"}`} style={{ width: `${sc?.risk ?? 8}%` }} />
              </span>
              <span className="text-[10px] tabular-nums text-white/60">{sc ? `${sc.risk}%` : "…"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
