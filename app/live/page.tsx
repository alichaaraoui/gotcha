// Live Room. OWNER: Person 1 (EyePanel is Person 3's, scoring is Person 2's)
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { allQuestions, useStore } from "@/lib/store";
import { useSpeech } from "@/lib/speech";
import { latencyMs, wpm } from "@/lib/scoring/signals";
import { RiskMeter } from "@/components/RiskMeter";
import { TranscriptCompare } from "@/components/TranscriptCompare";
import { TrackBreadcrumb } from "@/components/TrackBreadcrumb";
import { SuggestionCard } from "@/components/SuggestionCard";
import { LiveControls } from "@/components/LiveControls";
import { PinClaim } from "@/components/PinClaim";
import { LinkedInButton } from "@/components/LinkedInButton";
import { EyePanel, type EyePanelHandle } from "@/components/EyePanel";
import demo from "@/data/demo_scripts.json";
import type { AnswerEvent, Question, QuestionsResponse, Score, ScoreRequest, WordStamp } from "@/lib/types";

const MAX_LIVE_PROMPTS = 5; // cap so Sarah isn't flooded

type DemoKey = "organic" | "assisted";
const scripts = demo as unknown as Record<DemoKey, { label: string; answers: Record<string, { delayMs: number; wpm: number; text: string }> }>;

export default function Live() {
  const store = useStore();
  const { session, track, weights, knownAi } = store;
  const speech = useSpeech();
  const eyes = useRef<EyePanelHandle>(null);
  const questions = useMemo(() => allQuestions(track, session), [track, session]);
  const [currentId, setCurrentId] = useState<string>();
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [scoring, setScoring] = useState(false);
  const [replayKey, setReplayKey] = useState<DemoKey | "">("");

  const current = questions.find((q) => q.id === currentId) ?? questions[0];
  const lastScore = session.scores.find((s) => s.questionId === current?.id) ?? session.scores.at(-1);
  const emphasize = (lastScore?.risk ?? 0) >= 20;

  // Baseline = the candidate's own warm-up answers
  const baseline = useMemo(() => {
    const warm = session.events.filter((e) => questions.find((q) => q.id === e.questionId)?.stage === "warmup");
    if (!warm.length) return null;
    const fake = (e: AnswerEvent) => ({ event: e } as ScoreRequest);
    return {
      latencyMs: warm.reduce((a, e) => a + latencyMs(fake(e)), 0) / warm.length,
      wpm: warm.reduce((a, e) => a + wpm(fake(e)), 0) / warm.length,
      gaze: session.gaze.find((g) => warm.some((e) => e.questionId === g.questionId)) ?? null,
    };
  }, [session.events, session.gaze, questions]);

  const ask = () => {
    if (!current) return;
    store.markAsked(current.id);
    const now = Date.now();
    setAskedAt(now);
    if (replayKey) {
      const a = scripts[replayKey].answers[current.id];
      const text = a?.text ?? "um I'm not totally sure, I'd have to think about that one";
      speech.replay(text, a?.delayMs ?? 1500, a?.wpm ?? 130, (t, w) => finish(t, w, now));
    } else {
      speech.start();
    }
  };

  const finish = useCallback(async (transcript: string, words: WordStamp[], startedAt: number) => {
    if (!current) return;
    setScoring(true);
    const endedAt = Date.now();
    const event: AnswerEvent = { questionId: current.id, transcript, words, askedAt: startedAt, firstWordAt: words[0]?.t ?? null, endedAt };
    const gaze = eyes.current?.window(current.id, startedAt, endedAt, current.stage === "warmup") ?? null;
    const body: ScoreRequest = {
      question: current, event, gaze, baseline, profile: session.profile, checklist: session.checklist, weights, knownAi,
      easyVsHard: baseline ? { easyLatencyMs: baseline.latencyMs, easyWpm: baseline.wpm } : null,
    };
    const score: Score = await fetch("/api/score", { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
    store.recordAnswer(event, gaze, score);
    if (score.level === "flag" || score.level === "warn") {
      const liveCount = session.flags.filter((f) => f.type === "live").length;
      const type = score.level === "flag" && liveCount < MAX_LIVE_PROMPTS ? "live" : "later";
      store.addFlag({ questionId: current.id, at: endedAt, level: score.level, type, source: "auto", ...(score.level === "flag" ? eyes.current?.capture() : {}) });
    }
    setAskedAt(null);
    setScoring(false);
  }, [current, baseline, session, weights, knownAi, store]);

  const done = () => {
    const { transcript, words } = speech.stop();
    if (askedAt) finish(transcript, words, askedAt);
  };

  const manualFlag = useCallback(() => {
    if (current) store.addFlag({ questionId: current.id, at: Date.now(), level: "warn", type: "later", source: "manual", ...eyes.current?.capture() });
  }, [current, store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && !(e.target instanceof HTMLInputElement)) manualFlag();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manualFlag]);

  const firstUnasked = (pred: (q: Question) => boolean) => questions.find((q) => pred(q) && !session.trackPath.includes(q.id));

  if (!questions.length) return <p>Loading… <Link className="underline" href="/">Go to setup</Link></p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr_300px]">
      <div className="space-y-4">
        <TrackBreadcrumb track={track} questions={questions} asked={session.trackPath} currentId={current?.id} onPick={(q) => setCurrentId(q.id)} />
        <div className="card space-y-2 text-sm">
          <div className="label">Replay mode (no mic)</div>
          <select className="input" value={replayKey} onChange={(e) => setReplayKey(e.target.value as DemoKey | "")}>
            <option value="">Off: use microphone</option>
            {(Object.keys(scripts) as DemoKey[]).filter((k) => !k.startsWith("_")).map((k) => <option key={k} value={k}>{scripts[k].label}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card">
          <div className="label mb-1">Ask this</div>
          <p className="text-xl font-medium">{current?.text}</p>
          <div className="mt-3 flex gap-2">
            {!askedAt
              ? <button className="btn-primary" onClick={ask} disabled={scoring || (!replayKey && !speech.supported)}>I asked it, start listening</button>
              : <button className="btn-primary bg-clear hover:bg-green-400" onClick={done} disabled={!!replayKey}>Done, score it</button>}
            {scoring && <span className="self-center text-sm text-slate-400">Scoring…</span>}
            {!speech.supported && !replayKey && <span className="self-center text-xs text-warn">Mic transcription needs Chrome. Use replay mode.</span>}
          </div>
        </div>
        <TranscriptCompare transcript={speech.transcript} shadow={current?.shadowAnswer ?? ""} emphasize={emphasize} />
        <LiveControls
          trackId={session.trackId}
          canDeeper={!!current?.followUps?.length}
          onSwitchTrack={(id) => { store.setTrack(id); setCurrentId(undefined); }}
          onDeeper={() => { const n = current?.followUps?.find((id) => !session.trackPath.includes(id)); if (n) setCurrentId(n); }}
          onTestFurther={() => { const p = firstUnasked((q) => q.stage === "probe"); if (p) setCurrentId(p.id); }}
          onAskOwn={async (text) => {
            const r: QuestionsResponse = await fetch("/api/questions", { method: "POST", body: JSON.stringify({ profile: session.profile, trackId: session.trackId, custom: text }) }).then((x) => x.json());
            store.addQuestions(r.personalized);
            setCurrentId(r.personalized[0].id);
          }}
          onManualFlag={manualFlag}
        />
      </div>

      <div className="space-y-4">
        <RiskMeter risk={lastScore?.risk ?? 0} level={lastScore?.level ?? "clear"} />
        <SuggestionCard score={lastScore} question={current} />
        <EyePanel ref={eyes} emphasize={emphasize} />
        <LinkedInButton url={session.profile?.linkedinUrl} />
        <PinClaim profile={session.profile} claims={session.claims} onAdd={store.addClaim} />
        <Link href="/report" className="btn-ghost block text-center">End interview → report</Link>
      </div>
    </div>
  );
}
