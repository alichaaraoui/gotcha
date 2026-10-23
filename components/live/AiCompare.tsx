// Candidate's words vs. what an AI would say, shared phrases highlighted.
// With several AI answers (Questions tab), shows each model's match and opens on the closest one.
// OWNER: Person 1 (multi-answer view: Person 2)
"use client";
import { useState } from "react";
import { overlapIndexes, similarity } from "@/lib/scoring/text";

export function AiCompare({ transcript, shadow, shadows, title, emphasize }: { transcript: string; shadow: string; shadows?: { model: string; text: string }[]; title: string; emphasize: boolean }) {
  const all = shadows?.length ? shadows : [{ model: "AI", text: shadow }];
  const sims = all.map((s) => (transcript ? similarity(transcript, s.text) : 0));
  const closest = sims.indexOf(Math.max(...sims));
  const [picked, setPicked] = useState<number>();
  const i = picked != null && picked < all.length ? picked : closest;
  const shown = all[i] ?? all[0];
  const hits = overlapIndexes(transcript, shown.text);
  const pct = Math.round((sims[i] ?? 0) * 100);
  return (
    <div className="grid min-h-0 flex-1 grid-rows-2 gap-3">
      <div className={`min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-black/20 p-4 ${emphasize ? "ring-1 ring-watch/50" : ""}`}>
        <div className="label mb-2 truncate">{title}</div>
        <p className="text-[15px] leading-relaxed">
          {transcript
            ? transcript.split(/\s+/).map((w, k) => (
                <span key={k} className={hits.has(k) ? "rounded bg-[#f4ca8e]/30 text-[#ffe2b8]" : "text-white/90"}>{w} </span>
              ))
            : <span className="text-white/35">Their answer appears here as they speak…</span>}
        </p>
      </div>
      <div className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.06] p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="label">{all.length > 1 ? `What ${all.length} AI models would say` : "What an AI would say"}</span>
          <span className={`chip ${pct >= 40 ? "border-[#f4ca8e]/50 text-[#ffe2b8]" : ""}`}>{pct}% match</span>
        </div>
        {all.length > 1 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {all.map((s, k) => (
              <button key={k} onClick={() => setPicked(k)} className={`chip ${k === i ? "border-white/60 bg-white/20 text-white" : "hover:bg-white/15"}`}>
                {s.model}{transcript ? ` · ${Math.round(sims[k] * 100)}%` : ""}{transcript && k === closest ? " · closest" : ""}
              </button>
            ))}
          </div>
        )}
        <p className="text-sm leading-relaxed text-white/55">{shown.text}</p>
      </div>
    </div>
  );
}
