// Library: the recruiter's own Gotcha Bank (her private Google Doc, digitized)
// + research: interview questions answered by several AI models, used by live scoring.
// OWNER: Person 1
"use client";
import { useMemo, useState } from "react";
import { AI_LIBRARY, useStore } from "@/lib/store";
import { overlapIndexes, similarity } from "@/lib/scoring/text";
import type { Gotcha } from "@/lib/types";

const STYLES: { id: Gotcha["style"]; label: string; tip: string }[] = [
  { id: "curveball", label: "Curveball", tip: "An unexpected angle on what they just said" },
  { id: "constraint-change", label: "Change the rules", tip: "Same problem, new constraint. Relays lag." },
  { id: "knowledge-boundary", label: "Knowledge check", tip: "Asks about something that doesn't exist" },
  { id: "own-code", label: "Their own work", tip: "Only the real author knows" },
  { id: "other", label: "Other", tip: "" },
];
const MODEL_TINT: Record<string, string> = { "GPT-OSS 20B": "bg-[#d8d2f6]", "GPT-OSS 120B": "bg-[#e8c4e2]", "Qwen 3": "bg-[#f4ca8e]" };

export default function Library() {
  const [tab, setTab] = useState<"bank" | "research">("bank");
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      <section className="stage rounded-[32px] p-8">
        <div className="label">Library</div>
        <h1 className="mt-1 text-4xl font-light">Questions that knock candidates off script</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/60">
          Your own gotcha questions, plus a research set of interview questions answered by several AI models. GotCha compares every live answer against all of them.
        </p>
        <div className="mt-6 flex w-fit gap-1 rounded-full border border-white/15 p-1 text-sm">
          {([["bank", "My Gotcha Bank"], ["research", "AI answer research"]] as const).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 ${tab === t ? "bg-white text-black" : "text-white/70"}`}>{l}</button>
          ))}
        </div>
      </section>
      {tab === "bank" ? <Bank /> : <Research />}
    </div>
  );
}

function Bank() {
  const { gotchas, saveGotcha, removeGotcha, importGotchas } = useStore();
  const blank = { text: "", topic: "", style: "curveball" as Gotcha["style"], realAnswer: "" };
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState<string>();
  const [filter, setFilter] = useState<Gotcha["style"] | "all">("all");

  const submit = () => {
    if (!draft.text.trim()) return;
    saveGotcha({ id: editing ?? `g-${Date.now()}`, createdAt: Date.now(), ...draft, topic: draft.topic || "Any", text: draft.text.trim() });
    setDraft(blank);
    setEditing(null);
  };

  const shown = gotchas.filter((g) => filter === "all" || g.style === filter);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-sm text-white/50">{gotchas.length} questions</span>
          {[{ id: "all" as const, label: "All" }, ...STYLES].map((s) => (
            <button key={s.id} onClick={() => setFilter(s.id)} className={`rounded-full px-3 py-1 text-xs ${filter === s.id ? "bg-white text-black" : "border border-white/15 text-white/70 hover:bg-white/10"}`}>{s.label}</button>
          ))}
        </div>
        {shown.map((g) => (
          <div key={g.id} className="card group">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-snug">{g.text}</p>
                {g.realAnswer && <p className="mt-2 text-sm text-white/50"><span className="text-white/70">A real answer:</span> {g.realAnswer}</p>}
                <div className="mt-3 flex gap-2">
                  <span className="chip">{STYLES.find((s) => s.id === g.style)?.label}</span>
                  <span className="chip">{g.topic}</span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1 opacity-60 transition group-hover:opacity-100">
                <button className="btn-ghost px-3 py-1 text-xs" onClick={() => { setEditing(g.id); setDraft({ text: g.text, topic: g.topic, style: g.style, realAnswer: g.realAnswer }); }}>Edit</button>
                <button className="btn-ghost px-3 py-1 text-xs" onClick={() => removeGotcha(g.id)}>Delete</button>
              </div>
            </div>
          </div>
        ))}
        {!shown.length && <div className="card text-sm text-white/50">Nothing here yet.</div>}
      </section>

      <aside className="space-y-4">
        <div className="assistant space-y-3 rounded-[28px] p-5 text-slate-800">
          <div className="text-[15px]">{editing ? "Edit question" : "Add a gotcha"}</div>
          <textarea className="h-24 w-full resize-none rounded-2xl border border-white/70 bg-white/70 p-3 text-sm outline-none placeholder:text-slate-400" placeholder="e.g. Walk me through that again, but start from the part that failed." value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <div className="flex flex-wrap gap-1.5">
            {STYLES.map((s) => (
              <button key={s.id} title={s.tip} onClick={() => setDraft({ ...draft, style: s.id })} className={`rounded-full px-2.5 py-1 text-xs ${draft.style === s.id ? "bg-slate-900 text-white" : "border border-white/70 bg-white/50"}`}>{s.label}</button>
            ))}
          </div>
          <input className="w-full rounded-full border border-white/70 bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-slate-400" placeholder="Topic (e.g. Backend, Any)" value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
          <input className="w-full rounded-full border border-white/70 bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-slate-400" placeholder="What a real answer sounds like (optional)" value={draft.realAnswer} onChange={(e) => setDraft({ ...draft, realAnswer: e.target.value })} />
          <div className="flex gap-2">
            <button onClick={submit} className="flex-1 rounded-full bg-slate-900 py-2.5 text-sm text-white">{editing ? "Save changes" : "Add to my bank"}</button>
            {editing && <button onClick={() => { setEditing(null); setDraft(blank); }} className="rounded-full border border-slate-300 px-4 text-sm">Cancel</button>}
          </div>
        </div>

        <div className="card space-y-3">
          <div>
            <div className="text-[15px]">Import from your Google Doc</div>
            <p className="text-xs text-white/50">Copy your questions from the Doc and paste them here, one per line. Bullets and numbers are cleaned up; duplicates are skipped.</p>
          </div>
          <textarea className="h-32 w-full resize-none rounded-2xl border border-white/15 bg-white/[0.06] p-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/50" placeholder={"• Explain your last answer to a 10-year-old\n• What would you never do again in that project?"} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button className="btn-primary w-full" onClick={() => { const n = importGotchas(paste); setNote(`Added ${n} question${n === 1 ? "" : "s"}`); setPaste(""); }}>Import</button>
          {note && <p className="text-center text-xs text-white/60">{note}</p>}
        </div>
        <p className="px-2 text-xs text-white/40">Saved in this browser only. Your bank stays private to you.</p>
      </aside>
    </div>
  );
}

function Research() {
  const entries = useMemo(() => Object.entries(AI_LIBRARY), []);
  const topics = useMemo(() => ["All", ...Array.from(new Set(entries.map(([, e]) => e.topic)))], [entries]);
  const models = useMemo(() => Array.from(new Set(entries.flatMap(([, e]) => e.answers.map((a) => a.model)))), [entries]);
  const total = entries.reduce((a, [, e]) => a + e.answers.length, 0);
  const [topic, setTopic] = useState("All");
  const [q, setQ] = useState("");
  const [tryText, setTryText] = useState<Record<string, string>>({});

  const shown = entries.filter(([, e]) => (topic === "All" || e.topic === topic) && e.question.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="card"><div className="text-3xl font-light">{entries.length}</div><div className="text-sm text-white/60">interview questions</div></div>
        <div className="card"><div className="text-3xl font-light">{total}</div><div className="text-sm text-white/60">AI-written answers</div></div>
        <div className="card"><div className="text-3xl font-light">{models.length}</div><div className="text-sm text-white/60">models: {models.join(", ")}</div></div>
      </div>
      <p className="px-1 text-sm text-white/50">
        Candidates using AI copilots read answers like these. During the interview, GotCha checks each answer against every model here and names the closest match. Try it: paste a candidate&apos;s answer under any question.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search questions…" value={q} onChange={(e) => setQ(e.target.value)} />
        {topics.map((t) => (
          <button key={t} onClick={() => setTopic(t)} className={`rounded-full px-3 py-1 text-xs ${topic === t ? "bg-white text-black" : "border border-white/15 text-white/70 hover:bg-white/10"}`}>{t}</button>
        ))}
      </div>
      {shown.map(([id, e]) => {
        const t = tryText[id] ?? "";
        const scored = t.trim().length > 20 ? e.answers.map((a) => ({ model: a.model, sim: similarity(t, a.text) })).sort((x, y) => y.sim - x.sim) : [];
        return (
          <details key={id} className="card group">
            <summary className="flex cursor-pointer list-none items-center gap-3">
              <span className="chip shrink-0">{e.topic}</span>
              <span className="flex-1 text-[15px]">{e.question}</span>
              <span className="text-xs text-white/40">{e.answers.length} AI answers</span>
              <span className="text-white/40 transition group-open:rotate-90">›</span>
            </summary>
            <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
              <div className="grid gap-3 md:grid-cols-3">
                {e.answers.map((a) => (
                  <div key={a.model} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] text-slate-900 ${MODEL_TINT[a.model] ?? "bg-white"}`}>{a.model}</span>
                    <p className="mt-2 text-sm leading-relaxed text-white/75">
                      {t.trim().length > 20
                        ? a.text.split(/\s+/).map((w, k) => <span key={k} className={overlapIndexes(a.text, t).has(k) ? "rounded bg-[#f4ca8e]/30 text-[#ffe2b8]" : ""}>{w} </span>)
                        : a.text}
                    </p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <textarea className="h-20 w-full resize-none rounded-2xl border border-white/15 bg-white/[0.06] p-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/50" placeholder="Paste a candidate's answer to see which AI it sounds like…" value={t} onChange={(ev) => setTryText({ ...tryText, [id]: ev.target.value })} />
                {scored.length > 0 && (
                  <p className="text-sm text-white/70">
                    Closest: <b className="font-medium text-white">{scored[0].model}</b> at {Math.round(scored[0].sim * 100)}% overlap
                    {scored[0].sim > 0.35 ? " · sounds AI-written" : scored[0].sim > 0.2 ? " · some overlap" : " · sounds like their own words"}
                  </p>
                )}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
