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
import { overlapIndexes, similarity, words } from "@/lib/scoring/text";
import { latencyMs } from "@/lib/scoring/signals";
import { FIRING } from "@/lib/scoring/fuse";
import { PENDING_CLIP, seekToTail } from "@/lib/clips";
import type { AnswerEvent, GazeHotspot, GazeWindow, Level, MethodId, Question, ScoreRequest, Session } from "@/lib/types";

const PASS: Level[] = ["clear", "watch"]; // answers that sounded like the candidate
const LEVEL_WORDS: Record<Level, string> = { clear: "Sounded genuine", watch: "Slightly unusual", warn: "Didn't add up", flag: "Sounded scripted" };
const PAUSE_MS = 700; // same "thinking pause" cut-off as the scorer
const EASY = (q?: Question) => q?.kind === "easy" || q?.stage === "warmup";

// ---------- derived numbers ----------
function answerStats(e: AnswerEvent) {
  const start = e.firstWordAt ?? e.askedAt;
  const latency = (e.firstWordAt ?? e.endedAt) - e.askedAt;
  const n = words(e.transcript).length;
  const wpm = n / Math.max(0.05, (e.endedAt - start) / 60000);
  const gaps: number[] = [];
  for (let i = 1; i < e.words.length; i++) gaps.push(e.words[i].t - e.words[i - 1].t);
  const pauses = gaps.filter((g) => g > PAUSE_MS);
  const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const sd = gaps.length ? Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length) : 0;
  return { latency, wpm, pauses: pauses.length, longest: Math.max(0, ...gaps), evenness: mean ? 1 - Math.min(1, sd / mean) : 0 };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "–");

function buildDataset(session: Session, questions: Question[]) {
  // One labelled row per answer: features (signals, gaze, timing) + the recruiter's verdict.
  const rows = session.scores.map((s) => {
    const q = questions.find((x) => x.id === s.questionId);
    const e = session.events.find((x) => x.questionId === s.questionId);
    const flag = session.flags.find((f) => f.questionId === s.questionId);
    const st = e ? answerStats(e) : null;
    return {
      questionId: s.questionId,
      kind: q?.kind, stage: q?.stage, topic: q?.topic,
      risk: s.risk, level: s.level, methodsFiring: s.methodsFiring,
      signals: Object.fromEntries(s.signals.map((x) => [x.method, x.value])),
      gaze: session.gaze.find((g) => g.questionId === s.questionId) ?? null,
      latencyMs: st?.latency ?? null, wpm: st ? Math.round(st.wpm) : null, thinkingPauses: st?.pauses ?? null,
      aiSimilarity: e && q ? Math.round(similarity(e.transcript, q.shadowAnswer) * 100) / 100 : null,
      flagged: flag ? { type: flag.type, source: flag.source, level: flag.level } : null,
      verdict: flag ? session.verdicts[flag.id] ?? null : null,
      transcript: e?.transcript ?? "",
    };
  });
  // Clips and snapshots only live in this browser; keep the export small and portable.
  const flags = session.flags.map(({ clipUrl, snapshot, ...f }) => ({ ...f, hadClip: !!clipUrl, hadSnapshot: !!snapshot }));
  return { schema: "gotcha.dataset/v1", exportedAt: new Date().toISOString(), sessionId: session.id, trackId: session.trackId, candidate: session.profile?.login ?? null, rows, session: { ...session, flags } };
}


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
        : passed / n >= 0.8 && flagged === 0 && authenticity >= 70 // "genuine" needs a high score, not just no flags
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

  // Labelled dataset: one row per answer (features + the recruiter's verdict), plus the session
  const exportData = () => {
    const blob = new Blob([JSON.stringify(buildDataset(session, questions), null, 2)], { type: "application/json" });
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
                {f.clipUrl && <div className="no-print mt-2"><Clip url={f.clipUrl} /></div>}
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
                {ev && <PausePattern e={ev} />}
                {(() => {
                  const g = session.gaze.find((x) => x.questionId === s.questionId);
                  return g ? <EyeRow g={g} /> : null;
                })()}
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

      {/* ───────── Easy vs. hard, GitHub ───────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <EasyVsHard session={session} qOf={qOf} />
        <GithubCheck session={session} />
      </div>

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

// ---------- P3: clips, timing, eyes, easy vs hard, GitHub ----------
function Clip({ url }: { url?: string }) {
  const [broken, setBroken] = useState(false);
  if (!url) return null;
  if (url.startsWith(PENDING_CLIP)) return <div className="flex h-32 w-56 items-center justify-center rounded bg-white/10 text-xs text-white/50">Clip still saving…</div>;
  if (broken) return <div className="flex h-32 w-56 items-center justify-center rounded bg-white/10 p-2 text-center text-xs text-white/40">Clip only plays in the tab that recorded it</div>;
  return <video src={url} controls className="w-56 rounded" onLoadedMetadata={(e) => seekToTail(e.currentTarget)} onError={() => setBroken(true)} />;
}

function EasyVsHard({ session, qOf }: { session: Session; qOf: (id: string) => Question | undefined }) {
  const group = (easy: boolean) => {
    const evs = session.events.filter((e) => EASY(qOf(e.questionId)) === easy);
    const st = evs.map(answerStats);
    const gz = evs.map((e) => session.gaze.find((g) => g.questionId === e.questionId)).filter((g): g is GazeWindow => !!g);
    return {
      n: evs.length,
      latency: avg(st.map((s) => s.latency)) / 1000,
      wpm: avg(st.map((s) => s.wpm)),
      pauses: avg(st.map((s) => s.pauses)),
      sim: avg(evs.map((e) => similarity(e.transcript, qOf(e.questionId)?.shadowAnswer ?? "") * 100)),
      off: avg(gz.map((g) => g.offScreenPct * 100)),
      risk: avg(evs.map((e) => session.scores.find((s) => s.questionId === e.questionId)?.risk ?? 0)),
    };
  };
  const easy = group(true), hard = group(false);
  // Real people slow down and pause more on hard questions. The reverse is the signal.
  const rows: { label: string; e: number; h: number; d?: number; unit: string; odd: boolean }[] = [
    { label: "Delay before answering", e: easy.latency, h: hard.latency, d: 1, unit: "s", odd: hard.latency < easy.latency },
    { label: "Speaking speed", e: easy.wpm, h: hard.wpm, unit: " wpm", odd: hard.wpm > easy.wpm + 10 },
    { label: "Thinking pauses / answer", e: easy.pauses, h: hard.pauses, d: 1, unit: "", odd: hard.pauses < easy.pauses },
    { label: "Overlap with AI answer", e: easy.sim, h: hard.sim, unit: "%", odd: hard.sim > easy.sim + 10 },
    { label: "Looking away", e: easy.off, h: hard.off, unit: "%", odd: hard.off > easy.off + 10 },
    { label: "Average risk", e: easy.risk, h: hard.risk, unit: "%", odd: hard.risk > easy.risk + 15 },
  ];
  const odd = rows.filter((r) => r.odd && Number.isFinite(r.e) && Number.isFinite(r.h)).length;
  return (
    <section className="card space-y-2">
      <div className="label">Easy vs. hard questions</div>
      <p className="text-xs text-white/50">People normally slow down and pause more on hard questions. Hard answers that come out faster and smoother than easy ones are worth a second look.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-white/40"><th className="font-normal" /><th className="font-normal">Easy ({easy.n})</th><th className="font-normal">Hard ({hard.n})</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-white/10">
              <td className="py-1 text-white/80">{r.label}</td>
              <td className="tabular-nums">{fmt(r.e, r.d)}{Number.isFinite(r.e) ? r.unit : ""}</td>
              <td className={`tabular-nums ${r.odd ? "font-semibold text-warn" : ""}`}>{fmt(r.h, r.d)}{Number.isFinite(r.h) ? r.unit : ""}{r.odd ? " ⚠" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`text-xs ${odd >= 2 ? "text-warn" : "text-white/40"}`}>{easy.n && hard.n ? (odd >= 2 ? `${odd} of ${rows.length} measures run the "wrong" way for hard questions.` : "Hard questions look harder for them, as expected.") : "Need at least one easy and one hard answer to compare."}</p>
    </section>
  );
}

function GithubCheck({ session }: { session: Session }) {
  const p = session.profile;
  const mismatches = session.scores.flatMap((s) => s.signals.filter((x) => x.method === "github_mismatch" && x.value > 0).map((x) => x.why));
  return (
    <section className="card space-y-2">
      <div className="label">GitHub check</div>
      {!p ? (
        <p className="text-sm text-white/40">No GitHub profile loaded for this interview.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-sm">
            {p.avatarUrl && <img src={p.avatarUrl} alt="" className="h-8 w-8 rounded-full" />}
            <a className="font-medium hover:underline" href={`https://github.com/${p.login}`} target="_blank" rel="noreferrer">{p.login}</a>
            <span className="text-xs text-white/40">{p.source === "live" ? "live data" : p.source === "cache" ? "cached data" : "offline sample"}</span>
          </div>
          <p className="text-xs text-white/50">
            {fmt(p.accountAgeYrs, 1)} yrs on GitHub · {p.publicRepos} public repos · {p.commitsLast90d} commits in 90 days · {p.topLanguages.slice(0, 4).map((l) => `${l.lang} ${Math.round(l.pct)}%`).join(", ")}
          </p>
        </>
      )}
      {session.claims.length > 0 && (
        <ul className="space-y-1 text-sm">
          {session.claims.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className={c.supportedByGithub === true ? "text-clear" : c.supportedByGithub === false ? "text-warn" : "text-white/40"}>{c.supportedByGithub === true ? "✓" : c.supportedByGithub === false ? "✗" : "?"}</span>
              <span>{c.text} <span className="text-xs text-white/40">· ask: {c.suggestedQuestion}</span></span>
            </li>
          ))}
        </ul>
      )}
      {mismatches.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-warn">{[...new Set(mismatches)].map((m) => <li key={m}>{m}</li>)}</ul>
      ) : (
        p && <p className="text-xs text-clear">Nothing they said contradicts their GitHub.</p>
      )}
    </section>
  );
}

function PausePattern({ e }: { e: AnswerEvent }) {
  const span = Math.max(1, e.endedAt - e.askedAt);
  const pct = (t: number) => ((t - e.askedAt) / span) * 100;
  const st = answerStats(e);
  return (
    <div className="space-y-1">
      <div className="label">Pause pattern</div>
      <div className="relative h-5 overflow-hidden rounded bg-white/10">
        {e.firstWordAt && <div className="absolute inset-y-0 left-0 bg-white/20" style={{ width: `${pct(e.firstWordAt)}%` }} title="Before first word" />}
        {e.words.map((w, i) => {
          const gap = i ? w.t - e.words[i - 1].t : 0;
          return (
            <span key={i}>
              {gap > PAUSE_MS && <span className="absolute inset-y-0 bg-watch/50" style={{ left: `${pct(e.words[i - 1].t)}%`, width: `${pct(w.t) - pct(e.words[i - 1].t)}%` }} title={`${(gap / 1000).toFixed(1)}s pause`} />}
              <span className="absolute inset-y-1 w-px bg-white/70" style={{ left: `${pct(w.t)}%` }} />
            </span>
          );
        })}
      </div>
      <p className="text-xs text-white/50">
        {fmt(st.latency / 1000, 1)}s before first word · {fmt(st.wpm)} wpm · {st.pauses} thinking pause{st.pauses === 1 ? "" : "s"} (longest {fmt(st.longest / 1000, 1)}s) · rhythm {st.evenness > 0.7 ? "very even, like reading aloud" : st.evenness > 0.45 ? "fairly even" : "uneven, like thinking aloud"}
      </p>
    </div>
  );
}

function spotWhere(h: GazeHotspot) {
  const v = h.dy > 0.3 ? "below" : h.dy < -0.3 ? "above" : "";
  const sd = Math.abs(h.dx) > 0.3 ? `their ${h.dx > 0 ? "right" : "left"}` : "";
  return [v, sd].filter(Boolean).join(", ") || "off-camera";
}

function EyeRow({ g }: { g: GazeWindow }) {
  const items = [
    { label: "Looking away", v: `${Math.round(g.offScreenPct * 100)}%`, hot: g.offScreenPct > 0.35 },
    { label: "Reading sweeps", v: `${fmt(g.readingSweeps, 1)}/min`, hot: g.readingSweeps >= 7 },
    { label: "Side glances", v: Math.abs(g.sideBias) < 0.3 ? "no pattern" : `mostly their ${g.sideBias > 0 ? "right" : "left"}`, hot: Math.abs(g.sideBias) > 0.5 },
    ...(g.offCameraPct != null ? [{ label: "Elsewhere on screen", v: `${Math.round(g.offCameraPct * 100)}%`, hot: g.offCameraPct > 0.3 }] : []),
    ...(g.hotspot && g.hotspot.visits >= 3 ? [{ label: "Same spot", v: `${g.hotspot.visits}× ${spotWhere(g.hotspot)}, ${Math.round(g.hotspot.dwellPct * 100)}% of answer`, hot: true }] : []),
    { label: "Blinks", v: `${fmt(g.blinkRate)}/min`, hot: false },
    { label: "vs. warm-up", v: `${Math.round(g.baselineDelta * 100)}% different`, hot: g.baselineDelta >= FIRING },
  ];
  return (
    <div>
      <div className="label mb-1">Eyes</div>
      <div className="flex flex-wrap gap-2 text-xs">
        {items.map((i) => <span key={i.label} className={`rounded border px-2 py-0.5 ${i.hot ? "border-warn/60 text-warn" : "border-white/15 text-white/50"}`}>{i.label}: {i.v}</span>)}
      </div>
    </div>
  );
}

