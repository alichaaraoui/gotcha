// Sarah types a claim she read on LinkedIn → checked against GitHub → suggested question.
// OWNER: Person 1
"use client";
import { useState } from "react";
import type { CandidateProfile, PinnedClaim } from "@/lib/types";
import { unsupportedClaims } from "@/lib/scoring/signals";
import { words } from "@/lib/scoring/text";

export function PinClaim({ profile, claims, onAdd }: { profile: CandidateProfile | null; claims: PinnedClaim[]; onAdd: (c: PinnedClaim) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    const missing = unsupportedClaims(text, profile);
    const techMentioned = missing.length > 0 || words(text).some((w) => profile?.topLanguages.some((l) => l.lang.toLowerCase() === w));
    onAdd({
      text,
      supportedByGithub: techMentioned ? missing.length === 0 : null,
      suggestedQuestion: `Your profile says "${text}". Tell me about a specific problem you hit there and how you fixed it.`,
    });
    setText("");
  };
  return (
    <div className="card space-y-2">
      <div className="label">Pin a LinkedIn claim</div>
      <div className="flex gap-2">
        <input className="input" placeholder='e.g. "5 yrs Kafka at Stripe"' value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn-ghost" onClick={add}>Pin</button>
      </div>
      {claims.map((c, i) => (
        <div key={i} className="text-sm">
          <span className={c.supportedByGithub === false ? "text-warn" : c.supportedByGithub ? "text-clear" : "text-slate-300"}>
            {c.supportedByGithub === false ? "⚠ Not in GitHub" : c.supportedByGithub ? "✓ In GitHub" : "•"}
          </span>{" "}
          {c.text}
          <div className="text-xs text-slate-400">Ask: {c.suggestedQuestion}</div>
        </div>
      ))}
    </div>
  );
}
