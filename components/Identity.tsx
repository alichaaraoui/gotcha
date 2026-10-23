// Identity check on Setup: pasted LinkedIn/resume + claims → does the profile hold together?
// LinkedIn stays view-only: the recruiter copies the text in. The tool suggests, the recruiter decides.
"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { openDocked } from "@/components/LinkedInButton";
import demo from "@/data/fixtures/identity_demo.json";
import type { CandidateStory, IdentityReport, IdentityRequest, IdentityStatus, Question } from "@/lib/types";

const KEY = "gotcha.identityInput";

export function useIdentity(login: string) {
  const { session, update, addQuestions } = useStore();
  const [input, setInputState] = useState<IdentityRequest>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const [loading, setLoading] = useState(false);
  const setInput = (patch: Partial<IdentityRequest>) =>
    setInputState((i) => {
      const next = { ...i, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  async function run(forLogin = login) {
    setLoading(true);
    try {
      const r: IdentityReport = await fetch("/api/identity", { method: "POST", body: JSON.stringify({ ...input, login: forLogin.trim() || undefined }) }).then((x) => x.json());
      update((s) => ({ ...s, identity: r }));
    } catch {
      // Leave the last report; the card says nothing ran
    } finally {
      setLoading(false);
    }
  }

  // Re-check whenever a candidate is loaded (blank username = the demo candidate)
  const last = useRef<string | null>(null);
  const profileLogin = session.profile?.login;
  useEffect(() => {
    if (!profileLogin || session.identity || last.current === `${session.id}`) return;
    last.current = `${session.id}`;
    run(login || profileLogin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLogin, session.id]);

  const sendQuestions = (texts: string[]) =>
    addQuestions(
      texts.map((text): Question => ({
        id: `idv-${hash(text)}`,
        text,
        kind: "custom",
        stage: "warmup",
        topic: "Identity",
        shadowAnswer: "",
        goodAnswerHint: "The real person answers right away with small specific details (names, places, a story). Vague or slow answers are worth one follow-up.",
        why: "Checks they are who the profile says",
      })),
    );

  return { input, setInput, run, loading, report: session.identity, sentIds: new Set(session.questions.map((q) => q.id)), sendQuestions };
}
type IdentityState = ReturnType<typeof useIdentity>;

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7).toString(36);

// ---------- Inputs (left column on Setup) ----------
// One paste box per LinkedIn section, so the recruiter can copy them one at a time.
const SECTIONS = [
  { key: "about", label: "About", hint: "Their LinkedIn About / summary" },
  { key: "experience", label: "Experience", hint: "Each job: title, company, dates (e.g. Jun 2025 – Aug 2025), what they did" },
  { key: "education", label: "Education", hint: "School, degree, years (e.g. 2023 – 2027)" },
  { key: "other", label: "Skills & other", hint: "Skills list, or paste a whole resume here" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];
type Sections = Record<SectionKey, string>;
const HEADER: Record<string, SectionKey> = { about: "about", summary: "about", experience: "experience", education: "education", skills: "other", resume: "other" };

/** Split pasted text with "About / Experience / Education / Skills" header lines into sections. */
export function splitSections(text: string): Sections {
  const out: Sections = { about: "", experience: "", education: "", other: "" };
  let cur: SectionKey = "other";
  text.split("\n").forEach((line) => {
    const h = HEADER[line.trim().toLowerCase()];
    if (h) cur = h;
    else out[cur] += `${line}\n`;
  });
  (Object.keys(out) as SectionKey[]).forEach((k) => (out[k] = out[k].trim()));
  return out;
}
const joinSections = (s: Sections) =>
  SECTIONS.filter((x) => s[x.key].trim()).map((x) => `${x.key === "other" ? "Skills" : x.label}\n${s[x.key]}`).join("\n\n");

export function IdentityInputs({ id, onDemo }: { id: IdentityState; onDemo: (login: string) => void }) {
  const { input, setInput } = id;
  const [open, setOpen] = useState(false); // closed until the recruiter opens it
  const [tab, setTab] = useState<SectionKey>("about");
  // Raw text per box (not re-split on every keystroke, so Enter and spaces stay put)
  const [sections, setSections] = useState<Sections>(() => splitSections(input.pastedText ?? ""));
  const setAll = (next: Sections) => {
    setSections(next);
    setInput({ pastedText: joinSections(next) });
  };
  const setSection = (k: SectionKey, v: string) => setAll({ ...sections, [k]: v });
  const filled = SECTIONS.filter((x) => sections[x.key].trim()).length;
  const current = SECTIONS.find((x) => x.key === tab)!;

  const fill = (d: { input: IdentityRequest; github: { login: string } }) => {
    setInput({ ...d.input, login: undefined });
    setSections(splitSections(d.input.pastedText ?? ""));
    onDemo(d.github.login);
    setOpen(true);
    setTab("about");
  };
  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setSection(tab, sections[tab] ? `${sections[tab]}\n${t}` : t);
    } catch {
      // Clipboard blocked: Cmd+V into the box still works
    }
  }
  const clear = () => {
    setSections(splitSections(""));
    setInput({ pastedText: "", fullName: "", email: "", claimedLocation: "", claimedSchool: "", gradYear: undefined });
  };

  return (
    <div className={`overflow-hidden rounded-3xl border transition ${open ? "border-white/20 bg-black/20" : "border-white/10 bg-black/15 hover:border-white/25 hover:bg-black/25"}`}>
      <button className="flex w-full items-center gap-4 p-5 text-left" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="identity-panel">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="label">Identity check</span>
            <span className="chip py-0.5 text-[10px]">Optional</span>
          </div>
          <div className="mt-1 text-sm text-white/60">
            {filled ? `${filled} of 4 LinkedIn sections pasted${input.fullName ? ` for ${input.fullName}` : ""}` : "Paste their LinkedIn or resume to check it against GitHub, or find their GitHub by name."}
          </div>
        </div>
        <span className="hidden text-xs text-white/50 sm:inline">{open ? "Hide" : "Open"}</span>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/20 text-white/80 transition-transform duration-200 ${open ? "rotate-180 bg-white/10" : ""}`} aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </span>
      </button>

      {open && (
        <div id="identity-panel" className="space-y-4 border-t border-white/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-white/60">Copy what you see on their LinkedIn or resume. We compare it with their GitHub.</p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/40">Or load a sample:</span>
              <button className="chip hover:bg-white/15" onClick={() => fill(demo.clean)}>{demo.clean.label}</button>
              <button className="chip hover:bg-white/15" onClick={() => fill(demo.suspicious)}>{demo.suspicious.label}</button>
            </div>
          </div>
          <div>
            <div className="flex flex-wrap gap-1.5" role="tablist">
              {SECTIONS.map((x) => (
                <button
                  key={x.key}
                  role="tab"
                  aria-selected={tab === x.key}
                  onClick={() => setTab(x.key)}
                  className={`rounded-full px-3.5 py-1.5 text-sm transition ${tab === x.key ? "bg-white text-black" : "border border-white/15 text-white/75 hover:bg-white/10"}`}
                >
                  {sections[x.key].trim() && <span className={tab === x.key ? "text-clear" : "text-clear/90"}>✓ </span>}
                  {x.label}
                </button>
              ))}
            </div>
            <div className="mt-2.5">
              <textarea
                className="block min-h-[200px] w-full resize-y rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm leading-relaxed text-white outline-none placeholder:text-white/35 focus:border-white/50"
                value={sections[tab]}
                onChange={(e) => setSection(tab, e.target.value)}
                placeholder={`${current.hint}\n\nCopy it from LinkedIn and paste here (Cmd+V). LinkedIn stays view-only; we never scrape it.`}
                aria-label={`${current.label} text`}
              />
              <div className="mt-1.5 flex items-center justify-between px-1">
                <span className="text-[11px] text-white/35">{sections[tab] ? `${sections[tab].trim().split(/\s+/).length} words` : ""}</span>
                <div className="flex gap-1.5">
                  {sections[tab] && <button className="chip hover:bg-white/15" onClick={() => setSection(tab, "")}>Clear</button>}
                  <button className="chip hover:bg-white/15" onClick={paste}>Paste</button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Field className="md:col-span-3" label="Full name" placeholder="Ethan Brooks" value={input.fullName} onChange={(v) => setInput({ fullName: v })} />
            <Field className="md:col-span-3" label="Email" placeholder="name@school.edu" value={input.email} onChange={(v) => setInput({ email: v })} />
            <Field className="md:col-span-2" label="Says they live in" placeholder="Raleigh, NC" value={input.claimedLocation} onChange={(v) => setInput({ claimedLocation: v })} />
            <Field className="md:col-span-3" label="Says they study at" placeholder="NC State" value={input.claimedSchool} onChange={(v) => setInput({ claimedSchool: v })} />
            <Field label="Grad year" placeholder="2027" value={input.gradYear ? String(input.gradYear) : ""} onChange={(v) => setInput({ gradYear: +v.replace(/\D/g, "").slice(0, 4) || undefined })} numeric />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-ghost px-5" onClick={() => id.run()} disabled={id.loading || (!filled && !input.fullName && !input.email)}>
              {id.loading ? "Checking…" : "Check identity"}
            </button>
            <span className="text-xs text-white/45">No GitHub username above? We&apos;ll search GitHub by name and email for you to confirm.</span>
            {(filled > 0 || input.fullName) && <button className="ml-auto text-xs text-white/40 hover:text-white/70" onClick={clear}>Clear all</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, className = "", numeric }: { label: string; value?: string; onChange: (v: string) => void; placeholder: string; className?: string; numeric?: boolean }) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="block px-1 text-xs text-white/50">{label}</span>
      <input className="input" placeholder={placeholder} value={value ?? ""} inputMode={numeric ? "numeric" : undefined} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ---------- Candidate story: narrative + merged timeline ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d: string) => (d === "now" ? "Now" : d.length > 4 ? `${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : d);

function StoryView({ story }: { story: CandidateStory }) {
  return (
    <div className="space-y-3">
      <div className="label">Candidate story</div>
      <p className="text-sm leading-relaxed text-white/85">{story.summary}</p>
      <ol className="relative ml-1.5 space-y-2.5 border-l border-white/15 pl-4">
        {story.timeline.map((e, i) => (
          <li key={i} className="relative text-sm">
            <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${e.flag ? (e.flag.status === "risk" ? "bg-flag" : "bg-watch") : e.source === "github" ? "bg-white/70" : "bg-white/30 ring-1 ring-white/50"}`} />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-16 shrink-0 text-xs text-white/45">{fmtDate(e.date)}</span>
              <span className="min-w-0 flex-1 text-white/85">{e.label}</span>
              <span className="text-[10px] uppercase tracking-wider text-white/35">{e.source === "github" ? "GitHub" : "Claimed"}</span>
            </div>
            {e.flag && (
              <div className={`mt-0.5 pl-[72px] text-xs ${e.flag.status === "risk" ? "text-flag" : "text-watch"}`}>
                {e.flag.status === "risk" ? "✕" : "⚠"} {e.flag.why}
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-white/35">Filled dots: GitHub evidence · hollow: what they claim. Story {story.summarySource === "groq" ? "written by AI from these facts" : "strung from the facts"}.</p>
    </div>
  );
}

// ---------- Card (right column on Setup, beside the profile card) ----------
const ICON: Record<IdentityStatus, { mark: string; cls: string }> = {
  ok: { mark: "✓", cls: "text-clear" },
  warn: { mark: "⚠", cls: "text-watch" },
  risk: { mark: "✕", cls: "text-flag" },
  unknown: { mark: "?", cls: "text-white/40" },
};
const HEAD: Record<IdentityReport["level"], string> = { consistent: "bg-clear", mixed: "bg-watch", inconsistent: "bg-flag" };

export function IdentityCard({ id, onPick }: { id: IdentityState; onPick: (login: string) => void }) {
  const r = id.report;
  if (!r) return id.loading ? <div className="card text-sm text-white/50">Checking their identity…</div> : null;
  const unsent = r.questions.filter((q) => !id.sentIds.has(`idv-${hash(q)}`));
  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${HEAD[r.level]}`} />
        <div className="min-w-0 flex-1">
          <div className="label">Identity check</div>
          <div className="text-lg font-normal">{r.headline}</div>
        </div>
        <span className="chip shrink-0" title="Higher = more things that don't line up">Risk {r.score}/100</span>
      </div>

      {r.story && <StoryView story={r.story} />}

      <div className="label">Checks</div>
      <ul className="space-y-2 text-sm">
        {r.checks.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <span className={`w-4 shrink-0 text-center font-medium ${ICON[c.status].cls}`}>{ICON[c.status].mark}</span>
            <div>
              <div className="text-white/90">{c.label}</div>
              <div className="text-xs leading-relaxed text-white/55">{c.why}</div>
            </div>
          </li>
        ))}
      </ul>

      {r.matches && (
        <div className="space-y-2">
          <div className="label">Possible GitHub matches · confirm before using</div>
          {r.matches.length === 0 && <p className="text-xs text-white/50">No likely accounts found by email or name. Use the questions below to verify.</p>}
          {r.matches.map((m) => (
            <div key={m.login} className="flex items-center gap-2 rounded-2xl bg-white/[0.05] p-2 text-xs">
              {m.avatarUrl && <img src={m.avatarUrl} alt="" className="h-7 w-7 rounded-full" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">@{m.login} {m.name && <span className="text-white/50">· {m.name}</span>}</div>
                <div className="truncate text-white/45">{[m.location, m.createdAt && `since ${m.createdAt.slice(0, 4)}`, m.why].filter(Boolean).join(" · ")}</div>
              </div>
              <button className="chip hover:bg-white/15" onClick={() => openDocked(m.url)}>Open ↗</button>
              <button className="chip hover:bg-white/15" onClick={() => onPick(m.login)}>It&apos;s them</button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="label">Questions to verify identity</div>
          <button className="chip hover:bg-white/15 disabled:opacity-40" disabled={!unsent.length} onClick={() => id.sendQuestions(unsent)}>{unsent.length ? "Add all to interview" : "Added ✓"}</button>
        </div>
        <ol className="space-y-1.5 text-sm text-white/80">
          {r.questions.map((q) => {
            const sent = id.sentIds.has(`idv-${hash(q)}`);
            return (
              <li key={q} className="flex gap-2">
                <button className={`shrink-0 text-xs ${sent ? "text-clear" : "text-white/50 hover:text-white"}`} disabled={sent} onClick={() => id.sendQuestions([q])} title="Add to interview">{sent ? "✓" : "+"}</button>
                <span>{q}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="text-[11px] text-white/35">GitHub: {r.githubSource} · wording: {r.textSource === "groq" ? "AI read" : r.textSource}. Suggestions only; you decide.</p>
    </div>
  );
}
