// Live transcript next to the AI shadow answer, shared phrases highlighted.
// OWNER: Person 1
import { overlapIndexes, similarity } from "@/lib/scoring/text";

export function TranscriptCompare({ transcript, shadow, emphasize }: { transcript: string; shadow: string; emphasize: boolean }) {
  const hits = overlapIndexes(transcript, shadow);
  const pct = transcript ? Math.round(similarity(transcript, shadow) * 100) : 0;
  return (
    <div className={`grid gap-4 md:grid-cols-2 ${emphasize ? "ring-2 ring-watch/60 rounded-xl" : ""}`}>
      <div className="card">
        <div className="label mb-2">Candidate (live)</div>
        <p className="min-h-24 leading-relaxed">
          {transcript
            ? transcript.split(/\s+/).map((w, i) => (
                <span key={i} className={hits.has(i) ? "rounded bg-flag/30 text-red-100" : ""}>{w} </span>
              ))
            : <span className="text-slate-500">Waiting for the answer…</span>}
        </p>
      </div>
      <div className="card">
        <div className="mb-2 flex justify-between">
          <span className="label">What an AI would say</span>
          <span className="text-sm font-semibold tabular-nums">{pct}% match</span>
        </div>
        <p className="text-sm leading-relaxed text-slate-400">{shadow}</p>
      </div>
    </div>
  );
}
