// Setup screen. OWNER: Person 1
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TRACKS, useStore } from "@/lib/store";
import { ProfileCard } from "@/components/ProfileCard";
import { BriefCard } from "@/components/BriefCard";
import { Checklist } from "@/components/Checklist";
import { LinkedInButton } from "@/components/LinkedInButton";
import type { CandidateProfile, QuestionsResponse } from "@/lib/types";

export default function Setup() {
  const { session, track, history, setProfile, setTrack, addQuestions, update, reset } = useStore();
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [loading, setLoading] = useState(false);
  const p = session.profile;

  async function lookup() {
    setLoading(true);
    reset();
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
    setLoading(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">New interview</h1>
        <div className="card space-y-3">
          <div>
            <div className="label mb-1">Candidate GitHub username</div>
            <input className="input" placeholder="octocat (blank = demo candidate)" value={login} onChange={(e) => setLogin(e.target.value)} />
          </div>
          <div>
            <div className="label mb-1">LinkedIn URL (optional)</div>
            <input className="input" placeholder="https://www.linkedin.com/in/…" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
          </div>
          <div>
            <div className="label mb-1">Line of questioning</div>
            <select className="input" value={session.trackId} onChange={(e) => setTrack(e.target.value)}>
              {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button className="btn-primary w-full" onClick={lookup} disabled={loading}>{loading ? "Loading profile…" : "Load candidate"}</button>
        </div>
        <Checklist value={session.checklist} onChange={(c) => update((s) => ({ ...s, checklist: c }))} />
      </div>
      <div className="space-y-4">
        {p && <ProfileCard p={p} />}
        {p && <LinkedInButton url={p.linkedinUrl} githubLogin={p.source === "fallback" ? undefined : p.login} />}
        <BriefCard history={history} track={track} />
        {p && <button className="btn-primary w-full py-3 text-base" onClick={() => router.push("/live")}>Start interview →</button>}
      </div>
    </div>
  );
}
