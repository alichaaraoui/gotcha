// Generates data/past_interviews.json: 28 made-up past interviews (20 backend, 8 frontend) so the
// learning features have history on day one. Deterministic (seeded RNG).
// Run: npm run seed
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let s = 42;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// How often each method's flags turned out right on assisted vs organic interviews.
// Eye tracking and latency are noisier; own-code probes and known-AI matches are strong.
const methods = {
  eye_reading: 0.75, eye_offscreen: 0.55, eye_baseline: 0.7, latency: 0.7, pauses: 0.72,
  steady_rate: 0.6, ai_similarity: 0.85, llm_style: 0.8, github_mismatch: 0.78, easy_vs_hard: 0.82, manual: 0.65,
};
const backendQs = ["be-w1", "be-w2", "be-w3", "be-c1", "be-c2", "be-c3", "be-d1", "be-d2", "be-d3", "be-p1", "be-p2", "be-p3", "be-p4", "be-x1"];
// Probes that really separate people: assisted candidates score much higher on these.
const strongQs = new Set(["be-p1", "be-p4", "be-p3", "be-c3"]);

/** n interviews on one track. Each track has its own RNG stream so adding one never changes another. */
function generate({ trackId, n, seed, startDay, everyDays, qs, strong, idPrefix }) {
  s = seed;
  const out = [];
  for (let i = 0; i < n; i++) {
    const assisted = rnd() < 0.4;
    const date = new Date(Date.UTC(2026, 6, 1) + (startDay + i * everyDays) * 86400000).toISOString().slice(0, 10);
    const asked = qs.filter(() => rnd() < 0.7);
    const questionsAsked = asked.map((q) => {
      const base = assisted ? 45 + rnd() * 30 : 8 + rnd() * 18;
      const bump = strong.has(q) ? (assisted ? 22 : 3) : 0;
      return { questionId: q, risk: Math.min(99, Math.round(base + bump)) };
    });
    const flags = [];
    const nFlags = assisted ? 2 + Math.floor(rnd() * 3) : Math.floor(rnd() * 2);
    for (let f = 0; f < nFlags; f++) {
      const m = pick(Object.keys(methods));
      const right = rnd() < methods[m];
      flags.push({ method: m, verdict: right === assisted ? "suspicious" : "genuine" });
    }
    // Detection gets faster as the history grows (that's the learning story)
    const progress = (startDay + i * everyDays) / 80; // 0 → 1 over the seeded period
    const minutesToFirstFlag = assisted ? Math.round((14 - progress * 9 + rnd() * 2) * 10) / 10 : null;
    out.push({ id: `${idPrefix}${String(i + 1).padStart(2, "0")}`, date, trackId, outcome: assisted ? "suspicious" : "genuine", minutesToFirstFlag, questionsAsked, flags });
  }
  return out;
}

const backend = generate({ trackId: "backend-mid", n: 20, seed: 42, startDay: 0, everyDays: 4, qs: backendQs, strong: strongQs, idPrefix: "past-" });
const frontend = generate({
  trackId: "frontend-mid", n: 8, seed: 7, startDay: 2, everyDays: 10, idPrefix: "past-fe-",
  qs: ["fe-w1", "fe-w2", "fe-c1", "fe-c2", "fe-d1", "fe-d2", "fe-p1", "fe-p2", "fe-x1"],
  strong: new Set(["fe-p1", "fe-p2", "fe-d2"]),
});
// Chronological, so the time-to-first-flag trend reads left to right
const out = [...backend, ...frontend].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

writeFileSync(join(root, "data/past_interviews.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.length} past interviews`);
