// Learning insights. OWNER: Person 3
// TODO(P3): proper line chart for time-to-flag; animate weight changes after "Save verdicts".
"use client";
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/fuse";
import { rankQuestions, timeToFlagTrend } from "@/lib/learning";
import { METHOD_LABEL } from "@/components/ui";
import type { MethodId } from "@/lib/types";

export default function Insights() {
  const { history, weights, track, knownAi } = useStore();
  const trend = useMemo(() => timeToFlagTrend(history), [history]);
  const ranked = useMemo(() => rankQuestions(history, track.id).slice(0, 6), [history, track.id]);
  const allQ = track.stages.flatMap((s) => s.questions);
  const max = Math.max(1, ...trend.map((t) => t.minutes));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">What Unscripted has learned</h1>
      <p className="text-sm text-slate-400">{history.length} past interviews · {knownAi.length} known AI answers in the library</p>

      <section className="card">
        <div className="label mb-3">Minutes until the first reliable flag (lower = faster)</div>
        <div className="flex h-40 items-end gap-1">
          {trend.map((t, i) => (
            <div key={i} className="flex-1 rounded-t bg-indigo-500/70" style={{ height: `${(t.minutes / max) * 100}%` }} title={`${t.date}: ${t.minutes} min`} />
          ))}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card space-y-2">
          <div className="label">Signal weights (learned from recruiter verdicts)</div>
          {(Object.keys(weights) as MethodId[]).map((m) => {
            const d = weights[m] - DEFAULT_WEIGHTS[m];
            return (
              <div key={m} className="flex items-center gap-2 text-sm">
                <span className="w-44 text-slate-300">{METHOD_LABEL[m]}</span>
                <span className="h-2 flex-1 rounded bg-slate-800"><span className="block h-2 rounded bg-indigo-400" style={{ width: `${(weights[m] / 2) * 100}%` }} /></span>
                <span className={`w-14 text-right tabular-nums text-xs ${d >= 0 ? "text-clear" : "text-warn"}`}>{d >= 0 ? "+" : ""}{d.toFixed(2)}</span>
              </div>
            );
          })}
        </section>
        <section className="card space-y-2">
          <div className="label">Questions that best separate organic from assisted</div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {ranked.map((r) => (
              <li key={r.questionId}>{allQ.find((q) => q.id === r.questionId)?.text ?? r.questionId} <span className="text-xs text-slate-500">+{r.separation} gap · asked {r.asked}×</span></li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
