// OWNER: Person 1
import type { CandidateProfile } from "@/lib/types";

const BADGE = { live: "bg-clear/20 text-clear", cache: "bg-watch/20 text-watch", fallback: "bg-white/10 text-white/70" };

export function ProfileCard({ p }: { p: CandidateProfile }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-3">
        {p.avatarUrl && <img src={p.avatarUrl} alt="" className="h-10 w-10 rounded-full" />}
        <div>
          <div className="font-semibold">{p.name ?? p.login}</div>
          <div className="text-xs text-white/50">@{p.login} · {p.accountAgeYrs} yrs on GitHub · {p.commitsLast90d} commits / 90d</div>
        </div>
        <span className={`ml-auto rounded px-2 py-0.5 text-xs ${BADGE[p.source]}`}>GitHub: {p.source}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {p.topLanguages.map((l) => <span key={l.lang} className="rounded bg-white/10 px-2 py-1">{l.lang} {Math.round(l.pct * 100)}%</span>)}
      </div>
      <ul className="text-sm text-white/80">
        {p.repos.slice(0, 4).map((r) => <li key={r.name}>• <b>{r.name}</b> <span className="text-white/40">{r.description}</span></li>)}
      </ul>
      {p.marketDemand && (
        <div className="text-xs text-white/50">
          Market ({p.marketDemand.role}): {p.marketDemand.openings.toLocaleString()} openings · median ${p.marketDemand.medianSalaryUsd.toLocaleString()} · hot: {p.marketDemand.hotSkills.join(", ")}
        </div>
      )}
    </div>
  );
}
