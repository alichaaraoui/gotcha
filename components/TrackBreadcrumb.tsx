// Stage breadcrumb + question list; asked questions are greyed out.
// OWNER: Person 1
import type { Question, Track } from "@/lib/types";

export function TrackBreadcrumb({ track, questions, asked, currentId, onPick }: {
  track: Track; questions: Question[]; asked: string[]; currentId?: string; onPick: (q: Question) => void;
}) {
  const current = questions.find((q) => q.id === currentId);
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        {track.stages.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1">
            <span className={`rounded px-2 py-1 ${current?.stage === s.id ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-300"}`}>{s.label}</span>
            {i < track.stages.length - 1 && <span className="text-slate-600">→</span>}
          </span>
        ))}
      </div>
      <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
        {questions.map((q) => (
          <li key={q.id}>
            <button
              onClick={() => onPick(q)}
              className={`w-full rounded px-2 py-1 text-left hover:bg-slate-800 ${q.id === currentId ? "bg-slate-800" : ""} ${asked.includes(q.id) ? "text-slate-600 line-through" : ""}`}
            >
              <span className="mr-2 text-[10px] uppercase text-slate-500">{q.stage}·{q.kind}</span>{q.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
