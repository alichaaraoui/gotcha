// What the tool thinks, in one sentence. If it switched the question, say why and offer the way back.
// "Why?" reveals the detailed reasons only if the recruiter wants them.
// OWNER: Person 1
"use client";
import { useState } from "react";
import type { Question, Score } from "@/lib/types";
import { METHOD_LABEL } from "@/components/ui";

const CALM: Record<string, string> = {
  clear: "That answer sounded like them. Carry on with the plan.",
  watch: "Slightly unusual, but nothing to act on yet. Carry on and listen closely.",
};

export function Suggestion({ score, switched, onBack }: { score?: Score; switched?: { question: Question; why: string }; onBack: () => void }) {
  const [why, setWhy] = useState(false);
  const reasons = score ? [...score.signals].sort((a, b) => b.value - a.value).filter((s) => s.value >= 0.4).slice(0, 3) : [];

  return (
    <div className="rounded-[28px] bg-white p-5 text-slate-900 shadow-[0_20px_60px_-25px_rgba(80,40,90,0.5)]">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">What GotCha thinks</div>
      <p className="mt-2 text-[16px] leading-snug">
        {switched ? switched.why : score ? CALM[score.level] ?? "Keep going with the next question." : "Ask the first question. Easy warm-ups teach it how this person normally talks."}
      </p>
      {switched && (
        <button onClick={onBack} className="mt-3 w-full rounded-full border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50">I disagree · back to the plan</button>
      )}
      {score && (
        <div className="mt-3">
          <button onClick={() => setWhy((w) => !w)} className="text-xs text-slate-500 underline-offset-2 hover:underline">{why ? "Hide why" : "Why?"}</button>
          {why && (
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {score.knownAiMatch && <li>• Matches an AI answer seen in a past interview</li>}
              {reasons.length ? reasons.map((r, i) => <li key={i}>• <b className="font-medium">{METHOD_LABEL[r.method]}:</b> {r.why}</li>) : <li>• Nothing unusual in this answer</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
