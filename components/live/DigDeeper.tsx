// "Dig deeper": ready-to-ask question ideas for the interviewer.
//   Their GitHub → pick a repo, get 3 questions only the author could answer
//   Last answer → 3 follow-ups that push on what they just said
//   Your own    → type a question, or check a LinkedIn claim against their GitHub
// OWNER: Person 1
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CandidateProfile, Gotcha, Question, QuestionsResponse } from "@/lib/types";

type Tab = "github" | "answer" | "gotchas" | "own";

export function DigDeeper({ profile, trackId, last, disabled, gotchas, onAsk, onAskOwn, onAskGotcha, onClaim }: {
  profile: CandidateProfile;
  trackId: string;
  last?: { question: Question; answer: string };
  disabled: boolean;
  onAsk: (q: Question) => void;
  onAskOwn: (text: string) => void;
  onClaim: (text: string) => void;
  gotchas: Gotcha[];
  onAskGotcha: (g: Gotcha) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("github");
  const [repo, setRepo] = useState<string | undefined>(profile.repos[0]?.name);
  const [ideas, setIdeas] = useState<Record<string, Question[]>>({}); // cached per repo / per answer
  const [loading, setLoading] = useState(false);
  const [own, setOwn] = useState("");
  const [claim, setClaim] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const key = tab === "github" ? `gh:${repo}` : `ans:${last?.question.id}`;
  const list = ideas[key];

  const load = async (force = false) => {
    if (tab === "own" || tab === "gotchas" || (tab === "answer" && !last) || (!force && ideas[key])) return;
    setLoading(true);
    try {
      const r: QuestionsResponse = await fetch("/api/questions", {
        method: "POST",
        body: JSON.stringify({
          profile,
          trackId,
          ideas: tab === "github" ? { focus: "github", repo } : { focus: "answer", lastQuestion: last?.question.text, lastAnswer: last?.answer },
        }),
      }).then((x) => x.json());
      setIdeas((m) => ({ ...m, [key]: r.personalized }));
    } finally {
      setLoading(false);
    }
  };

  // Bring the ideas into view on small screens
  useEffect(() => {
    if (open) setTimeout(() => box.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
  }, [open, tab, list?.length]);

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  return (
    <div ref={box} className="glass-light shrink-0 overflow-hidden">
      <button className="flex w-full items-center justify-between px-5 py-3.5" onClick={() => setOpen((o) => !o)}>
        <span className="text-[15px]">Dig deeper</span>
        <span className="text-xs text-slate-500">{open ? "Close" : "Question ideas from their GitHub →"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/50 px-4 pb-4 pt-3">
          <div className="flex gap-1 rounded-full bg-white/40 p-1 text-xs">
            {([["github", "GitHub"], ["answer", "Last answer"], ["gotchas", "Gotchas"], ["own", "Your own"]] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-full py-1.5 transition ${tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white/60"}`}>{label}</button>
            ))}
          </div>

          {tab === "github" && (
            <div className="flex flex-wrap gap-1.5">
              {profile.repos.slice(0, 5).map((r) => (
                <button
                  key={r.name}
                  onClick={() => setRepo(r.name)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${repo === r.name ? "border-slate-900 bg-slate-900 text-white" : "border-white/70 bg-white/50 text-slate-700 hover:bg-white/80"}`}
                  title={r.description ?? ""}
                >
                  {r.name}{r.language ? <span className="opacity-60"> · {r.language}</span> : null}
                </button>
              ))}
            </div>
          )}

          {tab === "answer" && !last && <p className="px-1 text-sm text-slate-600">Ask a question first. Follow-ups on their answer show up here.</p>}
          {tab === "answer" && last && <p className="line-clamp-2 px-1 text-xs italic text-slate-500">On: &ldquo;{last.answer || last.question.text}&rdquo;</p>}

          {tab === "gotchas" && (
            <div className="space-y-2">
              <p className="px-1 text-xs text-slate-500">Your off-script questions for when something feels rehearsed.</p>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {gotchas.map((g) => (
                  <div key={g.id} className="rounded-2xl bg-white/70 p-3">
                    <p className="text-sm leading-snug text-slate-900">{g.text}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">{g.style.replace("-", " ")} · {g.topic}</span>
                      <button disabled={disabled} onClick={() => onAskGotcha(g)} className="ml-auto shrink-0 rounded-full bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-40">Ask this →</button>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/library" className="block text-center text-xs text-slate-500 hover:text-slate-800">Manage or import from your Google Doc →</Link>
            </div>
          )}

          {(tab === "github" || (tab === "answer" && last)) && (
            <div className="space-y-2">
              {loading && !list && [0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/40" />)}
              {list?.map((q) => (
                <div key={q.id} className="rounded-2xl bg-white/70 p-3">
                  <p className="text-sm leading-snug text-slate-900">{q.text}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {q.why && <span className="text-[11px] text-slate-500">{q.why}</span>}
                    <button disabled={disabled} onClick={() => onAsk(q)} className="ml-auto shrink-0 rounded-full bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-40">Ask this →</button>
                  </div>
                </div>
              ))}
              {list && (
                <button onClick={() => load(true)} disabled={loading} className="w-full text-center text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50">
                  {loading ? "Writing…" : "↻ Different ideas"}
                </button>
              )}
            </div>
          )}

          {tab === "own" && (
            <div className="space-y-3 text-sm">
              <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (own.trim()) { onAskOwn(own.trim()); setOwn(""); } }}>
                <span className="px-1 text-xs text-slate-500">Your own question (GotCha prepares the AI answer to compare)</span>
                <div className="flex gap-2">
                  <input className="min-w-0 flex-1 rounded-full border border-white/70 bg-white/60 px-3 py-2 outline-none placeholder:text-slate-400" placeholder="Type a question…" value={own} onChange={(e) => setOwn(e.target.value)} />
                  <button className="rounded-full bg-slate-900 px-4 text-white">Ask</button>
                </div>
              </form>
              <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (claim.trim()) { onClaim(claim.trim()); setClaim(""); } }}>
                <span className="px-1 text-xs text-slate-500">Check a LinkedIn / resume claim against their GitHub</span>
                <div className="flex gap-2">
                  <input className="min-w-0 flex-1 rounded-full border border-white/70 bg-white/60 px-3 py-2 outline-none placeholder:text-slate-400" placeholder='e.g. "5 years of Kafka"' value={claim} onChange={(e) => setClaim(e.target.value)} />
                  <button className="rounded-full bg-slate-900 px-4 text-white">Check</button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
