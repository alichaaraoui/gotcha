// Live interview, one-glance version.
// Sidebar answers the only three things a recruiter needs mid-call:
//   What do I ask?  Are they genuine?  What do I do next?
// Everything else is under "More" or in the optional candidate panel.
// OWNER: Person 1 (EyePanel is Person 3's, scoring is Person 2's)
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TRACKS, allQuestions, useStore } from "@/lib/store";
import { useSpeech } from "@/lib/speech";
import { useCallCapture } from "@/lib/callCapture";
import { latencyMs, unsupportedClaims, wpm } from "@/lib/scoring/signals";
import { EyePanel, type EyePanelHandle } from "@/components/EyePanel";
import { openDocked } from "@/components/LinkedInButton";
import { Timeline } from "@/components/live/Timeline";
import { AiCompare } from "@/components/live/AiCompare";
import { StatusBar } from "@/components/live/StatusBar";
import { Suggestion } from "@/components/live/Suggestion";
import { Icon } from "@/components/Icon";
import demo from "@/data/demo_scripts.json";
import type { AnswerEvent, Question, QuestionsResponse, Score, ScoreRequest, WordStamp } from "@/lib/types";

const MAX_LIVE_PROMPTS = 5; // cap so the recruiter isn't flooded
const STAGE_ORDER = ["warmup", "core", "deep", "probe", "wrap"];

type DemoKey = "organic" | "assisted";
const scripts = demo as unknown as Record<DemoKey, { label: string; answers: Record<string, { delayMs: number; wpm: number; text: string }> }>;

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export default function Live() {
  const store = useStore();
  const { session, track, weights, knownAi } = store;
  const speech = useSpeech();
  const call = useCallCapture();
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
  const [source, setSource] = useState<"zoom" | "mic" | DemoKey>("zoom"); // where the candidate's voice comes from
  const replayKey: DemoKey | "" = source === "organic" || source === "assisted" ? source : "";
  const [showCompare, setShowCompare] = useState(false);
  const [more, setMore] = useState(false);
  const [own, setOwn] = useState("");
  const [claim, setClaim] = useState("");
  const [toast, setToast] = useState<string>();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Get mic permission when the room opens (not mid-answer); skipped in replay mode
  useEffect(() => {
    if (speech.supported && source === "mic" && speech.micReady === null) speech.prepare();
  }, [speech.supported, source, speech.micReady, speech.prepare]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const current = questions.find((q) => q.id === currentId) ?? questions.find((q) => !session.trackPath.includes(q.id)) ?? questions[0];
  const shown = answering?.q ?? current;
  const latest = session.scores.at(-1);

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
    (after: Question | undefined, pred: (q: Question) => boolean = () => true) => {
      const asked = new Set([...sessionRef.current.trackPath, ...(after ? [after.id] : [])]);
      const idx = after ? questions.findIndex((q) => q.id === after.id) : -1;
      return [...questions.slice(idx + 1), ...questions.slice(0, Math.max(0, idx))].find((q) => pred(q) && !asked.has(q.id));
    },
    [questions]
  );

  // When an answer looks off, pick the tougher question to ask instead (recruiter can go back to the plan)
  const pickSwitch = useCallback(
    (score: Score, answered: Question, asked: Set<string>) => {
      const open = (id?: string) => questions.find((q) => q.id === id && !asked.has(q.id));
      if (score.level === "flag") {
        const q = questions.find((x) => x.probeStyle === "own-code" && !asked.has(x.id)) ?? questions.find((x) => x.stage === "probe" && !asked.has(x.id));
        return q && { question: q, why: "That answer sounded scripted, so we switched to a question about their own code. AI can't fake that." };
      }
      if (score.level === "warn") {
        const q = open(score.suggestedQuestionId) ?? answered.followUps?.map(open).find(Boolean) ?? questions.find((x) => x.stage === "deep" && !asked.has(x.id));
        return q && { question: q, why: "Something didn't add up, so we switched to a follow-up on the same topic to check it's really theirs." };
      }
      return undefined;
    },
    [questions]
  );
  const [switched, setSwitched] = useState<{ question: Question; why: string; planId?: string }>();

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
        const next = nextUnasked(q);
        const sw = pickSwitch(score, q, new Set([...s.trackPath, q.id]));
        setSwitched(sw && { ...sw, planId: next?.id });
        const target = sw?.question ?? next;
        if (target) setCurrentId(target.id);
      } finally {
        setAnswering(null);
        setScoring(false);
      }
    },
    [baseline, weights, knownAi, store, nextUnasked, pickSwitch]
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
    } else if (source === "zoom") {
      call.startAnswer(askedAt);
    } else {
      speech.start();
    }
  };

  const [catching, setCatching] = useState(false);
  const done = async () => {
    if (!answering) return;
    if (source === "zoom") {
      setCatching(true); // the last few seconds of call audio are still being transcribed
      const { transcript, words } = await call.endAnswer();
      setCatching(false);
      finish(answering.q, transcript, words, answering.askedAt);
    } else {
      const { transcript, words } = speech.stop();
      finish(answering.q, transcript, words, answering.askedAt);
    }
  };

  const flagMoment = useCallback(() => {
    const q = answering?.q ?? lastAnswered ?? current;
    if (!q) return;
    store.addFlag({ questionId: q.id, at: Date.now(), level: "warn", type: "later", source: "manual", ...eyes.current?.capture() });
    setToast("Moment flagged for the report");
  }, [answering, lastAnswered, current, store]);

  const askOwn = async (text: string) => {
    const r: QuestionsResponse = await fetch("/api/questions", { method: "POST", body: JSON.stringify({ profile: session.profile, trackId: session.trackId, custom: text }) }).then((x) => x.json());
    store.addQuestions(r.personalized);
    setCurrentId(r.personalized[0].id);
    setToast("Your question is up next");
  };

  const pinClaim = (text: string) => {
    const missing = unsupportedClaims(text, session.profile);
    const q = `Your profile says "${text}". Tell me about a specific problem you hit there and how you fixed it.`;
    store.addClaim({ text, supportedByGithub: missing.length ? false : null, suggestedQuestion: q });
    askOwn(q);
    setToast(missing.length ? `Not in their GitHub: ${missing.join(", ")}. Question added.` : "Claim pinned. Question added.");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "f" || e.key === "F") flagMoment();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flagMoment]);

  if (!session.profile)
    return (
      <div className="stage mx-auto mt-20 max-w-md space-y-4 rounded-[32px] p-10 text-center">
        <p className="text-lg">No candidate loaded yet.</p>
        <Link className="btn-primary inline-block" href="/">Set up the interview</Link>
      </div>
    );

  const p = session.profile;
  const asked = session.trackPath.length;
  const progress = `Question ${Math.min(questions.length, asked + (answering ? 0 : 1))} of ${questions.length}`;
  const compareOpen = showCompare || (latest && latest.level !== "clear");
  const words = source === "zoom" ? call.transcript : speech.transcript;
  const listenError = source === "zoom" ? call.error : source === "mic" ? speech.error : undefined;
  const cantListen =
    source === "zoom" ? !call.connected || !call.hasAudio : source === "mic" ? !speech.supported || speech.micReady === false : false;
  const needsConnect = source === "zoom" && !call.connected;

  return (
    <div className="grid h-[calc(100vh-96px)] min-h-[620px] grid-cols-[1fr_420px] gap-5">
      {/* ───────── Left: the Zoom call (candidate video + their words) ───────── */}
      <section className={`min-h-0 rounded-[32px] ${needsConnect ? "grid place-items-center border border-dashed border-white/15" : "stage flex flex-col gap-4 p-6"}`}>
        {needsConnect && (
          <div className="max-w-md space-y-5 text-center">
            <p className="text-3xl font-light">Bring your Zoom call in here</p>
            <ol className="space-y-2 text-left text-sm text-white/65">
              <li><b className="text-white">1.</b> Join the interview in <b className="text-white">Chrome</b> (on the Zoom invite, choose <i>Join from your browser</i>).</li>
              <li><b className="text-white">2.</b> Click <b className="text-white">Connect Zoom call</b> below and pick that Chrome tab.</li>
              <li><b className="text-white">3.</b> Make sure <b className="text-white">Also share tab audio</b> is on. That&apos;s how GotCha hears the candidate, not you.</li>
            </ol>
            <button className="btn-primary px-6 py-3 text-base" onClick={call.connect}>Connect Zoom call</button>
            {call.error && <p className="text-sm text-red-300">{call.error}</p>}
            <p className="text-xs text-white/40">
              Interviewing in person? <button className="underline" onClick={() => setSource("mic")}>Use this laptop&apos;s mic</button> · No call?{" "}
              <button className="underline" onClick={() => setSource("assisted")}>Use demo answers</button>
            </p>
          </div>
        )}

        {/* Stays mounted so eye tracking keeps running */}
        <div className={needsConnect ? "hidden" : "flex min-h-0 flex-1 flex-col gap-4"}>
          <header className="flex items-center gap-3">
            <div>
              <div className="text-xl font-normal">{p.name ?? p.login}</div>
              <div className="text-xs text-white/50">@{p.login} · {session.trackPath.length ? mmss(now - session.startedAt) : "0:00"}</div>
            </div>
            <span className="chip ml-auto">
              <span className={`h-2 w-2 rounded-full ${source === "zoom" ? (call.hasAudio ? "bg-clear" : "bg-warn") : "bg-white/50"}`} />
              {source === "zoom" ? (call.hasAudio ? "Hearing the candidate from Zoom" : "No call audio") : source === "mic" ? "Laptop mic (same room)" : "Demo answers"}
            </span>
            {source === "zoom" && call.connected && <button className="chip hover:bg-white/20" onClick={call.disconnect}>Disconnect</button>}
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-[1.4fr_1fr] gap-4">
            <div className="min-h-0 overflow-y-auto [&_.card]:rounded-[28px] [&_.card]:border-white/10 [&_.card]:bg-black/20">
              <EyePanel ref={eyes} stream={source === "zoom" ? call.stream : null} emphasize={!!latest && latest.level !== "clear"} />
            </div>
            <div className="flex min-h-0 flex-col gap-2">
              {compareOpen ? (
                <AiCompare
                  transcript={words}
                  shadow={(answering?.q ?? (words ? lastAnswered : undefined) ?? current)?.shadowAnswer ?? ""}
                  title={answering ? "What the candidate is saying" : "Their last answer"}
                  emphasize={!!latest && latest.level !== "clear"}
                />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl border border-white/10 bg-black/20 p-4">
                  <div className="label mb-2">{answering ? "What the candidate is saying" : "Their last answer"}</div>
                  <p className="text-[15px] leading-relaxed text-white/90">
                    {words || <span className="text-white/35">{answering ? "Listening to the candidate…" : "Their words appear here when you tap start listening."}</span>}
                  </p>
                </div>
              )}
              {!(latest && latest.level !== "clear") && (
                <button className="self-start text-xs text-white/50 hover:text-white" onClick={() => setShowCompare((x) => !x)}>
                  {showCompare ? "Hide AI comparison" : "Compare with what an AI would say"}
                </button>
              )}
            </div>
          </div>
          <Timeline path={session.trackPath} questions={questions} scores={session.scores} flags={session.flags} onPick={(q) => !answering && setCurrentId(q.id)} />
        </div>
      </section>

      {/* ───────── Right: the one-glance assistant ───────── */}
      <aside className="assistant flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[32px] p-5 text-slate-800">
        {/* 1 · Are they genuine? */}
        <StatusBar level={latest?.level ?? null} progress={progress} />

        {/* 2 · What do I ask? */}
        <div className={`glass-light p-5 ${answering ? "ring-2 ring-white" : ""}`}>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
            {answering ? `Listening · ${mmss(now - answering.askedAt)}` : scoring ? "Checking the answer…" : "Ask this"}
          </div>
          <p className="mt-2 text-[21px] font-normal leading-snug text-slate-900">{shown?.text}</p>
          {!answering && <p className="mt-2 text-xs leading-relaxed text-slate-600">A real answer: {shown?.goodAnswerHint}</p>}

          {!answering ? (
            <button
              onClick={ask}
              disabled={scoring || cantListen}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3.5 text-[15px] font-medium text-slate-900 shadow-lg transition hover:scale-[1.01] disabled:opacity-40"
            >
              <Icon name="mic" className="h-5 w-5" /> {replayKey ? "Play demo answer" : needsConnect ? "Connect the Zoom call first" : "I asked it · start listening"}
            </button>
          ) : (
            <button
              onClick={done}
              disabled={!!replayKey || catching}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 py-3.5 text-[15px] font-medium text-white shadow-lg disabled:opacity-70"
            >
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-400" /> {replayKey ? "Demo answer playing…" : catching ? "Catching their last words…" : "They finished · check answer"}
            </button>
          )}
          {listenError && <p className="mt-3 rounded-2xl bg-rose-100/80 px-3 py-2 text-xs text-rose-700">{listenError}</p>}
        </div>

        {/* 3 · What do I do next? */}
        <Suggestion
          score={answering ? undefined : latest}
          switched={!answering && switched && current?.id === switched.question.id ? switched : undefined}
          onBack={() => { if (switched?.planId) setCurrentId(switched.planId); setSwitched(undefined); }}
        />

        <div className="flex gap-2">
          <button
            className="flex-1 rounded-full border border-white/60 bg-white/45 py-2.5 text-sm hover:bg-white/70 disabled:opacity-40"
            disabled={!!answering}
            onClick={() => { const n = nextUnasked(current); if (n) setCurrentId(n.id); setSwitched(undefined); }}
          >
            Skip to next question →
          </button>
          <button className="rounded-full border border-white/60 bg-white/45 px-4 py-2.5 text-sm hover:bg-white/70" onClick={flagMoment} title="Keyboard: F">
            ⚑ Flag moment
          </button>
        </div>

        {/* Everything else, tucked away */}
        <div className="glass-light overflow-hidden">
          <button className="flex w-full items-center justify-between px-5 py-3 text-sm" onClick={() => setMore((m) => !m)}>
            <span>More</span>
            <span className="text-xs text-slate-500">{more ? "Close" : "Questions, LinkedIn, demo…"}</span>
          </button>
          {more && (
            <div className="space-y-4 border-t border-white/50 px-5 py-4 text-sm">
              <label className="block space-y-1">
                <span className="text-xs text-slate-500">Line of questioning</span>
                <select className="w-full rounded-full border border-white/60 bg-white/60 px-3 py-2 outline-none" value={session.trackId} disabled={!!answering} onChange={(e) => { store.setTrack(e.target.value); setCurrentId(undefined); }}>
                  {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (own.trim()) { askOwn(own.trim()); setOwn(""); } }}>
                <span className="text-xs text-slate-500">Ask your own question</span>
                <div className="flex gap-2">
                  <input className="min-w-0 flex-1 rounded-full border border-white/60 bg-white/60 px-3 py-2 outline-none placeholder:text-slate-400" placeholder="Type a question…" value={own} onChange={(e) => setOwn(e.target.value)} />
                  <button className="rounded-full bg-slate-900 px-4 text-white">Add</button>
                </div>
              </form>
              <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (claim.trim()) { pinClaim(claim.trim()); setClaim(""); } }}>
                <span className="text-xs text-slate-500">Check a LinkedIn claim against their GitHub</span>
                <div className="flex gap-2">
                  <input className="min-w-0 flex-1 rounded-full border border-white/60 bg-white/60 px-3 py-2 outline-none placeholder:text-slate-400" placeholder='e.g. "5 years of Kafka"' value={claim} onChange={(e) => setClaim(e.target.value)} />
                  <button className="rounded-full bg-slate-900 px-4 text-white">Check</button>
                </div>
                {session.claims.map((c, i) => (
                  <div key={i} className="text-xs text-slate-600">{c.supportedByGithub === false ? "⚠" : "•"} {c.text}</div>
                ))}
              </form>
              <div className="flex flex-wrap gap-2">
                {p.linkedinUrl && <button className="chip-light" onClick={() => openDocked(p.linkedinUrl!)}>Open LinkedIn ↗</button>}
                {p.source !== "fallback" && <button className="chip-light" onClick={() => openDocked(`https://github.com/${p.login}`)}>Open GitHub ↗</button>}
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-slate-500">Listen to</span>
                <select className="w-full rounded-full border border-white/60 bg-white/60 px-3 py-2 outline-none" value={source} disabled={!!answering} onChange={(e) => setSource(e.target.value as typeof source)}>
                  <option value="zoom">The Zoom call (candidate only)</option>
                  <option value="mic">This laptop&apos;s mic (in-person interview)</option>
                  <option value="organic">Demo answers · organic candidate</option>
                  <option value="assisted">Demo answers · AI-assisted candidate</option>
                </select>
              </label>
            </div>
          )}
        </div>

        <Link href="/report" className="mt-auto rounded-full bg-slate-900 py-3 text-center text-sm font-medium text-white hover:bg-slate-800">End interview · see report</Link>
      </aside>

      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-white px-5 py-2.5 text-sm text-slate-900 shadow-2xl">{toast}</div>}
    </div>
  );
}
