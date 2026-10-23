// Runs both demo candidates through /api/score and prints the risk per answer.
// Target: organic stays < 20, assisted climbs to 75+. Needs `npm run dev` running.
// Usage: node scripts/score-demo.mjs [baseUrl]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] ?? "http://localhost:3000";
const tracks = JSON.parse(readFileSync(join(root, "data/tracks.json"), "utf8"));
const demo = JSON.parse(readFileSync(join(root, "data/demo_scripts.json"), "utf8"));
const known = JSON.parse(readFileSync(join(root, "data/known_ai_answers.json"), "utf8"));
const profile = JSON.parse(readFileSync(join(root, "data/fixtures/github_fallback.json"), "utf8"));
const questions = tracks[0].stages.flatMap((s) => s.questions);
const weights = { eye_reading: 1, eye_offscreen: 0.6, eye_baseline: 0.8, latency: 0.9, pauses: 0.9, steady_rate: 0.6, ai_similarity: 1.3, llm_style: 1.1, github_mismatch: 1, easy_vs_hard: 1, manual: 0.5 };
const checklist = { earpiece: false, glassesReflection: false, virtualBackground: false, idShown: true };

function event(qid, a) {
  const askedAt = 1_000_000;
  const ws = a.text.split(/\s+/);
  const gap = 60000 / a.wpm;
  // Organic speakers pause mid-thought: add a 900ms gap every ~12 words when the text has fillers
  const thinks = /\b(um|hmm|uh|okay|i guess)\b/i.test(a.text);
  let t = askedAt + a.delayMs;
  const words = ws.map((w, i) => ({ w, t: (t += gap + (thinks && i % 12 === 11 ? 900 : 0)) }));
  return { questionId: qid, transcript: a.text, words, askedAt, firstWordAt: words[0].t, endedAt: t + 300 };
}

for (const key of ["organic", "assisted"]) {
  const s = demo[key];
  let baseline = null;
  const warm = [];
  console.log(`\n${s.label}`);
  for (const [qid, a] of Object.entries(s.answers)) {
    const q = questions.find((x) => x.id === qid);
    const ev = event(qid, a);
    const body = { question: { ...q, text: q.text.replace("{repo}", profile.repos[0].name) }, event: ev, gaze: null, baseline, profile, checklist, weights, knownAi: known, easyVsHard: baseline ? { easyLatencyMs: baseline.latencyMs, easyWpm: baseline.wpm } : null };
    const r = await fetch(`${base}/api/score`, { method: "POST", body: JSON.stringify(body) }).then((x) => x.json());
    const top = [...r.signals].sort((x, y) => y.value - x.value).slice(0, 2).map((x) => `${x.method}=${x.value.toFixed(2)}`).join(" ");
    console.log(`  ${qid.padEnd(6)} ${String(r.risk).padStart(3)}%  ${r.level.padEnd(5)} firing=${r.methodsFiring}  ${top}`);
    if (q.stage === "warmup") {
      warm.push({ lat: ev.firstWordAt - ev.askedAt, wpm: ev.words.length / ((ev.endedAt - ev.firstWordAt) / 60000) });
      baseline = { latencyMs: warm.reduce((x, w) => x + w.lat, 0) / warm.length, wpm: warm.reduce((x, w) => x + w.wpm, 0) / warm.length, gaze: null };
    }
  }
}
