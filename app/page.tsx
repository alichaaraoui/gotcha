// Setup screen. OWNER: Person 1
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TRACKS, useStore } from "@/lib/store";
import { ProfileCard } from "@/components/ProfileCard";
import { BriefCard } from "@/components/BriefCard";
import { Checklist } from "@/components/Checklist";
import { LinkedInButton } from "@/components/LinkedInButton";
import { IdentityCard, IdentityInputs, useIdentity } from "@/components/Identity";
import type { CandidateProfile, QuestionsResponse } from "@/lib/types";

export default function Setup() {
  const { session, track, history, setProfile, setTrack, addQuestions, update, reset } = useStore();
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [qSource, setQSource] = useState<string>();
  const p = session.profile;
  const identity = useIdentity(login, linkedin);

  async function lookup() {
    setLoading(true);
    setError("");
    reset();
    try {
      const t = TRACKS.find((x) => x.id === session.trackId) ?? TRACKS[0];
      const profile: CandidateProfile = await fetch("/api/profile", {
        method: "POST",
        body: JSON.stringify({ login: login || "demo-candidate", role: t.role, linkedinUrl: linkedin || undefined }),
      }).then((r) => r.json());
      setTrack(t.id);
      setProfile(profile);
      // Personalized GitHub questions + shadow answers (Groq or fallback)
      const q: QuestionsResponse = await fetch("/api/questions", { method: "POST", body: JSON.stringify({ profile, trackId: t.id }) }).then((r) => r.json());
      addQuestions(q.personalized);
      setQSource(`${q.personalized.length} question${q.personalized.length === 1 ? "" : "s"} written from their GitHub (${q.source === "groq" ? "AI" : "offline template"})`);
    } catch {
      setError("Couldn't load the profile. Check the dev server, or leave the username blank for the demo candidate.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-96px)] grid-cols-1 gap-5 lg:grid-cols-[1fr_440px]">
      <section className="stage flex flex-col gap-6 rounded-[32px] p-8">
        <div>
          <div className="label">Before the call</div>
          <h1 className="mt-1 text-4xl font-light tracking-tight">Who are you interviewing?</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">We read their public GitHub, write questions only the real author could answer, and prepare what an AI would say to each one.</p>
        </div>
        <div className="grid max-w-2xl gap-4">
          <label className="space-y-1.5">
            <span className="label">GitHub username</span>
            <input className="input" placeholder="octocat · leave blank for the demo candidate" value={login} onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookup()} />
          </label>
          <label className="space-y-1.5">
            <span className="label">LinkedIn URL (optional)</span>
            <input className="input" placeholder="https://www.linkedin.com/in/…" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
          </label>
          <IdentityInputs id={identity} linkedinUrl={linkedin} onDemo={(l, li) => { setLogin(l); setLinkedin(li ?? ""); }} />
          <div className="space-y-1.5">
            <span className="label">Line of questioning</span>
            <div className="flex flex-wrap gap-2">
              {TRACKS.map((t) => (
                <button key={t.id} onClick={() => setTrack(t.id)} className={`rounded-full px-4 py-2 text-sm transition ${session.trackId === t.id ? "bg-white text-black" : "border border-white/20 text-white/80 hover:bg-white/10"}`}>{t.name}</button>
              ))}
            </div>
          </div>
          <div>
            <button className="btn-primary px-6 py-3" onClick={lookup} disabled={loading}>{loading ? "Reading their GitHub…" : "Load candidate"}</button>
            {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
          </div>
        </div>
        <div className="mt-auto max-w-2xl [&_.card]:bg-black/20">
          <Checklist value={session.checklist} onChange={(c) => update((s) => ({ ...s, checklist: c }))} />
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        {p ? <ProfileCard p={p} /> : <div className="card text-sm text-white/50">The candidate&apos;s GitHub profile shows up here.</div>}
        {p && qSource && <p className="px-2 text-sm text-white/60">✓ {qSource}</p>}
        <IdentityCard id={identity} onPick={setLogin} />
        {p && <LinkedInButton url={p.linkedinUrl} githubLogin={p.source === "fallback" ? undefined : p.login} />}
        <BriefCard history={history} track={track} />
        {p && <button className="btn-primary mt-auto py-4 text-base" onClick={() => router.push("/live")}>Start interview →</button>}
      </aside>
    </div>
  );
}
