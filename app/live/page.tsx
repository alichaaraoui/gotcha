// Live interview: candidate stage (left) + assistant sidebar (right) + timeline (bottom).
// OWNER: Person 1 (EyePanel is Person 3's, scoring is Person 2's)
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TRACKS, allQuestions, useStore } from "@/lib/store";
import { useSpeech } from "@/lib/speech";
import { latencyMs, unsupportedClaims, wpm } from "@/lib/scoring/signals";
import { EyePanel, type EyePanelHandle } from "@/components/EyePanel";
import { openDocked } from "@/components/LinkedInButton";
import { RiskCard } from "@/components/live/RiskCard";
import { Timeline } from "@/components/live/Timeline";
import { AiCompare } from "@/components/live/AiCompare";
import { Icon } from "@/components/Icon";
import demo from "@/data/demo_scripts.json";
import type { AnswerEvent, Question, QuestionsResponse, Score, ScoreRequest, WordStamp } from "@/lib/types";

const MAX_LIVE_PROMPTS = 5; // cap so Sarah isn't flooded
const STAGE_ORDER = ["warmup", "core", "deep", "probe", "wrap"];
const STAGE_LABEL: Record<string, string> = { warmup: "Warm-up", core: "Core", deep: "Deep dive", probe: "Probe", wrap: "Wrap-up" };
const KIND_LABEL: Record<string, string> = { easy: "Easy", hard: "Hard", probe: "Probe", trap: "Knowledge check", custom: "Your question" };

type DemoKey = "organic" | "assisted";
const scripts = demo as unknown as Record<DemoKey, { label: string; answers: Record<string, { delayMs: number; wpm: number; text: string }> }>;

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export default function Live() {
  const store = useStore();
  const { session, track, weights, knownAi } = store;
  const speech = useSpeech();
  const eyes = useRef<EyePanelHandle>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Track questions + GitHub/custom ones, in stage order
  const questions = useMemo(
    () => allQuestions(track, session).map((q, i) => ({ q, i })).sort((a, b) => STAGE_ORDER.indexOf(a.q.stage) - STAGE_ORDER.indexOf(b.q.stage) || a.i - b.i).map((x) => x.q),
    [track, session]
  );
  const [currentId, setCurrentId] = useState<string>();
  const [answering, setAnswering] = useState<{ q: Question; askedAt: number } | null>(null);
  const [lastAnswered, setLastAnswered] = useState<Question>();
  const [scoring, setScoring] = useState(false);
  const [replayKey, setReplayKey] = useState<DemoKey | "">("");
  const [showAll, setShowAll] = useState(false);
  const [compact, setCompact] = useState(false); // sidebar only, to sit next to Zoom
  const [promptMode, setPromptMode] = useState<"ask" | "claim">("ask");
  const [prompt, setPrompt] = useState("");
  const [toast, setToast] = useState<string>();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const current = questions.find((q) => q.id === currentId) ?? questions.find((q) => !session.trackPath.includes(q.id)) ?? questions[0];
  const shown = answering?.q ?? current;
  const latest = session.scores.at(-1);
  const emphasize = (latest?.risk ?? 0) >= 20;

  // Baseline = the candidate's own warm-up answers
  const baseline = useMemo(() => {
    const warm = session.events.filter((e) => questions.find((q) => q.id === e.questionId)?.stage === "warmup");
    if (!warm.length) return null;
    const asReq = (e: AnswerEvent) => ({ event: e }) as ScoreRequest;
    return {
      latencyMs: warm.reduce((a, e) => a + latencyMs(asReq(e)), 0) / warm.length,
      wpm: warm.reduce((a, e) => a + wpm(asReq(e)), 0) / warm.length,
      gaze: session.gaze.find((g) => warm.some((e) => e.questionId === g.questionId)) ?? null,
    };
  }, [session.events, session.gaze, questions]);

  const nextUnasked = useCallback(
    (after: Question, pred: (q: Question) => boolean = () => true) => {
      const asked = new Set([...sessionRef.current.trackPath, after.id]);
      const idx = questions.findIndex((q) => q.id === after.id);
      return [...questions.slice(idx + 1), ...questions.slice(0, idx)].find((q) => pred(q) && !asked.has(q.id));
    },
    [questions]
  );
  const upNext = useMemo(() => {
    const asked = new Set(session.trackPath);
    return questions.filter((q) => !asked.has(q.id) && q.id !== current?.id).slice(0, 2);
  }, [questions, session.trackPath, current]);

  const finish = useCallback(
    async (q: Question, transcript: string, words: WordStamp[], askedAt: number) => {
      setScoring(true);
      const s = sessionRef.current;
      const endedAt = Date.now();
      const event: AnswerEvent = { questionId: q.id, transcript, words, askedAt, firstWordAt: words[0]?.t ?? null, endedAt };
      const gaze = eyes.current?.window(q.id, askedAt, endedAt, q.stage === "warmup") ?? null;
      const body: ScoreRequest = {
        question: q, event, gaze, baseline, profile: s.profile, checklist: s.checklist, weights, knownAi,
        easyVsHard: baseline ? { easyLatencyMs: baseline.latencyMs, easyWpm: baseline.wpm } : null,
      };
      try {
        const score: Score = await fetch("/api/score", { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
        store.recordAnswer(event, gaze, score);
        setLastAnswered(q);
        if (score.level === "flag" || score.level === "warn") {
          const liveCount = s.flags.filter((f) => f.type === "live").length;
          const type = score.level === "flag" && liveCount < MAX_LIVE_PROMPTS ? "live" : "later";
          store.addFlag({ questionId: q.id, at: endedAt, level: score.level, type, source: "auto", ...(score.level === "flag" ? eyes.current?.capture() : {}) });
        }
        // Move on to the next question in the line; the recruiter can override any time
        const next = nextUnasked(q);
        if (next) setCurrentId(next.id);
      } finally {
        setAnswering(null);
        setScoring(false);
      }
    },
    [baseline, weights, knownAi, store, nextUnasked]
  );

  const ask = () => {
    if (!current) return;
    store.markAsked(current.id);
    const askedAt = Date.now();
    const q = current;
    setAnswering({ q, askedAt });
    if (replayKey) {
      const a = scripts[replayKey].answers[q.id];
      const text = a?.text ?? (replayKey === "organic" ? "hmm okay, honestly I'm not totally sure, I'd have to think about that one for a second" : q.shadowAnswer);
      speech.replay(text, a?.delayMs ?? (replayKey === "organic" ? 1200 : 2000), a?.wpm ?? (replayKey === "organic" ? 130 : 150), (t, w) => finish(q, t, w, askedAt));
    } else {
      speech.start();
    }
  };

  const done = () => {
    const { transcript, words } = speech.stop();
    if (answering) finish(answering.q, transcript, words, answering.askedAt);
  };

  const manualFlag = useCallback(() => {
    const q = answering?.q ?? current;
    if (!q) return;
    store.addFlag({ questionId: q.id, at: Date.now(), level: "warn", type: "later", source: "manual", ...eyes.current?.capture() });
    setToast("Moment flagged for the report");
  }, [answering, current, store]);

  const askOwn = async (text: string) => {
    const r: QuestionsResponse = await fetch("/api/questions", { method: "POST", body: JSON.stringify({ profile: session.profile, trackId: session.trackId, custom: text }) }).then((x) => x.json());
    store.addQuestions(r.personalized);
    setCurrentId(r.personalized[0].id);
  };

  const pinClaim = (text: string) => {
    const missing = unsupportedClaims(text, session.profile);
    const q = `Your profile says "${text}". Tell me about a specific problem you hit there and how you fixed it.`;
    store.addClaim({ text, supportedByGithub: missing.length ? false : null, suggestedQuestion: q });
    setToast(missing.length ? `Not in their GitHub: ${missing.join(", ")}` : "Claim pinned");
    askOwn(q);
  };

  const testNow = () => {
    const p = current && nextUnasked(current, (q) => q.stage === "probe");
    if (p) setCurrentId(p.id);
  };
  const goDeeper = () => {
    const n = current?.followUps?.find((id) => !session.trackPath.includes(id));
    if (n) setCurrentId(n);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "f" || e.key === "F") manualFlag();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manualFlag]);

  if (!session.profile)
    return (
      <div className="stage mx-auto mt-20 max-w-md space-y-4 rounded-[32px] p-10 text-center">
        <p className="text-lg">No candidate loaded yet.</p>
        <Link className="btn-primary inline-block" href="/">Set up the interview</Link>
      </div>
    );

  const p = session.profile;
  const canDeeper = !!current?.followUps?.some((id) => !session.trackPath.includes(id));
  const compareTitle = answering ? "Candidate · live" : lastAnswered && speech.transcript ? `Last answer · ${lastAnswered.text}` : "Candidate · live";
  const compareShadow = (answering?.q ?? (speech.transcript ? lastAnswered : undefined) ?? current)?.shadowAnswer ?? "";

  return (
    <div className={`grid gap-5 ${compact ? "justify-end" : "xl:h-[calc(100vh-96px)] xl:min-h-[640px] xl:grid-cols-[1fr_400px]"}`}>
      {/* ───────── Stage: the candidate ───────── */}
      <section className={`stage min-h-[560px] flex-col gap-4 rounded-[32px] p-6 xl:min-h-0 ${compact ? "hidden" : "flex"}`}>
        <header className="flex flex-wrap items-center gap-3">
          <Link href="/" className="grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"><Icon name="back" /></Link>
          <div className="mr-2">
            <div className="text-xl font-normal">{p.name ?? p.login}</div>
            <div className="text-xs text-white/50">@{p.login} · {p.topLanguages.slice(0, 3).map((l) => l.lang).join(", ")}</div>
          </div>
          <span className="chip">⏱ {session.trackPath.length ? mmss(now - session.startedAt) : "0:00"}</span>
          <span className="chip">{session.flags.length} flags</span>
          <span className="chip">GitHub · {p.source}</span>
          {session.claims.map((c, i) => (
            <span key={i} className={`chip ${c.supportedByGithub === false ? "border-warn/50 text-orange-200" : ""}`}><Icon name="pin" className="h-3 w-3" />{c.text}</span>
          ))}
          <div className="ml-auto flex gap-2">
            {p.linkedinUrl && <button className="chip hover:bg-white/20" onClick={() => openDocked(p.linkedinUrl!)}>LinkedIn <Icon name="link" className="h-3 w-3" /></button>}
            {p.source !== "fallback" && <button className="chip hover:bg-white/20" onClick={() => openDocked(`https://github.com/${p.login}`)}>GitHub <Icon name="link" className="h-3 w-3" /></button>}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1.15fr_1fr] gap-4">
          <div className="min-h-0 [&_.card]:rounded-[28px] [&_.card]:border-white/10 [&_.card]:bg-black/20">
            <EyePanel ref={eyes} emphasize={emphasize} />
          </div>
          <div className="flex min-h-0 flex-col">
            <AiCompare transcript={speech.transcript} shadow={compareShadow} title={compareTitle} emphasize={emphasize} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="label">Interview so far</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-white/40">Demo replay</span>
              <select className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs" value={replayKey} onChange={(e) => setReplayKey(e.target.value as DemoKey | "")} disabled={!!answering}>
                <option value="">Off · microphone</option>
                {(Object.keys(scripts) as DemoKey[]).filter((k) => !k.startsWith("_")).map((k) => <option key={k} value={k}>{scripts[k].label}</option>)}
              </select>
            </div>
          </div>
          <Timeline path={session.trackPath} questions={questions} scores={session.scores} flags={session.flags} onPick={(q) => !answering && setCurrentId(q.id)} />
        </div>
      </section>

      {/* ───────── Assistant sidebar ───────── */}
      <aside className={`assistant flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[32px] p-5 text-slate-800 ${compact ? "h-[calc(100vh-96px)] w-[400px]" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-lg font-normal"><Icon name="spark" /> Assistant</span>
          <button onClick={() => setCompact((c) => !c)} className="chip-light ml-auto" title="Hide the candidate panel so this fits next to Zoom">{compact ? "Full view" : "Sidebar only"}</button>
          <select
            className="rounded-full border border-white/60 bg-white/50 px-3 py-1 text-xs text-slate-700 outline-none"
            value={session.trackId}
            onChange={(e) => { store.setTrack(e.target.value); setCurrentId(undefined); }}
            disabled={!!answering}
          >
            {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {/* Stage pills: line of questioning */}
        <div className="flex flex-wrap gap-1.5">
          {STAGE_ORDER.map((st) => {
            const qs = questions.filter((q) => q.stage === st);
            const done = qs.length > 0 && qs.every((q) => session.trackPath.includes(q.id));
            const active = shown?.stage === st;
            return (
              <button
                key={st}
                disabled={!!answering}
                onClick={() => { const n = qs.find((q) => !session.trackPath.includes(q.id)) ?? qs[0]; if (n) setCurrentId(n.id); }}
                className={`rounded-full px-3 py-1 text-xs transition ${active ? "bg-slate-900 text-white" : "border border-white/60 bg-white/40 text-slate-600 hover:bg-white/70"} ${st === "probe" && !active ? "border-rose-300/70" : ""}`}
              >
                {done ? "✓ " : ""}{STAGE_LABEL[st]}
              </button>
            );
          })}
        </div>

        {/* Current question */}
        <div className={`glass-light p-5 ${answering ? "ring-2 ring-white" : ""}`}>
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
            <Icon name="spark" className="h-3.5 w-3.5" /> {answering ? `Listening · ${mmss(now - answering.askedAt)}` : scoring ? "Scoring…" : "Ask this"}
          </div>
          <p className="text-[19px] font-normal leading-snug text-slate-900">{shown?.text}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="chip-light">{STAGE_LABEL[shown?.stage ?? "warmup"]}</span>
            <span className="chip-light">{KIND_LABEL[shown?.kind ?? "easy"]}</span>
            {shown?.repoRef && <span className="chip-light">From GitHub · {shown.repoRef}</span>}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-600">
            <span className="text-slate-800">A real answer:</span> {shown?.goodAnswerHint}
          </p>

          {/* Actions: small circles + one big white primary */}
          <div className="mt-4 flex items-center gap-2">
            <button className="circle" title="Go deeper on this topic" onClick={goDeeper} disabled={!canDeeper || !!answering}><Icon name="deeper" /></button>
            <button className="circle" title="Test further: probe track" onClick={testNow} disabled={!!answering}><Icon name="probe" /></button>
            <button className="circle" title="Flag this moment (F)" onClick={manualFlag}><Icon name="flag" /></button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-slate-600">{answering ? (replayKey ? "Replaying…" : "Tap when they finish") : !replayKey && !speech.supported ? "Mic needs Chrome" : "Tap after you ask"}</span>
              {!answering ? (
                <button onClick={ask} disabled={scoring || (!replayKey && !speech.supported)} className="grid h-14 w-14 place-items-center rounded-full bg-white text-slate-900 shadow-lg transition hover:scale-105 disabled:opacity-40" title="I asked it, start listening">
                  <Icon name="mic" className="h-5 w-5" />
                </button>
              ) : (
                <button onClick={done} disabled={!!replayKey} className="grid h-14 w-14 place-items-center rounded-full bg-slate-900 text-white shadow-lg" title="Done, score it">
                  <span className="relative grid place-items-center"><span className="absolute h-10 w-10 animate-ping rounded-full bg-white/20" /><Icon name="stop" className="h-5 w-5" /></span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="pt-2">
          <RiskCard score={latest} onTestNow={testNow} onFollowUp={(id) => setCurrentId(id)} />
        </div>

        {/* Up next */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-slate-600">Up next</span>
            <button className="text-xs text-slate-600 underline-offset-2 hover:underline" onClick={() => setShowAll((x) => !x)}>{showAll ? "Hide" : "All questions"}</button>
          </div>
          {(showAll ? questions : upNext).map((q) => {
            const sc = session.scores.find((x) => x.questionId === q.id);
            const asked = session.trackPath.includes(q.id);
            return (
              <button
                key={q.id}
                disabled={!!answering}
                onClick={() => setCurrentId(q.id)}
                className={`flex w-full items-start gap-2 rounded-2xl px-3 py-2 text-left text-sm transition hover:bg-white/50 ${q.id === current?.id ? "bg-white/55" : "bg-white/25"} ${asked ? "text-slate-400" : "text-slate-700"}`}
              >
                <span className="mt-0.5 w-14 shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{STAGE_LABEL[q.stage]}</span>
                <span className="line-clamp-2 flex-1">{q.text}</span>
                {sc && <span className="text-xs tabular-nums">{sc.risk}%</span>}
              </button>
            );
          })}
        </div>

        {/* Prompt bar: ask your own / pin a LinkedIn claim */}
        <form
          className="glass-light flex items-center gap-2 p-2 pl-3"
          onSubmit={(e) => {
            e.preventDefault();
            const t = prompt.trim();
            if (!t) return;
            promptMode === "ask" ? askOwn(t) : pinClaim(t);
            setPrompt("");
          }}
        >
          <button type="button" onClick={() => setPromptMode((m) => (m === "ask" ? "claim" : "ask"))} className="chip-light shrink-0" title="Switch between asking your own question and pinning a LinkedIn claim">
            <Icon name={promptMode === "ask" ? "plus" : "pin"} className="h-3 w-3" /> {promptMode === "ask" ? "Ask" : "Claim"}
          </button>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-500"
            placeholder={promptMode === "ask" ? "Type your own question…" : 'LinkedIn claim, e.g. "5 yrs Kafka"'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-white"><Icon name="link" /></button>
        </form>


        <Link href="/report" className="mt-auto rounded-full bg-slate-900 py-3 text-center text-sm font-medium text-white hover:bg-slate-800">End interview · view & export report</Link>
      </aside>

      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-white px-5 py-2.5 text-sm text-slate-900 shadow-2xl">{toast}</div>}
    </div>
  );
}
