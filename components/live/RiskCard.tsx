// White card at the bottom of the assistant: one number, one level, one next step.
// OWNER: Person 1
import type { Score } from "@/lib/types";
import { LEVEL_STYLE, METHOD_LABEL } from "@/components/ui";

export function RiskCard({ score, onTestNow, onFollowUp }: { score?: Score; onTestNow: () => void; onFollowUp: (id: string) => void }) {
  const level = score?.level ?? "clear";
  const s = LEVEL_STYLE[level];
  const risk = score?.risk ?? 0;
  return (
    <div className="relative">
      {/* stacked-card effect */}
      <div className="absolute inset-x-4 -top-2 h-6 rounded-t-3xl bg-white/50" />
      <div className="relative rounded-[28px] bg-white p-5 text-slate-900 shadow-[0_20px_60px_-20px_rgba(80,40,90,0.45)]">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-medium">Authenticity</span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${level === "flag" ? "bg-flag/10 text-flag" : level === "warn" ? "bg-warn/10 text-warn" : level === "watch" ? "bg-watch/15 text-amber-700" : "bg-clear/10 text-clear"}`}>
            <span className={`h-2 w-2 rounded-full ${s.dot} ${level === "flag" ? "animate-pulse" : ""}`} /> {s.label}
          </span>
        </div>

        <div className="mt-2 flex items-end gap-2">
          <span className="text-5xl font-light tabular-nums tracking-tight">{risk}</span>
          <span className="mb-2 text-sm text-slate-400">% risk</span>
        </div>
        <div className="relative mt-2 h-1.5 rounded-full bg-slate-100">
          <div className={`h-1.5 rounded-full ${s.dot} transition-all duration-700`} style={{ width: `${risk}%` }} />
          {[20, 50, 75].map((m) => (
            <span key={m} className="absolute -top-0.5 h-2.5 w-px bg-slate-300" style={{ left: `${m}%` }} />
          ))}
        </div>

        <p className="mt-4 text-[15px] leading-snug">{score?.suggestedText ?? "Ask the question, then tap the mic when they finish."}</p>
        {level === "flag" && (
          <button onClick={onTestNow} className="mt-3 w-full rounded-full bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-800">Test now → probe their own code</button>
        )}
        {level === "warn" && score?.suggestedQuestionId && (
          <button onClick={() => onFollowUp(score.suggestedQuestionId!)} className="mt-3 w-full rounded-full border border-slate-200 py-2.5 text-sm hover:bg-slate-50">Ask the follow-up</button>
        )}

        {score && (
          <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {score.knownAiMatch && <li className="text-flag">Seen this AI answer in a past interview ({Math.round(score.knownAiMatch.similarity * 100)}% match)</li>}
            {[...score.signals].sort((a, b) => b.value - a.value).slice(0, 3).map((sig, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-6 shrink-0 rounded-full bg-slate-100"><span className="block h-1 rounded-full bg-slate-400" style={{ width: `${sig.value * 100}%` }} /></span>
                <span><span className="text-slate-700">{METHOD_LABEL[sig.method]}</span> · {sig.why}</span>
              </li>
            ))}
            <li className="text-slate-400">{score.methodsFiring} of 11 detection methods agree{score.methodsFiring < 2 ? " · a red flag needs 2" : ""}</li>
          </ul>
        )}
      </div>
    </div>
  );
}
