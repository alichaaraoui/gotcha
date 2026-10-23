// Post-interview report. OWNER: Person 3
// TODO(P3): pause-pattern chart per answer, easy-vs-hard side-by-side, nicer timeline.
"use client";
import { useMemo } from "react";
import Link from "next/link";
import { allQuestions, useStore } from "@/lib/store";
import { LEVEL_STYLE, METHOD_LABEL } from "@/components/ui";
import { overlapIndexes } from "@/lib/scoring/text";

export default function Report() {
  const { session, track, setVerdict, finishInterview } = useStore();
  const questions = useMemo(() => allQuestions(track, session), [track, session]);
  const qOf = (id: string) => questions.find((q) => q.id === id);
  // Flags from live tests first, then by severity
  const flags = [...session.flags].sort((a, b) => (a.type === b.type ? (b.level === "flag" ? 1 : 0) - (a.level === "flag" ? 1 : 0) : a.type === "live" ? -1 : 1));
  const maxRisk = Math.max(0, ...session.scores.map((s) => s.risk));

  const exportDataset = () => {
    const blob = new Blob([JSON.stringify({ session, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gotcha-${session.id}.json`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Interview report · {session.profile?.name ?? session.profile?.login ?? "candidate"}</h1>
        <span className="text-sm text-slate-400">Peak risk {maxRisk}% · {session.flags.length} flags · {session.events.length} answers</span>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={exportDataset}>Export dataset</button>
          <button className="btn-primary" onClick={finishInterview}>Save verdicts to memory</button>
        </div>
      </div>
      <p className="text-sm text-slate-400">The tool suggests; you decide. Mark each flag so the next interview learns from it.</p>

      <section className="space-y-3">
        <h2 className="label">Flags</h2>
        {!flags.length && <p className="text-sm text-slate-500">No flags raised.</p>}
        {flags.map((f) => (
          <div key={f.id} className="card flex flex-wrap items-start gap-4">
            {f.snapshot && <img src={f.snapshot} alt="" className="w-40 rounded" />}
            {f.clipUrl && <video src={f.clipUrl} controls className="w-56 rounded" />}
            <div className="flex-1 space-y-1">
              <div className={`text-sm font-semibold ${LEVEL_STYLE[f.level].text}`}>
                {f.type === "live" ? "Probed live" : "Review later"} · {f.source === "manual" ? "flagged by you" : LEVEL_STYLE[f.level].label} · {new Date(f.at).toLocaleTimeString()}
              </div>
              <div className="text-sm">{qOf(f.questionId)?.text}</div>
            </div>
            <div className="flex gap-2">
              {(["genuine", "suspicious"] as const).map((v) => (
                <button key={v} onClick={() => setVerdict(f.id, v)} className={`btn-ghost ${session.verdicts[f.id] === v ? (v === "genuine" ? "bg-clear/20" : "bg-flag/20") : ""}`}>
                  {v === "genuine" ? "Genuine" : "Suspicious"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="label">Every answer</h2>
        {session.scores.map((s) => {
          const q = qOf(s.questionId);
          const e = session.events.find((x) => x.questionId === s.questionId);
          const hits = e && q ? overlapIndexes(e.transcript, q.shadowAnswer) : new Set<number>();
          return (
            <div key={s.questionId} className="card space-y-3">
              <div className="flex items-center gap-3">
                <span className={`h-3 w-3 rounded-full ${LEVEL_STYLE[s.level].dot}`} />
                <span className="font-medium">{q?.text}</span>
                <span className="ml-auto tabular-nums">{s.risk}%</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 text-sm">
                <div>
                  <div className="label mb-1">What they said</div>
                  <p>{e?.transcript.split(/\s+/).map((w, i) => <span key={i} className={hits.has(i) ? "bg-flag/30" : ""}>{w} </span>)}</p>
                </div>
                <div>
                  <div className="label mb-1">What an AI would say</div>
                  <p className="text-slate-400">{q?.shadowAnswer}</p>
                </div>
              </div>
              <ul className="grid gap-1 text-xs text-slate-400 md:grid-cols-2">
                {s.signals.map((sig, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="h-1.5 w-16 rounded bg-slate-800"><span className="block h-1.5 rounded bg-indigo-400" style={{ width: `${sig.value * 100}%` }} /></span>
                    <b className="text-slate-300">{METHOD_LABEL[sig.method]}</b> {sig.why}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
      <Link href="/insights" className="btn-ghost inline-block">See what the system learned →</Link>
    </div>
  );
}
