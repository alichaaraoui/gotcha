// Runs both demo candidates (data/demo_scripts.json) through the real scorer and prints risk per answer.
// Target: "organic" stays < 20 on every answer; "assisted" climbs through 20 → 50 → 75.
// Offline: imports lib/scoring directly (no dev server, no Groq). Exit code 1 if the target is missed.
//
// Usage: node scripts/score-demo.mjs [--runs 50] [--verbose] [--gaze] [--url http://localhost:3000]
//   --runs     replay jitters word timing randomly (like lib/speech.ts); score that many runs per candidate
//   --gaze     add calm/reading gaze windows, to check the webcam path doesn't move the result
//   --stt      simulate live Chrome mic instead of replay: lowercase/no punctuation, words in bursts, +400ms lag
//   --url      score through a running /api/score instead (exercises Groq if GROQ_API_KEY is set)
//   --pace ms  with --url: wait between answers (free Groq tier: ~1000 output tokens/min, try 7000)
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.removeAllListeners("warning"); // hide Node's "type stripping is experimental" notice
register(pathToFileURL(join(root, "scripts/ts-hooks.mjs")).href);

const { scoreAnswer } = await import("@/lib/scoring/score");
const { latencyMs, wpm } = await import("@/lib/scoring/signals");
const { learnWeights } = await import("@/lib/learning");
const { personalizeTrack } = await import("@/lib/questions");
const { THRESHOLDS } = await import("@/lib/scoring/fuse");

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1] ?? true; };
const RUNS = Number(arg("--runs", 30));
const VERBOSE = process.argv.includes("--verbose");
const GAZE = process.argv.includes("--gaze");
const STT = process.argv.includes("--stt");
const URL = arg("--url", null);
const PACE = Number(arg("--pace", 0));

const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const tracks = json("data/tracks.json");
const demo = json("data/demo_scripts.json");
const known = json("data/known_ai_answers.json");
const profile = json("data/fixtures/github_fallback.json");
const weights = learnWeights(json("data/past_interviews.json")); // the weights the app actually uses
const track = tracks[0];
// Same questions the app asks: track + /api/questions' personalized {repo} probes (offline version)
const personal = new Map(personalizeTrack(track, profile).map((q) => [q.id, q]));
const questions = track.stages.flatMap((s) => s.questions).map((q) => personal.get(q.id) ?? q);
const checklist = { earpiece: false, glassesReflection: false, virtualBackground: false, idShown: true };

// Seeded RNG so runs are reproducible
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** Mirrors useSpeech().replay: first word after delayMs, then words at wpm with ±15% jitter, no pauses. */
function replayEvent(qid, a) {
  const askedAt = 1_000_000;
  const gap = 60000 / a.wpm;
  let t = askedAt + a.delayMs;
  const words = a.text.split(/\s+/).map((w) => { const s = { w, t }; t += gap * (0.85 + rnd() * 0.3); return s; });
  if (!STT) return { questionId: qid, transcript: a.text, words, askedAt, firstWordAt: words[0].t, endedAt: t };
  // Chrome: interim results land every ~300ms carrying 1–3 words with the same timestamp, ~400ms late
  const transcript = a.text.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").replace(/\s+/g, " ").trim();
  const ws = transcript.split(" ");
  const burst = [];
  for (let i = 0; i < ws.length; ) {
    const k = 1 + Math.floor(rnd() * 3), at = words[Math.min(i + k - 1, words.length - 1)].t + 400;
    for (let j = 0; j < k && i < ws.length; j++, i++) burst.push({ w: ws[i], t: at });
  }
  return { questionId: qid, transcript, words: burst, askedAt, firstWordAt: burst[0].t, endedAt: t + 400 };
}

function gazeFor(key, q) {
  if (!GAZE) return null;
  const reading = key === "assisted" && q.stage !== "warmup";
  return { questionId: q.id, offScreenPct: reading ? 0.35 : 0.1, readingSweeps: reading ? 9 : 2, sideBias: reading ? 0.6 : 0.05, blinkRate: 14, baselineDelta: reading ? 0.55 : 0.08 };
}

async function score(body) {
  if (!URL) return scoreAnswer(body, null);
  if (PACE) await new Promise((r) => setTimeout(r, PACE));
  return fetch(`${URL}/api/score`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
}

/** One full interview: answers in script order, baseline from their own warm-up (like app/live/page.tsx). */
async function interview(key) {
  const out = [];
  const warm = [];
  for (const [qid, a] of Object.entries(demo[key].answers)) {
    const q = questions.find((x) => x.id === qid);
    const event = replayEvent(qid, a);
    const baseline = warm.length
      ? { latencyMs: warm.reduce((s, e) => s + latencyMs({ event: e }), 0) / warm.length, wpm: warm.reduce((s, e) => s + wpm({ event: e }), 0) / warm.length, gaze: null }
      : null;
    const body = { question: q, event, gaze: gazeFor(key, q), baseline, easyVsHard: baseline && { easyLatencyMs: baseline.latencyMs, easyWpm: baseline.wpm }, profile, checklist, weights, knownAi: known };
    out.push({ q, s: await score(body) });
    if (q.stage === "warmup") warm.push(event);
  }
  return out;
}

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
let ok = true;

for (const key of ["organic", "assisted"]) {
  const runs = [];
  for (let i = 0; i < (URL ? Math.min(RUNS, 3) : RUNS); i++) runs.push(await interview(key));
  console.log(`\n${demo[key].label}   (${runs.length} replay runs${GAZE ? ", with gaze" : ""}${STT ? ", live-mic STT" : ""}${URL ? `, via ${URL}` : ", offline"})`);
  console.log("  question  median  min–max  level   firing  top signals");
  runs[0].forEach(({ q, s }, i) => {
    const risks = runs.map((r) => r[i].s.risk);
    const top = [...s.signals].sort((x, y) => y.value - x.value).slice(0, 3).map((x) => `${x.method}=${x.value.toFixed(2)}`).join(" ");
    console.log(`  ${q.id.padEnd(8)} ${String(pct(risks, 0.5)).padStart(5)}%  ${String(Math.min(...risks)).padStart(3)}–${String(Math.max(...risks)).padEnd(3)}  ${s.level.padEnd(6)}  ${String(s.methodsFiring).padStart(4)}    ${top}${s.knownAiMatch ? "  [known AI]" : ""}`);
    if (VERBOSE) {
      s.signals.forEach((x) => console.log(`      ${x.method.padEnd(16)} ${x.value.toFixed(2)}  ${x.why}`));
      console.log(`      → ${s.suggestedText}`);
    }
  });

  if (key === "organic") {
    const worst = Math.max(...runs.flatMap((r) => r.map((x) => x.s.risk)));
    const pass = worst < THRESHOLDS.watch;
    ok &&= pass;
    console.log(`  ${pass ? "PASS" : "FAIL"}: highest organic risk ${worst}% (must stay < ${THRESHOLDS.watch})`);
    if (!pass) {
      const { q, s } = runs.flat().find((x) => x.s.risk === worst);
      console.log(`  worst answer ${q.id}:`);
      s.signals.forEach((x) => console.log(`      ${x.method.padEnd(16)} ${x.value.toFixed(2)}  ${x.why}`));
    }
  } else {
    // Must cross Watch, then Warning, then Flag, in that order, and end on a flag — in every run
    const fails = runs.filter((r) => {
      const risk = r.map((x) => x.s.risk);
      const first = (th) => risk.findIndex((x) => x >= th);
      const [w, wa, f] = [first(THRESHOLDS.watch), first(THRESHOLDS.warn), first(THRESHOLDS.flag)];
      return !(w >= 0 && wa >= 0 && f >= 0 && w <= wa && wa <= f && w < f && risk.at(-1) >= THRESHOLDS.flag && risk[0] < THRESHOLDS.flag);
    }).length;
    ok &&= fails === 0;
    console.log(`  ${fails ? "FAIL" : "PASS"}: climbs 20 → 50 → 75 and ends flagged in ${runs.length - fails}/${runs.length} runs`);
  }
}
process.exit(ok ? 0 : 1);
