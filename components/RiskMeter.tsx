// OWNER: Person 1
import type { Level } from "@/lib/types";
import { LEVEL_STYLE } from "./ui";

export function RiskMeter({ risk, level }: { risk: number; level: Level }) {
  const s = LEVEL_STYLE[level];
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="label">Authenticity risk</span>
        <span className={`flex items-center gap-2 text-sm font-semibold ${s.text}`}>
          <span className={`h-3 w-3 rounded-full ${s.dot}`} /> {s.label}
        </span>
      </div>
      <div className="mt-3 text-4xl font-bold tabular-nums">{risk}%</div>
      <div className="relative mt-3 h-2 rounded-full bg-slate-800">
        <div className={`h-2 rounded-full ${s.dot} transition-all`} style={{ width: `${risk}%` }} />
        {[20, 50, 75].map((m) => (
          <div key={m} className="absolute -top-1 h-4 w-px bg-slate-400" style={{ left: `${m}%` }}>
            <span className="absolute top-4 -translate-x-1/2 text-[10px] text-slate-400">{m}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
