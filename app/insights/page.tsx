// What GotCha has learned from past interviews: the headline result first, then the evidence.
// OWNER: Person 1 + Person 3
"use client";
import { useMemo } from "react";
import Link from "next/link";
import { TRACKS, useStore } from "@/lib/store";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/fuse";
import { rankQuestions, timeToFlagTrend } from "@/lib/learning";
import { METHOD_LABEL } from "@/components/ui";
import type { MethodId } from "@/lib/types";

export default function Insights() {
  const { history, weights, track, knownAi, session } = useStore();
  const repo = session.profile?.repos[0]?.name ?? "their main project";
  const allQ = useMemo(() => TRACKS.flatMap((t) => t.stages.flatMap((s) => s.questions)), []);
  const textOf = (id: string) => (allQ.find((q) => q.id === id)?.text ?? id).replace("{repo}", repo);

  const d = useMemo(() => {
    const trend = timeToFlagTrend(history);
    const avg = (xs: { minutes: number }[]) => (xs.length ? xs.reduce((a, b) => a + b.minutes, 0) / xs.length : 0);
    const before = avg(trend.slice(0, 3));
    const now = avg(trend.slice(-3));
    const flags = history.flatMap((h) => h.flags);
    const confirmed = flags.filter((f) => f.verdict === "suspicious").length;
    const caught = history.filter((h) => h.outcome === "suspicious").length;
    const ranked = rankQuestions(history, track.id).slice(0, 6);
    const weightRows = (Object.keys(weights) as MethodId[])
      .map((m) => ({ m, w: weights[m], d: weights[m] - DEFAULT_WEIGHTS[m] }))
      .sort((a, b) => b.w - a.w);
    return {
      trend, before, now,
      faster: before ? Math.round((1 - now / before) * 100) : 0,
      precision: flags.length ? Math.round((confirmed / flags.length) * 100) : 0,
      falseFlags: flags.length ? Math.round(((flags.length - confirmed) / flags.length) * 100) : 0,
      caught, ranked, weightRows,
      maxSep: Math.max(1, ...ranked.map((r) => r.separation)),
    };
  }, [history, weights, track.id]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-16">
      {/* ───────── Headline ───────── */}
      <section className="stage rounded-[32px] p-8">
        <div className="label">What GotCha has learned</div>
        <div className="mt-2 grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-end">
          <div>
            <h1 className="text-4xl font-light leading-tight">
              Spots AI help in <span className="font-normal">{d.now.toFixed(1)} min</span>
              <span className="text-white/50">, down from {d.before.toFixed(1)}.</span>
            </h1>
            <p className="mt-3 max-w-lg text-sm text-white/60">
              Every interview and every Genuine / Suspicious decision makes the next one sharper: the best questions move up, and the checks that are often wrong count for less.
            </p>
          </div>
          <TrendChart points={d.trend.map((t) => t.minutes)} />
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi value={`${history.length}`} label="Past interviews" sub={`${d.caught} AI-assisted caught`} light />
          <Kpi value={`${d.faster}%`} label="Faster to spot" sub="first 3 vs. latest 3 interviews" />
          <Kpi value={`${d.precision}%`} label="Flags that were right" sub={`${d.falseFlags}% cleared as genuine by recruiters`} />
          <Kpi value={`${knownAi.length}`} label="AI answers on file" sub="instant match next time" />
        </div>
      </section>

      {/* ───────── How it learns ───────── */}
      <section className="grid gap-3 md:grid-cols-3">
        {[
          ["1", "You interview", "GotCha scores every answer with 11 checks and records what happened."],
          ["2", "You decide", "Marking flags Genuine or Suspicious in the report tells it who was right."],
          ["3", "It adjusts", "Better questions come first, unreliable checks count less, confirmed AI answers are caught instantly."],
        ].map(([n, t, s]) => (
          <div key={n} className="card flex gap-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-sm font-medium text-black">{n}</span>
            <div>
              <div className="text-[15px]">{t}</div>
              <p className="mt-1 text-sm text-white/55">{s}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ───────── Best questions ───────── */}
        <section className="card space-y-4">
          <div>
            <h2 className="text-xl font-light">Questions that catch AI fastest</h2>
            <p className="text-sm text-white/50">{track.name}: how much higher AI-assisted candidates scored than genuine ones. These are asked first.</p>
          </div>
          <ol className="space-y-3">
            {d.ranked.map((r, i) => (
              <li key={r.questionId} className="flex gap-3">
                <span className="w-5 shrink-0 text-sm tabular-nums text-white/40">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">{textOf(r.questionId)}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="h-1.5 flex-1 rounded-full bg-white/10"><span className="block h-1.5 rounded-full bg-[#f4ca8e]" style={{ width: `${(r.separation / d.maxSep) * 100}%` }} /></span>
                    <span className="w-24 text-right text-[11px] text-white/45">+{r.separation} pts · asked {r.asked}×</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ───────── Check weights ───────── */}
        <section className="card space-y-4">
          <div>
            <h2 className="text-xl font-light">How much it trusts each check</h2>
            <p className="text-sm text-white/50">Learned from recruiter decisions. The tick marks where each check started.</p>
          </div>
          <div className="space-y-2.5">
            {d.weightRows.map(({ m, w, d: delta }) => (
              <div key={m} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-white/80">{METHOD_LABEL[m]}</span>
                <span className="relative h-2 flex-1 rounded-full bg-white/10">
                  <span className="block h-2 rounded-full bg-indigo-300/80" style={{ width: `${(w / 2) * 100}%` }} />
                  <span className="absolute -top-1 h-4 w-px bg-white/70" style={{ left: `${(DEFAULT_WEIGHTS[m] / 2) * 100}%` }} />
                </span>
                <span className={`w-20 text-right text-xs ${delta > 0.02 ? "text-emerald-300" : delta < -0.02 ? "text-orange-300" : "text-white/40"}`}>
                  {delta > 0.02 ? "trusted more" : delta < -0.02 ? "trusted less" : "unchanged"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ───────── AI answer library ───────── */}
      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-light">AI answers it already recognizes</h2>
          <p className="text-sm text-white/50">Confirmed AI-generated answers from past interviews. Cheaters use the same tools, so these come back, and get caught in seconds.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {knownAi.slice(0, 4).map((k) => (
            <div key={k.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs text-white/50">{textOf(k.questionId)}</span>
                <span className="chip shrink-0">seen {k.seenCount}×</span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm italic text-white/75">&ldquo;{k.text}&rdquo;</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-between text-sm">
        <Link href="/report" className="text-white/50 hover:text-white">← Back to the report</Link>
        <Link href="/" className="text-white/50 hover:text-white">Start a new interview →</Link>
      </div>
    </div>
  );
}

function Kpi({ value, label, sub, light }: { value: string; label: string; sub: string; light?: boolean }) {
  return (
    <div className={`rounded-3xl p-5 ${light ? "bg-white text-slate-900" : "border border-white/10 bg-black/20"}`}>
      <div className="text-4xl font-light tabular-nums">{value}</div>
      <div className={`mt-1 text-sm ${light ? "text-slate-700" : "text-white/85"}`}>{label}</div>
      <div className={`text-xs ${light ? "text-slate-400" : "text-white/45"}`}>{sub}</div>
    </div>
  );
}

/** Minutes until the first reliable flag, interview by interview (lower is better). */
function TrendChart({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="text-sm text-white/40">Not enough interviews yet.</div>;
  const W = 520, H = 150, pad = 8;
  const max = Math.max(...points) * 1.1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${H - pad} L${x(0)},${H - pad} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Minutes to first flag, falling over time">
        <defs>
          <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f4ca8e" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#f4ca8e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#g)" />
        <path d={line} fill="none" stroke="#f4ca8e" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="5" fill="white" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-white/40">
        <span>First interview · {points[0].toFixed(1)} min</span>
        <span>Latest · {points[points.length - 1].toFixed(1)} min</span>
      </div>
    </div>
  );
}
