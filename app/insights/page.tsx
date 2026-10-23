// Learning insights. OWNER: Person 3
// Time-to-first-flag trend, questions ranked by how well they separate, signal weights before → after.
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { allQuestions, useStore } from "@/lib/store";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/fuse";
import { learnWeights, rankQuestions, timeToFlagTrend } from "@/lib/learning";
import { METHOD_LABEL } from "@/components/ui";
import type { MethodId, PastInterview, Weights } from "@/lib/types";
import seedHistory from "@/data/past_interviews.json";

export default function Insights() {
  const { history, weights, track, session } = useStore();
  const trend = useMemo(() => timeToFlagTrend(history), [history]);
  const ranked = useMemo(() => rankQuestions(history, track.id).slice(0, 6), [history, track.id]);
  const allQ = allQuestions(track, session);
  const saved = history.length - (seedHistory as PastInterview[]).length;

  // "Before" = what the weights were before the most recent saved interview (or the seed, if none saved yet).
  const before = useMemo(() => learnWeights(history.slice(0, -1)), [history]);
  // Start the bars at "before" and animate to "now" on mount, so a fresh save visibly moves them.
  const [shown, setShown] = useState<Weights>(before);
  useEffect(() => {
    setShown(before);
    const t = setTimeout(() => setShown(weights), 300);
    return () => clearTimeout(t);
  }, [before, weights]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">What GotCha has learned</h1>
        <span className="text-sm text-slate-400">{history.length} past interviews{saved > 0 ? ` (${saved} from you)` : ""}</span>
      </div>

      <TimeToFlag trend={trend} />

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card space-y-2">
          <div className="label">Signal weights: default → learned from your verdicts</div>
          <p className="text-xs text-slate-500">Methods whose flags you confirm as suspicious gain weight; ones you mark genuine lose it.</p>
          {(Object.keys(weights) as MethodId[]).sort((a, b) => weights[b] - weights[a]).map((m) => {
            const d = weights[m] - DEFAULT_WEIGHTS[m];
            const last = weights[m] - before[m];
            return (
              <div key={m} className="flex items-center gap-2 text-sm">
                <span className="w-44 shrink-0 text-slate-300">{METHOD_LABEL[m]}</span>
                <span className="relative h-2.5 flex-1 rounded bg-slate-800">
                  {/* default as a tick, learned as the bar */}
                  <span className="block h-2.5 rounded bg-indigo-400 transition-[width] duration-1000 ease-out" style={{ width: `${(shown[m] / 2) * 100}%` }} />
                  <span className="absolute -top-0.5 h-3.5 w-0.5 bg-slate-300" style={{ left: `${(DEFAULT_WEIGHTS[m] / 2) * 100}%` }} title={`Default ${DEFAULT_WEIGHTS[m]}`} />
                </span>
                <span className="w-24 text-right text-xs tabular-nums text-slate-400">
                  {DEFAULT_WEIGHTS[m].toFixed(2)} → <b className={d >= 0 ? "text-clear" : "text-warn"}>{weights[m].toFixed(2)}</b>
                </span>
                <span className="w-10 text-right text-[10px] tabular-nums text-slate-500" title="Change from your last saved interview">{Math.abs(last) >= 0.005 ? `${last > 0 ? "+" : ""}${last.toFixed(2)}` : ""}</span>
              </div>
            );
          })}
          <p className="text-[11px] text-slate-500">Bar = learned weight · tick = default · right column = change from the last saved interview.</p>
        </section>

        <section className="card space-y-2">
          <div className="label">Questions that best separate organic from assisted · {track.name}</div>
          <p className="text-xs text-slate-500">Gap between average risk for assisted and organic candidates. These go first in the track.</p>
          {!ranked.length && <p className="text-sm text-slate-500">No history for this track yet.</p>}
          <ol className="space-y-2 text-sm">
            {ranked.map((r, i) => {
              const top = Math.max(1, ranked[0].separation);
              return (
                <li key={r.questionId} className="space-y-1">
                  <div className="flex gap-2"><span className="text-slate-500">{i + 1}.</span><span>{allQ.find((q) => q.id === r.questionId)?.text ?? r.questionId}</span></div>
                  <div className="flex items-center gap-2 pl-5">
                    <span className="h-1.5 flex-1 rounded bg-slate-800"><span className="block h-1.5 rounded bg-clear" style={{ width: `${Math.max(0, r.separation / top) * 100}%` }} /></span>
                    <span className="w-28 text-right text-xs text-slate-500">+{r.separation} pts · asked {r.asked}×</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      <Link href="/" className="btn-ghost inline-block">Start the next interview →</Link>
    </div>
  );
}

function TimeToFlag({ trend }: { trend: { date: string; minutes: number }[] }) {
  const W = 640, H = 180, P = { l: 32, r: 12, t: 12, b: 24 };
  if (trend.length < 2) return <section className="card text-sm text-slate-500">Not enough flagged interviews yet to show a trend.</section>;
  const max = Math.ceil(Math.max(...trend.map((t) => t.minutes)) / 5) * 5;
  const x = (i: number) => P.l + (i / (trend.length - 1)) * (W - P.l - P.r);
  const y = (m: number) => P.t + (1 - m / max) * (H - P.t - P.b);
  // Least-squares trend line
  const n = trend.length, xs = trend.map((_, i) => i), ys = trend.map((t) => t.minutes);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  const slope = xs.reduce((a, xi, i) => a + (xi - mx) * (ys[i] - my), 0) / Math.max(1e-9, xs.reduce((a, xi) => a + (xi - mx) ** 2, 0));
  const fit = (i: number) => my + slope * (i - mx);
  const k = Math.min(5, Math.floor(n / 2));
  const first = ys.slice(0, k).reduce((a, b) => a + b, 0) / k, last = ys.slice(-k).reduce((a, b) => a + b, 0) / k;
  return (
    <section className="card space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="label">Minutes until the first red flag (lower = faster)</span>
        <span className="text-sm">
          <span className="text-slate-400">first {k}: {first.toFixed(1)} min → last {k}: </span>
          <b className={last < first ? "text-clear" : "text-warn"}>{last.toFixed(1)} min</b>
          {last < first && <span className="text-slate-400"> ({Math.round((1 - last / first) * 100)}% faster)</span>}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Minutes to first flag per interview">
        {[0, max / 2, max].map((m) => (
          <g key={m}>
            <line x1={P.l} x2={W - P.r} y1={y(m)} y2={y(m)} className="stroke-slate-800" />
            <text x={P.l - 6} y={y(m) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">{m}</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(fit(0))} x2={x(n - 1)} y2={y(fit(n - 1))} className="stroke-clear/60" strokeDasharray="4 4" strokeWidth={1.5} />
        <polyline fill="none" className="stroke-indigo-400" strokeWidth={2} points={trend.map((t, i) => `${x(i)},${y(t.minutes)}`).join(" ")} />
        {trend.map((t, i) => (
          <circle key={i} cx={x(i)} cy={y(t.minutes)} r={3.5} className="fill-indigo-300">
            <title>{`${t.date}: ${t.minutes} min`}</title>
          </circle>
        ))}
        <text x={x(0)} y={H - 6} className="fill-slate-500 text-[10px]">{trend[0].date}</text>
        <text x={x(n - 1)} y={H - 6} textAnchor="end" className="fill-slate-500 text-[10px]">{trend[n - 1].date}</text>
      </svg>
      <p className="text-xs text-slate-500">Each dot is a past interview that ended up suspicious. Dashed line = trend. Better questions first and learned weights mean problems surface sooner.</p>
    </section>
  );
}
