// Questions tab: the recruiter writes their own questions; we prepare what an AI would say to each
// and write "gotcha" follow-ups that are hard to fake. Picked ones join the live interview.
// OWNER: Person 2
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { GOTCHA_STYLES, MAX_QUESTIONS, parseQuestionList, styleLabel, styleOf, type GotchaSet, type GotchaStyle } from "@/lib/gotcha";
import type { Question } from "@/lib/types";
import { shadowsOf } from "@/lib/scoring/text";

const DRAFT_KEY = "gotcha.questionDraft";
const EXAMPLE = "How would you make sure a database migration doesn't take the site down?\nTell me about a bug that took you more than a day to find.\nWhat's your go-to language and why?";


export default function QuestionsPage() {
  const { session, addQuestions, removeQuestion, gotchas: bank, saveGotcha } = useStore();
  const [bankOpen, setBankOpen] = useState(false);
  const inBank = (text: string) => bank.some((g) => g.text.trim().toLowerCase() === text.trim().toLowerCase());
  const saveToBank = (q: Question) =>
    !inBank(q.text) && saveGotcha({ id: `g-${Date.now()}`, text: q.text, topic: q.topic && q.topic !== "custom" ? q.topic : "Any", style: styleOf(q), realAnswer: q.goodAnswerHint, createdAt: Date.now() });
  /** Bank questions go into the list, so Prepare writes their AI answers like any other question. */
  const addFromBank = (text: string) => setDraft((d) => (parseQuestionList(d).some((x) => x.toLowerCase() === text.toLowerCase()) ? d : [d.trim(), text].filter(Boolean).join("\n")));
  const [draft, setDraft] = useState("");
  const [styles, setStyles] = useState<GotchaStyle[]>(["constraint-change", "knowledge-boundary", "real-experience", "own-code"]);
  const [sets, setSets] = useState<GotchaSet[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  useEffect(() => {
    try { setDraft(localStorage.getItem(DRAFT_KEY) ?? ""); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, draft); } catch {}
  }, [draft]);

  const list = useMemo(() => parseQuestionList(draft), [draft]);
  const inInterview = session.questions.filter((q) => q.id.startsWith("mine-") || q.id.startsWith("gotcha-"));
  const allNew = sets.flatMap((s) => [s.question, ...s.gotchas]);
  const offline = sets.filter((s) => s.source === "fallback").length;

  async function prepare() {
    if (!list.length) return setError("Write at least one question, one per line.");
    setLoading(true);
    setError("");
    setAdded("");
    try {
      const r = await fetch("/api/gotcha", { method: "POST", body: JSON.stringify({ questions: list, styles, profile: session.profile, trackId: session.trackId }) }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setSets(r.sets);
      setPicked(new Set((r.sets as GotchaSet[]).flatMap((s) => [s.question.id, ...s.gotchas.map((g) => g.id)])));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't prepare the questions. Is the dev server running?");
    } finally {
      setLoading(false);
    }
  }

  /** .txt / .md: one question per line. .csv: first column. */
  async function upload(file: File) {
    const text = await file.text();
    const lines = file.name.toLowerCase().endsWith(".csv")
      ? text.split(/\r?\n/).map((l) => l.match(/^\s*"((?:[^"]|"")*)"|^([^,]*)/)).map((m) => (m?.[1] ?? m?.[2] ?? "").replace(/""/g, '"'))
      : text.split(/\r?\n/);
    const rows = lines.map((l) => l.trim()).filter(Boolean);
    if (rows[0] && /^(questions?|prompts?|text|interview questions?)$/i.test(rows[0])) rows.shift(); // header row
    setDraft((d) => [d.trim(), ...rows].filter(Boolean).join("\n"));
    setSets([]);
  }

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function addPicked() {
    const qs = allNew.filter((q) => picked.has(q.id)).map((q) => ({ ...q, followUps: q.followUps?.filter((id) => picked.has(id)) }));
    addQuestions(qs);
    setAdded(`Added ${qs.length} question${qs.length === 1 ? "" : "s"} to the interview.`);
  }

  return (
    <div className="grid min-h-[calc(100vh-96px)] grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="stage flex flex-col gap-5 rounded-[32px] p-8">
        <div>
          <div className="label">Prep · this interview</div>
          <h1 className="mt-1 text-4xl font-light tracking-tight">What do you want to ask?</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">
            Write or upload your questions, one per line. Several AI models answer each one, so GotCha can compare the candidate against all of them live, and we write gotcha follow-ups that are hard to fake.
          </p>
        </div>

        <label className="space-y-1.5">
          <span className="label">One question per line (up to {MAX_QUESTIONS})</span>
          <textarea
            className="min-h-[220px] w-full rounded-3xl border border-white/15 bg-white/[0.06] p-4 text-sm leading-relaxed text-white outline-none placeholder:text-white/35 focus:border-white/50"
            placeholder={EXAMPLE}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-white/50">
            {list.length} question{list.length === 1 ? "" : "s"}
            <span>·</span>
            <label className="cursor-pointer underline hover:text-white">
              Upload a list (.txt, .csv)
              <input type="file" accept=".txt,.csv,.md,text/plain,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            </label>
            {!draft && <><span>·</span><button className="underline hover:text-white" onClick={() => setDraft(EXAMPLE)}>use examples</button></>}
            <span>·</span>
            <button className="underline hover:text-white" onClick={() => setBankOpen((o) => !o)}>{bankOpen ? "Hide my Gotcha Bank" : `Add from my Gotcha Bank (${bank.length})`}</button>
          </span>
        </label>

        {bankOpen && (
          <div className="space-y-2 rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between">
              <span className="label">My Gotcha Bank</span>
              <Link href="/library" className="text-xs text-white/50 underline hover:text-white">Manage in Library</Link>
            </div>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {bank.map((g) => {
                const listed = list.some((x) => x.toLowerCase() === g.text.toLowerCase());
                return (
                  <li key={g.id} className="flex items-start gap-3 rounded-2xl bg-white/[0.05] px-3 py-2 text-sm">
                    <span className="flex-1 text-white/85">{g.text}<span className="ml-2 text-[11px] text-white/40">{styleLabel(g.style)}</span></span>
                    <button className="shrink-0 text-xs text-white/60 hover:text-white disabled:opacity-40" disabled={listed} onClick={() => addFromBank(g.text)}>{listed ? "✓ In list" : "+ Add"}</button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <span className="label">Gotcha follow-ups to write</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {GOTCHA_STYLES.map((s) => {
              const on = styles.includes(s.id);
              const needsRepo = s.id === "own-code" && !session.profile;
              return (
                <button
                  key={s.id}
                  onClick={() => setStyles((x) => (on ? x.filter((y) => y !== s.id) : [...x, s.id]))}
                  className={`rounded-3xl border p-3 text-left transition ${on ? "border-white/60 bg-white/15" : "border-white/15 bg-white/[0.04] opacity-60 hover:opacity-90"}`}
                >
                  <div className="text-sm font-medium">{on ? "✓ " : ""}{s.label}</div>
                  <div className="mt-0.5 text-xs text-white/60">{needsRepo ? "Load a candidate on Setup first to use their repo." : s.explain}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <button className="btn-primary px-6 py-3" onClick={prepare} disabled={loading || !list.length}>
            {loading ? `Preparing ${list.length} question${list.length === 1 ? "" : "s"}…` : "Prepare for AI check"}
          </button>
          {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
        </div>

        {inInterview.length > 0 && (
          <div className="mt-auto space-y-2">
            <span className="label">Already in this interview ({inInterview.length})</span>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {inInterview.map((q) => (
                <li key={q.id} className="flex items-start gap-2 rounded-2xl bg-black/20 px-3 py-2">
                  <span className="flex-1 text-white/85">{q.id.startsWith("gotcha-") && <span className="mr-1 text-white/50">↳</span>}{q.text}</span>
                  <button className="text-xs text-white/50 hover:text-white" onClick={() => removeQuestion(q.id)} aria-label="Remove">Remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-4">
        {!sets.length && (
          <div className="card text-sm text-white/60">
            Prepared questions show up here. Each gets:
            <ul className="mt-2 space-y-1 text-white/50">
              <li>• what several AI models would answer, which the live check compares against</li>
              <li>• what a real answer sounds like, in plain English</li>
              <li>• gotcha follow-ups you can tick on or off</li>
            </ul>
          </div>
        )}

        {sets.length > 0 && (
          <p className="px-2 text-sm text-white/60">
            ✓ {sets.length} prepared · {sets.reduce((a, s) => a + s.gotchas.length, 0)} gotchas
            {offline ? ` · ${offline} from offline templates (AI unavailable or busy)` : " · written by AI"}
          </p>
        )}

        <div className="flex flex-col gap-3 overflow-y-auto">
          {sets.map((s) => (
            <div key={s.question.id} className="card space-y-3">
              <QuestionRow q={s.question} picked={picked.has(s.question.id)} onToggle={() => toggle(s.question.id)} open={open === s.question.id} onOpen={() => setOpen(open === s.question.id ? undefined : s.question.id)} badge={s.question.kind === "easy" ? "Warm-up" : "Core"} />
              {s.gotchas.length > 0 && (
                <div className="space-y-2 border-l border-white/15 pl-4">
                  {s.gotchas.map((g) => (
                    <QuestionRow key={g.id} q={g} picked={picked.has(g.id)} onToggle={() => toggle(g.id)} open={open === g.id} onOpen={() => setOpen(open === g.id ? undefined : g.id)} badge={styleLabel(styleOf(g))} small saved={inBank(g.text)} onSave={() => saveToBank(g)} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {sets.length > 0 && (
          <div className="mt-auto flex flex-wrap items-center gap-3">
            <button className="btn-primary px-6 py-3" onClick={addPicked} disabled={!picked.size}>Add {picked.size} to the interview</button>
            {added && <span className="text-sm text-white/70">✓ {added} <Link href="/live" className="underline">Go to the live interview →</Link></span>}
          </div>
        )}
      </aside>
    </div>
  );
}

function AiAnswers({ q }: { q: Question }) {
  const all = shadowsOf(q);
  return (
    <div className="mt-1 space-y-2">
      {all.map((s, i) => (
        <div key={i} className="rounded-2xl bg-black/25 p-3">
          <div className="label mb-1">{all.length > 1 ? s.model : "What an AI would say"}</div>
          <p className="text-white/70">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

function QuestionRow({ q, picked, onToggle, open, onOpen, badge, small, saved, onSave }: { q: Question; picked: boolean; onToggle: () => void; open: boolean; onOpen: () => void; badge: string; small?: boolean; saved?: boolean; onSave?: () => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={picked} onChange={onToggle} className="mt-1 h-4 w-4 accent-white" aria-label="Add to interview" />
        <div className="flex-1">
          <span className="chip mr-2 align-middle text-[10px] uppercase tracking-wider">{badge}</span>
          <span className={small ? "text-sm text-white/90" : "text-base"}>{q.text}</span>
        </div>
      </div>
      <div className="pl-7 text-xs text-white/55">
        <p>A real answer: {q.goodAnswerHint}</p>
        <div className="mt-1 flex flex-wrap gap-x-3">
          <button className="underline hover:text-white" onClick={onOpen}>
            {open ? "Hide" : "Show"} {shadowsOf(q).length > 1 ? `${shadowsOf(q).length} possible AI answers` : "what an AI would say"}
          </button>
          {onSave && (
            <button className="underline hover:text-white disabled:no-underline disabled:opacity-60" disabled={saved} onClick={onSave}>
              {saved ? "✓ In my Gotcha Bank" : "Save to my Gotcha Bank"}
            </button>
          )}
        </div>
        {open && <AiAnswers q={q} />}
      </div>
    </div>
  );
}
