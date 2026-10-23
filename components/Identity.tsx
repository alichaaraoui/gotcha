// Identity check on Setup: pasted LinkedIn/resume + claims → does the profile hold together?
// LinkedIn stays view-only: the recruiter copies the text in. The tool suggests, the recruiter decides.
"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { openDocked } from "@/components/LinkedInButton";
import demo from "@/data/fixtures/identity_demo.json";
import type { IdentityReport, IdentityRequest, IdentityStatus, Question } from "@/lib/types";

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
export function IdentityInputs({ id, onDemo }: { id: IdentityState; onDemo: (login: string) => void }) {
  const { input, setInput } = id;
  const [open, setOpen] = useState(!!input.pastedText);
  const fill = (d: { input: IdentityRequest; github: { login: string } }) => {
    setInput({ ...d.input, login: undefined });
    onDemo(d.github.login);
    setOpen(true);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="label hover:text-white/80" onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} Identity details (optional)</button>
        <span className="text-xs text-white/40">Demo:</span>
        <button className="chip hover:bg-white/15" onClick={() => fill(demo.clean)}>{demo.clean.label}</button>
        <button className="chip hover:bg-white/15" onClick={() => fill(demo.suspicious)}>{demo.suspicious.label}</button>
      </div>
      {open && (
        <div className="grid gap-3">
          <label className="space-y-1.5">
            <span className="text-xs text-white/50">Paste their LinkedIn About + Experience + Education, and/or resume (copy it by hand; we never scrape LinkedIn)</span>
            <textarea className="input min-h-[120px] rounded-2xl" value={input.pastedText ?? ""} onChange={(e) => setInput({ pastedText: e.target.value })} placeholder="About… Experience… Education…" />
          </label>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <input className="input" placeholder="Full name" value={input.fullName ?? ""} onChange={(e) => setInput({ fullName: e.target.value })} />
            <input className="input" placeholder="Email" value={input.email ?? ""} onChange={(e) => setInput({ email: e.target.value })} />
            <input className="input" placeholder="Claimed location (Raleigh, NC)" value={input.claimedLocation ?? ""} onChange={(e) => setInput({ claimedLocation: e.target.value })} />
            <input className="input" placeholder="Claimed school" value={input.claimedSchool ?? ""} onChange={(e) => setInput({ claimedSchool: e.target.value })} />
            <input className="input" placeholder="Grad year" inputMode="numeric" value={input.gradYear ?? ""} onChange={(e) => setInput({ gradYear: +e.target.value.replace(/\D/g, "") || undefined })} />
            <button className="btn-ghost" onClick={() => id.run()} disabled={id.loading}>{id.loading ? "Checking…" : "Check identity"}</button>
          </div>
        </div>
      )}
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
        <span className="chip shrink-0">{r.score}/100</span>
      </div>

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
