// Generates data/past_interviews.json: 20 made-up past interviews so the
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

const out = [];
for (let i = 0; i < 20; i++) {
  const assisted = rnd() < 0.4;
  const date = new Date(Date.UTC(2026, 6, 1) + i * 4 * 86400000).toISOString().slice(0, 10);
  const asked = backendQs.filter(() => rnd() < 0.7);
  const questionsAsked = asked.map((q) => {
    const base = assisted ? 45 + rnd() * 30 : 8 + rnd() * 18;
    const bump = strongQs.has(q) ? (assisted ? 22 : 3) : 0;
    return { questionId: q, risk: Math.min(99, Math.round(base + bump)) };
  });
  // Assisted interviews: several flags, mostly confirmed (how often depends on the check).
  // Genuine interviews: flags are rare (the 2-check rule), and recruiters clear them.
  const flags = [];
  const nFlags = assisted ? 2 + Math.floor(rnd() * 3) : rnd() < 0.15 ? 1 : 0;
  for (let f = 0; f < nFlags; f++) {
    const m = pick(Object.keys(methods));
    flags.push({ method: m, verdict: assisted && rnd() < 0.75 + methods[m] * 0.25 ? "suspicious" : "genuine" });
  }
  // Detection gets faster as the history grows (that's the learning story)
  const minutesToFirstFlag = assisted ? Math.round((14 - i * 0.45 + rnd() * 2) * 10) / 10 : null;
  out.push({
    id: `past-${String(i + 1).padStart(2, "0")}`,
    date,
    trackId: "backend-mid",
    outcome: assisted ? "suspicious" : "genuine",
    minutesToFirstFlag,
    questionsAsked,
    flags,
  });
}

writeFileSync(join(root, "data/past_interviews.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.length} past interviews`);
