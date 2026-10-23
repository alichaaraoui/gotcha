// Switch track / Go deeper / Test further / Ask your own / manual flag.
// OWNER: Person 1
"use client";
import { useState } from "react";
import { TRACKS } from "@/lib/store";

export function LiveControls({ trackId, onSwitchTrack, onDeeper, onTestFurther, onAskOwn, onManualFlag, canDeeper }: {
  trackId: string; canDeeper: boolean;
  onSwitchTrack: (id: string) => void; onDeeper: () => void; onTestFurther: () => void;
  onAskOwn: (text: string) => void; onManualFlag: () => void;
}) {
  const [own, setOwn] = useState("");
  return (
    <div className="card space-y-3">
      <div className="label">Change the interview</div>
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={trackId} onChange={(e) => onSwitchTrack(e.target.value)}>
          {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn-ghost" onClick={onDeeper} disabled={!canDeeper}>Go deeper</button>
        <button className="btn-ghost border-flag/60 text-red-200" onClick={onTestFurther}>Test further</button>
        <button className="btn-ghost" onClick={onManualFlag} title="Hotkey: F">Flag moment (F)</button>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (own.trim()) { onAskOwn(own.trim()); setOwn(""); } }}>
        <input className="input" placeholder="Ask your own question…" value={own} onChange={(e) => setOwn(e.target.value)} />
        <button className="btn-primary">Add</button>
      </form>
    </div>
  );
}
