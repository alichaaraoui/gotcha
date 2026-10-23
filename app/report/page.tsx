// Post-interview report. OWNER: Person 3
// The tool suggests; the recruiter decides. Every flag gets a Genuine / Suspicious verdict that feeds the learning loop.
"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { allQuestions, useStore } from "@/lib/store";
import { LEVEL_STYLE, METHOD_LABEL } from "@/components/ui";
import { overlapIndexes, similarity, words } from "@/lib/scoring/text";
import { FIRING } from "@/lib/scoring/fuse";
import { PENDING_CLIP, seekToTail } from "@/lib/clips";
import type { AnswerEvent, Flag, GazeWindow, Level, Question, Score, Session } from "@/lib/types";

const SEVERITY: Record<Level, number> = { flag: 3, warn: 2, watch: 1, clear: 0 };
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

function rankFlags(flags: Flag[], scores: Score[]) {
  const risk = (f: Flag) => scores.find((s) => s.questionId === f.questionId)?.risk ?? 0;
  return [...flags].sort((a, b) => SEVERITY[b.level] - SEVERITY[a.level] || risk(b) - risk(a) || a.at - b.at);
}

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

// ---------- page ----------
export default function Report() {
  const { session, track, setVerdict, finishInterview } = useStore();
  const [saved, setSaved] = useState(false);
  const questions = useMemo(() => allQuestions(track, session), [track, session]);
  const qOf = (id: string) => questions.find((q) => q.id === id);
  const live = rankFlags(session.flags.filter((f) => f.type === "live"), session.scores);
  const later = rankFlags(session.flags.filter((f) => f.type === "later"), session.scores);
  const maxRisk = Math.max(0, ...session.scores.map((s) => s.risk));
  const unjudged = session.flags.filter((f) => !session.verdicts[f.id]).length;
  // Answers in the order they were asked
  const scores = [...session.scores].sort((a, b) => (session.events.find((e) => e.questionId === a.questionId)?.askedAt ?? 0) - (session.events.find((e) => e.questionId === b.questionId)?.askedAt ?? 0));

  const exportDataset = () => {
    const blob = new Blob([JSON.stringify(buildDataset(session, questions), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gotcha-${session.id}.json`;
    a.click();
  };

  if (!session.events.length && !session.flags.length) {
    return (
      <div className="card space-y-2">
        <h1 className="text-xl font-semibold">No interview yet</h1>
        <p className="text-sm text-slate-400">Run an interview in the Live Room (replay mode works without a mic), then come back here.</p>
        <Link href="/live" className="btn-primary inline-block">Go to the Live Room</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Interview report · {session.profile?.name ?? session.profile?.login ?? "candidate"}</h1>
        <span className="text-sm text-slate-400">Peak risk {maxRisk}% · {session.flags.length} flags · {session.events.length} answers</span>
        <div className="no-print ml-auto flex items-center gap-2">
          <button className="btn-ghost" onClick={exportDataset}>Export dataset (JSON)</button>
          <button className="btn-primary" onClick={() => { finishInterview(); setSaved(true); }}>Save verdicts to memory</button>
        </div>
      </div>
      <p className="text-sm text-slate-400">
        The tool suggests; you decide. Mark each flag Genuine or Suspicious so the next interview learns from it.
        {unjudged > 0 && <span className="text-watch"> {unjudged} flag{unjudged > 1 ? "s" : ""} still need your call.</span>}
        {saved && <> <span className="text-clear">Saved.</span> <Link href="/insights" className="underline">See what changed →</Link></>}
      </p>

      <Timeline session={session} scores={scores} qOf={qOf} />

      <section className="space-y-3">
        <h2 className="label">Probed live ({live.length})</h2>
        {!live.length && <p className="text-sm text-slate-500">Nothing needed testing during the interview.</p>}
        {live.map((f) => <FlagCard key={f.id} f={f} session={session} q={qOf(f.questionId)} onVerdict={setVerdict} />)}
        <h2 className="label pt-2">Review later ({later.length})</h2>
        {!later.length && <p className="text-sm text-slate-500">Nothing queued for review.</p>}
        {later.map((f) => <FlagCard key={f.id} f={f} session={session} q={qOf(f.questionId)} onVerdict={setVerdict} />)}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <EasyVsHard session={session} qOf={qOf} />
        <GithubCheck session={session} />
      </div>

      <section className="space-y-3">
        <h2 className="label">Every answer</h2>
        {scores.map((s) => (
          <AnswerCard key={s.questionId} s={s} q={qOf(s.questionId)} e={session.events.find((x) => x.questionId === s.questionId)} g={session.gaze.find((x) => x.questionId === s.questionId)} flag={session.flags.find((f) => f.questionId === s.questionId && (f.clipUrl || f.snapshot))} />
        ))}
      </section>
      <Link href="/insights" className="btn-ghost inline-block">See what the system learned →</Link>
    </div>
  );
}

// ---------- sections ----------
function Timeline({ session, scores, qOf }: { session: Session; scores: Score[]; qOf: (id: string) => Question | undefined }) {
  const evs = session.events;
  const t0 = evs.length ? Math.min(...evs.map((e) => e.askedAt)) : session.startedAt;
  const t1 = Math.max(t0 + 60000, ...evs.map((e) => e.endedAt), ...session.flags.map((f) => f.at));
  const pct = (t: number) => ((t - t0) / (t1 - t0)) * 100;
  const mins = Math.ceil((t1 - t0) / 60000);
  const firstFlag = session.flags.filter((f) => f.level === "flag").sort((a, b) => a.at - b.at)[0];
  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between">
        <span className="label">Timeline: risk per question</span>
        <span className="text-xs text-slate-400">{firstFlag ? `First red flag at ${fmt((firstFlag.at - t0) / 60000, 1)} min` : "No red flags"}</span>
      </div>
      <div className="relative h-32 border-b border-l border-slate-700">
        {[20, 50, 75].map((m) => <div key={m} className="absolute left-0 right-0 border-t border-dashed border-slate-800" style={{ bottom: `${m}%` }}><span className="absolute -left-6 -top-2 text-[10px] text-slate-500">{m}</span></div>)}
        {scores.map((s) => {
          const e = evs.find((x) => x.questionId === s.questionId);
          if (!e) return null;
          const left = pct(e.askedAt), width = Math.max(1.2, pct(e.endedAt) - left);
          return (
            <a key={s.questionId} href={`#q-${s.questionId}`} title={`${qOf(s.questionId)?.text ?? s.questionId}: ${s.risk}%`}
              className={`absolute bottom-0 rounded-t ${LEVEL_STYLE[s.level].dot} opacity-80 hover:opacity-100`} style={{ left: `${left}%`, width: `${width}%`, height: `${Math.max(3, s.risk)}%` }} />
          );
        })}
        {session.flags.map((f) => (
          <div key={f.id} title={`${f.type === "live" ? "Probed live" : "Review later"} · ${f.source === "manual" ? "flagged by you" : LEVEL_STYLE[f.level].label}`}
            className={`absolute -top-3 -translate-x-1/2 text-xs ${LEVEL_STYLE[f.level].text}`} style={{ left: `${pct(f.at)}%` }}>{f.type === "live" ? "▼" : "▽"}</div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-500">{Array.from({ length: Math.min(mins, 12) + 1 }, (_, i) => <span key={i}>{Math.round((i * mins) / Math.min(mins, 12))}m</span>)}</div>
      <p className="text-xs text-slate-500">Bar height = risk, width = answer length. ▼ probed live · ▽ review later. Click a bar to jump to that answer.</p>
    </section>
  );
}

function Clip({ url }: { url?: string }) {
  const [broken, setBroken] = useState(false);
  if (!url) return null;
  if (url.startsWith(PENDING_CLIP)) return <div className="flex h-32 w-56 items-center justify-center rounded bg-slate-800 text-xs text-slate-400">Clip still saving…</div>;
  if (broken) return <div className="flex h-32 w-56 items-center justify-center rounded bg-slate-800 p-2 text-center text-xs text-slate-500">Clip only plays in the tab that recorded it</div>;
  return <video src={url} controls className="w-56 rounded" onLoadedMetadata={(e) => seekToTail(e.currentTarget)} onError={() => setBroken(true)} />;
}

function FlagCard({ f, session, q, onVerdict }: { f: Flag; session: Session; q?: Question; onVerdict: (id: string, v: "genuine" | "suspicious") => void }) {
  const sc = session.scores.find((s) => s.questionId === f.questionId);
  const fired = (sc?.signals ?? []).filter((s) => s.value >= FIRING).sort((a, b) => b.value - a.value);
  const verdict = session.verdicts[f.id];
  return (
    <div className="card flex flex-wrap items-start gap-4">
      {f.snapshot && <img src={f.snapshot} alt="Frame when flagged" className="w-40 rounded" />}
      <Clip url={f.clipUrl} />
      <div className="min-w-[16rem] flex-1 space-y-1">
        <div className={`text-sm font-semibold ${LEVEL_STYLE[f.level].text}`}>
          {f.type === "live" ? "Probed live" : "Review later"} · {f.source === "manual" ? "flagged by you" : LEVEL_STYLE[f.level].label}
          {sc && <> · {sc.risk}%</>} · {new Date(f.at).toLocaleTimeString()}
        </div>
        <a href={`#q-${f.questionId}`} className="block text-sm hover:underline">{q?.text ?? f.questionId}</a>
        {f.note && <p className="text-xs text-slate-400">Note: {f.note}</p>}
        {fired.length > 0 && (
          <ul className="space-y-0.5 text-xs text-slate-300">
            {fired.map((s, i) => <li key={i}><b>{METHOD_LABEL[s.method]}</b>: {s.why}</li>)}
          </ul>
        )}
        {sc?.knownAiMatch && <p className="text-xs text-flag">Matches an answer marked suspicious in a past interview ({Math.round(sc.knownAiMatch.similarity * 100)}% similar)</p>}
      </div>
      <div className="flex gap-2">
        {(["genuine", "suspicious"] as const).map((v) => (
          <button key={v} onClick={() => onVerdict(f.id, v)} className={`btn-ghost ${verdict === v ? (v === "genuine" ? "border-clear bg-clear/20" : "border-flag bg-flag/20") : ""}`}>
            {v === "genuine" ? "Genuine" : "Suspicious"}
          </button>
        ))}
      </div>
    </div>
  );
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
      <p className="text-xs text-slate-400">People normally slow down and pause more on hard questions. Hard answers that come out faster and smoother than easy ones are worth a second look.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="font-normal" /><th className="font-normal">Easy ({easy.n})</th><th className="font-normal">Hard ({hard.n})</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-800">
              <td className="py-1 text-slate-300">{r.label}</td>
              <td className="tabular-nums">{fmt(r.e, r.d)}{Number.isFinite(r.e) ? r.unit : ""}</td>
              <td className={`tabular-nums ${r.odd ? "font-semibold text-warn" : ""}`}>{fmt(r.h, r.d)}{Number.isFinite(r.h) ? r.unit : ""}{r.odd ? " ⚠" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`text-xs ${odd >= 2 ? "text-warn" : "text-slate-500"}`}>{easy.n && hard.n ? (odd >= 2 ? `${odd} of ${rows.length} measures run the "wrong" way for hard questions.` : "Hard questions look harder for them, as expected.") : "Need at least one easy and one hard answer to compare."}</p>
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
        <p className="text-sm text-slate-500">No GitHub profile loaded for this interview.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-sm">
            {p.avatarUrl && <img src={p.avatarUrl} alt="" className="h-8 w-8 rounded-full" />}
            <a className="font-medium hover:underline" href={`https://github.com/${p.login}`} target="_blank" rel="noreferrer">{p.login}</a>
            <span className="text-xs text-slate-500">{p.source === "live" ? "live data" : p.source === "cache" ? "cached data" : "offline sample"}</span>
          </div>
          <p className="text-xs text-slate-400">
            {fmt(p.accountAgeYrs, 1)} yrs on GitHub · {p.publicRepos} public repos · {p.commitsLast90d} commits in 90 days · {p.topLanguages.slice(0, 4).map((l) => `${l.lang} ${Math.round(l.pct)}%`).join(", ")}
          </p>
        </>
      )}
      {session.claims.length > 0 && (
        <ul className="space-y-1 text-sm">
          {session.claims.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className={c.supportedByGithub === true ? "text-clear" : c.supportedByGithub === false ? "text-warn" : "text-slate-500"}>{c.supportedByGithub === true ? "✓" : c.supportedByGithub === false ? "✗" : "?"}</span>
              <span>{c.text} <span className="text-xs text-slate-500">· ask: {c.suggestedQuestion}</span></span>
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
      <div className="relative h-5 overflow-hidden rounded bg-slate-800">
        {e.firstWordAt && <div className="absolute inset-y-0 left-0 bg-slate-600/60" style={{ width: `${pct(e.firstWordAt)}%` }} title="Before first word" />}
        {e.words.map((w, i) => {
          const gap = i ? w.t - e.words[i - 1].t : 0;
          return (
            <span key={i}>
              {gap > PAUSE_MS && <span className="absolute inset-y-0 bg-watch/50" style={{ left: `${pct(e.words[i - 1].t)}%`, width: `${pct(w.t) - pct(e.words[i - 1].t)}%` }} title={`${(gap / 1000).toFixed(1)}s pause`} />}
              <span className="absolute inset-y-1 w-px bg-indigo-300" style={{ left: `${pct(w.t)}%` }} />
            </span>
          );
        })}
      </div>
      <p className="text-xs text-slate-400">
        {fmt(st.latency / 1000, 1)}s before first word · {fmt(st.wpm)} wpm · {st.pauses} thinking pause{st.pauses === 1 ? "" : "s"} (longest {fmt(st.longest / 1000, 1)}s) · rhythm {st.evenness > 0.7 ? "very even, like reading aloud" : st.evenness > 0.45 ? "fairly even" : "uneven, like thinking aloud"}
      </p>
    </div>
  );
}

function EyeRow({ g }: { g: GazeWindow }) {
  const items = [
    { label: "Looking away", v: `${Math.round(g.offScreenPct * 100)}%`, hot: g.offScreenPct > 0.35 },
    { label: "Reading sweeps", v: `${fmt(g.readingSweeps, 1)}/min`, hot: g.readingSweeps >= 7 },
    { label: "Side glances", v: Math.abs(g.sideBias) < 0.3 ? "no pattern" : `mostly their ${g.sideBias > 0 ? "right" : "left"}`, hot: Math.abs(g.sideBias) > 0.5 },
    { label: "Blinks", v: `${fmt(g.blinkRate)}/min`, hot: false },
    { label: "vs. warm-up", v: `${Math.round(g.baselineDelta * 100)}% different`, hot: g.baselineDelta >= FIRING },
  ];
  return (
    <div>
      <div className="label mb-1">Eyes</div>
      <div className="flex flex-wrap gap-2 text-xs">
        {items.map((i) => <span key={i.label} className={`rounded border px-2 py-0.5 ${i.hot ? "border-warn/60 text-warn" : "border-slate-700 text-slate-400"}`}>{i.label}: {i.v}</span>)}
      </div>
    </div>
  );
}

function AnswerCard({ s, q, e, g, flag }: { s: Score; q?: Question; e?: AnswerEvent; g?: GazeWindow; flag?: Flag }) {
  const hits = e && q ? overlapIndexes(e.transcript, q.shadowAnswer) : new Set<number>();
  const sim = e && q ? similarity(e.transcript, q.shadowAnswer) : 0;
  const sorted = [...s.signals].sort((a, b) => b.value - a.value);
  const fired = sorted.filter((x) => x.value >= FIRING);
  const quiet = sorted.filter((x) => x.value < FIRING);
  return (
    <div id={`q-${s.questionId}`} className="card scroll-mt-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className={`h-3 w-3 shrink-0 rounded-full ${LEVEL_STYLE[s.level].dot}`} />
        <span className="font-medium">{q?.text ?? s.questionId}</span>
        {q && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{q.kind}</span>}
        <span className={`ml-auto tabular-nums ${LEVEL_STYLE[s.level].text}`}>{s.risk}% · {LEVEL_STYLE[s.level].label}</span>
      </div>

      <div>
        <div className="label mb-1">Why: {fired.length ? `${fired.length} method${fired.length > 1 ? "s" : ""} fired` : "no method fired"}{s.level === "flag" ? "" : fired.length === 1 ? " (a red flag needs 2+)" : ""}</div>
        <ul className="grid gap-1 text-xs md:grid-cols-2">
          {fired.map((sig, i) => (
            <li key={i} className="flex items-center gap-2 text-slate-200">
              <Bar v={sig.value} hot /> <b>{METHOD_LABEL[sig.method]}</b> {sig.why}
            </li>
          ))}
          {quiet.map((sig, i) => (
            <li key={`q${i}`} className="flex items-center gap-2 text-slate-500">
              <Bar v={sig.value} /> {METHOD_LABEL[sig.method]}: {sig.why}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div>
          <div className="label mb-1">What they said</div>
          <p>{e?.transcript.split(/\s+/).map((w, i) => <span key={i} className={hits.has(i) ? "bg-flag/30" : ""}>{w} </span>) ?? <span className="text-slate-500">No transcript</span>}</p>
        </div>
        <div>
          <div className="label mb-1">What an AI would say <span className="normal-case text-slate-500">· {Math.round(sim * 100)}% overlap</span></div>
          <p className="text-slate-400">{q?.shadowAnswer}</p>
          {q?.goodAnswerHint && <p className="mt-2 text-xs text-slate-500">A good human answer: {q.goodAnswerHint}</p>}
        </div>
      </div>

      {e && <PausePattern e={e} />}
      {(g || flag) && (
        <div className="flex flex-wrap items-start gap-4">
          {g && <div className="flex-1"><EyeRow g={g} /></div>}
          {flag?.snapshot && <img src={flag.snapshot} alt="Frame when flagged" className="w-28 rounded" />}
          {flag && <Clip url={flag.clipUrl} />}
        </div>
      )}
    </div>
  );
}

function Bar({ v, hot }: { v: number; hot?: boolean }) {
  return (
    <span className="h-1.5 w-16 shrink-0 rounded bg-slate-800">
      <span className={`block h-1.5 rounded ${hot ? "bg-flag" : "bg-indigo-400/60"}`} style={{ width: `${Math.round(v * 100)}%` }} />
    </span>
  );
}
