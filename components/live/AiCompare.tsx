// Candidate's words vs. what an AI would say, shared phrases highlighted.
// OWNER: Person 1
import { overlapIndexes, similarity } from "@/lib/scoring/text";

export function AiCompare({ transcript, shadow, title, emphasize }: { transcript: string; shadow: string; title: string; emphasize: boolean }) {
  const hits = overlapIndexes(transcript, shadow);
  const pct = transcript ? Math.round(similarity(transcript, shadow) * 100) : 0;
  return (
    <div className="grid min-h-0 flex-1 grid-rows-2 gap-3">
      <div className={`min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-black/20 p-4 ${emphasize ? "ring-1 ring-watch/50" : ""}`}>
        <div className="label mb-2 truncate">{title}</div>
        <p className="text-[15px] leading-relaxed">
          {transcript
            ? transcript.split(/\s+/).map((w, i) => (
                <span key={i} className={hits.has(i) ? "rounded bg-[#f4ca8e]/30 text-[#ffe2b8]" : "text-white/90"}>{w} </span>
              ))
            : <span className="text-white/35">Their answer appears here as they speak…</span>}
        </p>
      </div>
      <div className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.06] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="label">What an AI would say</span>
          <span className={`chip ${pct >= 40 ? "border-[#f4ca8e]/50 text-[#ffe2b8]" : ""}`}>{pct}% match</span>
        </div>
        <p className="text-sm leading-relaxed text-white/55">{shadow}</p>
      </div>
    </div>
  );
}
