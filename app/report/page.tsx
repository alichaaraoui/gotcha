// Post-interview report: the verdict at a glance, then drill down.
//   1. Overall: authenticity score, pass rate, verdict in plain words
//   2. Moments to review: flags (probed live first) with Genuine / Suspicious
//   3. Every answer: what they said vs. what an AI would say, and why it scored that way
//   4. Which checks fired across the interview
// OWNER: Person 1 + Person 3
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { allQuestions, useStore } from "@/lib/store";
import { LEVEL_STYLE, METHOD_LABEL } from "@/components/ui";
import { overlapIndexes, similarity } from "@/lib/scoring/text";
import { latencyMs } from "@/lib/scoring/signals";
import type { Level, MethodId, Question, ScoreRequest } from "@/lib/types";

const PASS: Level[] = ["clear", "watch"]; // answers that sounded like the candidate
const LEVEL_WORDS: Record<Level, string> = { clear: "Sounded genuine", watch: "Slightly unusual", warn: "Didn't add up", flag: "Sounded scripted" };

export default function Report() {
  const { session, track, setVerdict, finishInterview } = useStore();
  const [saved, setSaved] = useState(false);
  const questions = useMemo(() => allQuestions(track, session), [track, session]);
  const qOf = (id: string): Question | undefined => questions.find((q) => q.id === id);

  // Open every drill-down before printing so the PDF has everything
  useEffect(() => {
    const open = () => document.querySelectorAll("details").forEach((d) => (d.open = true));
    window.addEventListener("beforeprint", open);
    return () => window.removeEventListener("beforeprint", open);
  }, []);

  const m = useMemo(() => {
    const scores = session.scores;
    const n = scores.length;
    if (!n) return null;
    const risks = scores.map((s) => s.risk);
    const mean = risks.reduce((a, b) => a + b, 0) / n;
    const max = Math.max(...risks);
    const authenticity = Math.max(0, Math.round(100 - (0.7 * mean + 0.3 * max))); // the worst moment counts extra
    const passed = scores.filter((s) => PASS.includes(s.level)).length;
    const flagged = scores.filter((s) => s.level === "flag").length;
    const confirmed = Object.values(session.verdicts).filter((v) => v === "suspicious").length;
    const verdict =
      confirmed > 0 || flagged >= 2
        ? { words: "Likely AI-assisted", detail: "Several answers sounded scripted. Review the flagged moments below before deciding.", tone: "flag" as Level }
        : passed / n >= 0.8 && flagged === 0
          ? { words: "Sounds genuine", detail: "Their answers sounded like their own thinking and matched their GitHub.", tone: "clear" as Level }
          : { words: "Mixed: worth a second look", detail: "Mostly their own words, with a few moments that didn't add up.", tone: "warn" as Level };
    const delays = session.events.map((e) => latencyMs({ event: e } as ScoreRequest) / 1000);
    const aiMatch = session.events.map((e) => similarity(e.transcript, qOf(e.questionId)?.shadowAnswer ?? "")).reduce((a, b) => a + b, 0) / Math.max(1, session.events.length);
    // Which checks fired most, averaged across answers
    const byMethod: Record<string, number[]> = {};
    scores.forEach((s) => s.signals.forEach((sig) => (byMethod[sig.method] ??= []).push(sig.value)));
    const methods = Object.entries(byMethod)
      .map(([method, v]) => ({ method: method as MethodId, avg: v.reduce((a, b) => a + b, 0) / v.length }))
      .sort((a, b) => b.avg - a.avg);
    const minutes = session.events.length ? Math.max(1, Math.round((Math.max(...session.events.map((e) => e.endedAt)) - session.startedAt) / 60000)) : 0;
    return { n, authenticity, passed, passRate: Math.round((passed / n) * 100), flagged, verdict, avgDelay: delays.reduce((a, b) => a + b, 0) / Math.max(1, delays.length), aiMatch, methods, minutes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, questions]);

  // Live-probed flags first, then the most serious
  const flags = [...session.flags].sort((a, b) => (a.type === b.type ? (b.level === "flag" ? 1 : 0) - (a.level === "flag" ? 1 : 0) : a.type === "live" ? -1 : 1));

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ session, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gotcha-${session.id}.json`;
    a.click();
  };

  if (!m)
    return (
      <div className="stage mx-auto mt-16 max-w-md space-y-4 rounded-[32px] p-10 text-center">
        <p className="text-lg">No answers yet.</p>
        <p className="text-sm text-white/60">Run an interview and the report builds itself.</p>
        <Link className="btn-primary inline-block" href="/live">Go to the live interview</Link>
      </div>
    );

  const tone = LEVEL_STYLE[m.verdict.tone];
  const p = session.profile;

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-16">
      {/* ───────── 1 · The answer at a glance ───────── */}
      <section className="stage rounded-[32px] p-8">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <div className="label">Interview report</div>
            <h1 className="mt-1 text-3xl font-light">{p?.name ?? p?.login ?? "Candidate"}</h1>
            <p className="mt-1 text-sm text-white/55">
              {track.name} · {new Date(session.startedAt).toLocaleDateString()} · {m.minutes} min · {m.n} answers
            </p>
          </div>
          <div className="no-print ml-auto flex gap-2">
            <button className="btn-ghost" onClick={exportData}>Download data</button>
            <button className="btn-primary" onClick={() => window.print()}>Export PDF</button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
          <div className="rounded-3xl bg-white p-6 text-slate-900">
            <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Overall authenticity</div>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-6xl font-light tabular-nums">{m.authenticity}</span>
              <span className="mb-2 text-slate-400">/ 100</span>
            </div>
            <div className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${m.verdict.tone === "flag" ? "bg-rose-50 text-rose-700" : m.verdict.tone === "clear" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-orange-700"}`}>
              <span className={`h-2 w-2 rounded-full ${tone.dot}`} /> {m.verdict.words}
            </div>
            <p className="mt-3 text-sm text-slate-600">{m.verdict.detail}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
            <div className="label">Pass rate</div>
            <div className="mt-2 text-5xl font-light tabular-nums">{m.passRate}%</div>
            <p className="mt-2 text-sm text-white/60">{m.passed} of {m.n} answers sounded like their own thinking</p>
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-white/10">
              <div className="bg-clear" style={{ width: `${m.passRate}%` }} />
              <div className="bg-flag/80" style={{ width: `${100 - m.passRate}%` }} />
            </div>
          </div>
          <div className="space-y-3 rounded-3xl border border-white/10 bg-black/20 p-6 text-sm">
            <div className="label">Key numbers</div>
            <Stat label="Moments flagged" value={`${session.flags.length}`} sub={`${session.flags.filter((f) => f.type === "live").length} probed live`} />
            <Stat label="Avg. delay before answering" value={`${m.avgDelay.toFixed(1)}s`} sub="AI relays add a steady ~2s" />
            <Stat label="Avg. match with AI answers" value={`${Math.round(m.aiMatch * 100)}%`} sub="real answers rarely pass 30%" />
          </div>
        </div>

        {/* Risk per answer, in order */}
        <div className="mt-8">
          <div className="label mb-3">How each answer scored (taller = more AI-like)</div>
          <div className="relative flex h-28 items-end gap-1.5">
            {[20, 50, 75].map((t) => (
              <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/15" style={{ bottom: `${t}%` }}>
                <span className="absolute -top-2 right-0 text-[10px] text-white/35">{t}</span>
              </div>
            ))}
            {session.scores.map((s, i) => (
              <a key={s.questionId} href={`#a-${s.questionId}`} title={`${i + 1}. ${qOf(s.questionId)?.text}`} className={`max-w-14 flex-1 rounded-t-md ${LEVEL_STYLE[s.level].dot} opacity-90 hover:opacity-100`} style={{ height: `${Math.max(6, s.risk)}%` }} />
            ))}
          </div>
        </div>
      </section>

      {/* ───────── 2 · Moments to review ───────── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-light">Moments to review</h2>
            <p className="text-sm text-white/50">GotCha suggests; you decide. Your calls teach the next interview.</p>
          </div>
          <button className="btn-primary no-print" onClick={() => { finishInterview(); setSaved(true); }}>{saved ? "✓ Saved to memory" : "Save my decisions"}</button>
        </div>
        {!flags.length && <div className="card text-sm text-white/60">Nothing was flagged in this interview.</div>}
        {flags.map((f) => {
          const q = qOf(f.questionId);
          const sc = session.scores.find((x) => x.questionId === f.questionId);
          const ev = session.events.find((x) => x.questionId === f.questionId);
          const reasons = sc ? [...sc.signals].sort((a, b) => b.value - a.value).filter((x) => x.value >= 0.4).slice(0, 3) : [];
          const v = session.verdicts[f.id];
          return (
            <div key={f.id} className="card flex flex-wrap gap-5">
              {f.snapshot && <img src={f.snapshot} alt="" className="h-28 w-44 rounded-2xl object-cover" />}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${f.level === "flag" ? "bg-flag/15 text-red-200" : "bg-warn/15 text-orange-200"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_STYLE[f.level].dot}`} /> {f.source === "manual" ? "You flagged this" : LEVEL_WORDS[f.level]}
                  </span>
                  <span className="text-white/40">{f.type === "live" ? "Probed live" : "Review later"} · {new Date(f.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                  {sc && <a href={`#a-${f.questionId}`} className="ml-auto text-white/50 underline-offset-2 hover:underline">See full answer ↓</a>}
                </div>
                <p className="text-[15px]">{q?.text}</p>
                {ev?.transcript && <p className="line-clamp-2 text-sm italic text-white/50">&ldquo;{ev.transcript}&rdquo;</p>}
                {reasons.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-white/60">
                    {reasons.map((r, i) => <li key={i}>• <span className="text-white/80">{METHOD_LABEL[r.method]}:</span> {r.why}</li>)}
                  </ul>
                )}
                {f.clipUrl && <video src={f.clipUrl} controls className="no-print mt-2 w-64 rounded-xl" />}
              </div>
              <div className="flex flex-col gap-2 self-center">
                {(["genuine", "suspicious"] as const).map((x) => (
                  <button
                    key={x}
                    onClick={() => { setVerdict(f.id, x); setSaved(false); }}
                    className={`btn min-w-32 border ${v === x ? (x === "genuine" ? "border-clear bg-clear/20 text-emerald-100" : "border-flag bg-flag/20 text-red-100") : "border-white/20 text-white/80 hover:bg-white/10"}`}
                  >
                    {v === x ? "✓ " : ""}{x === "genuine" ? "Genuine" : "Suspicious"}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* ───────── 3 · Every answer ───────── */}
      <section className="space-y-3">
        <h2 className="text-xl font-light">Every answer</h2>
        {session.scores.map((s, i) => {
          const q = qOf(s.questionId);
          const ev = session.events.find((x) => x.questionId === s.questionId);
          const hits = ev && q ? overlapIndexes(ev.transcript, q.shadowAnswer) : new Set<number>();
          const delay = ev ? latencyMs({ event: ev } as ScoreRequest) / 1000 : 0;
          return (
            <details key={s.questionId} id={`a-${s.questionId}`} className="card group" open={s.level === "flag"}>
              <summary className="flex cursor-pointer list-none items-center gap-4">
                <span className="w-6 text-sm tabular-nums text-white/40">{String(i + 1).padStart(2, "0")}</span>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${LEVEL_STYLE[s.level].dot}`} />
                <span className="flex-1 text-[15px]">{q?.text}</span>
                <span className="hidden text-xs text-white/45 md:inline">{LEVEL_WORDS[s.level]}</span>
                <span className="w-12 text-right tabular-nums text-sm">{s.risk}%</span>
                <span className="text-white/40 transition group-open:rotate-90">›</span>
              </summary>
              <div className="mt-5 space-y-5 border-t border-white/10 pt-5">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="chip">{q?.stage}</span>
                  {q?.repoRef && <span className="chip">From their GitHub · {q.repoRef}</span>}
                  <span className="chip">{delay.toFixed(1)}s before first word</span>
                  <span className="chip">{s.methodsFiring} of 11 checks fired</span>
                  {s.knownAiMatch && <span className="chip border-flag/50 text-red-200">Matches an AI answer from a past interview</span>}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="label mb-2">What they said</div>
                    <p className="text-sm leading-relaxed">
                      {ev?.transcript ? ev.transcript.split(/\s+/).map((w, k) => <span key={k} className={hits.has(k) ? "rounded bg-[#f4ca8e]/30 text-[#ffe2b8]" : ""}>{w} </span>) : <span className="text-white/40">No words captured.</span>}
                    </p>
                  </div>
                  <div>
                    <div className="label mb-2">What an AI would say</div>
                    <p className="text-sm leading-relaxed text-white/50">{q?.shadowAnswer}</p>
                  </div>
                </div>
                <div>
                  <div className="label mb-2">Why it scored {s.risk}%</div>
                  <ul className="grid gap-1.5 text-xs text-white/60 md:grid-cols-2">
                    {[...s.signals].sort((a, b) => b.value - a.value).map((sig, k) => (
                      <li key={k} className="flex items-center gap-2">
                        <span className="h-1.5 w-16 shrink-0 rounded bg-white/10"><span className={`block h-1.5 rounded ${sig.value >= 0.6 ? "bg-flag" : sig.value >= 0.4 ? "bg-warn" : "bg-white/40"}`} style={{ width: `${sig.value * 100}%` }} /></span>
                        <b className="shrink-0 font-normal text-white/85">{METHOD_LABEL[sig.method]}</b> <span className="truncate">{sig.why}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </details>
          );
        })}
      </section>

      {/* ───────── 4 · Which checks fired ───────── */}
      <section className="card space-y-3">
        <div>
          <h2 className="text-xl font-light">Which checks fired across the interview</h2>
          <p className="text-sm text-white/50">Averaged over every answer. A red flag always needed two or more of these to agree.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {m.methods.map((x) => (
            <div key={x.method} className="flex items-center gap-3 text-sm">
              <span className="w-48 shrink-0 text-white/80">{METHOD_LABEL[x.method]}</span>
              <span className="h-2 flex-1 rounded-full bg-white/10"><span className={`block h-2 rounded-full ${x.avg >= 0.6 ? "bg-flag" : x.avg >= 0.4 ? "bg-warn" : "bg-indigo-300/70"}`} style={{ width: `${x.avg * 100}%` }} /></span>
              <span className="w-10 text-right tabular-nums text-xs text-white/50">{Math.round(x.avg * 100)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="no-print flex justify-between text-sm">
        <Link href="/live" className="text-white/50 hover:text-white">← Back to the interview</Link>
        <Link href="/insights" className="text-white/50 hover:text-white">What GotCha has learned →</Link>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div>
        <div className="text-white/80">{label}</div>
        <div className="text-[11px] text-white/40">{sub}</div>
      </div>
      <div className="text-xl font-light tabular-nums">{value}</div>
    </div>
  );
}
