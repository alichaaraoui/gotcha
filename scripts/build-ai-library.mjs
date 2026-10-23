// Builds data/ai_answers.json: every interview question answered by several AI models,
// so live scoring can compare a candidate against all of them (not just one shadow answer).
// Resumable: saves after every answer and skips ones already done. Throttled per model for the free plan.
// Run: node scripts/build-ai-library.mjs          (needs GROQ_API_KEY in .env.local)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const KEY = env.GROQ_API_KEY;
if (!KEY) throw new Error("GROQ_API_KEY missing in .env.local");

// One entry per model: name shown in the app, Groq id, and the gap between calls (free-plan limits)
const MODELS = [
  { name: "GPT-OSS 20B", id: "openai/gpt-oss-20b", gapMs: 2500, extra: { reasoning_effort: "low" } },
  { name: "GPT-OSS 120B", id: "openai/gpt-oss-120b", gapMs: 3000, extra: { reasoning_effort: "low" } },
  { name: "Qwen 3", id: "qwen/qwen3.8-27b", gapMs: 9000, extra: { reasoning_effort: "none" } },
];

const tracks = JSON.parse(readFileSync(join(root, "data/tracks.json"), "utf8"));
const extra = JSON.parse(readFileSync(join(root, "data/library_questions.json"), "utf8"));
const questions = [
  ...tracks.flatMap((t) => t.stages.flatMap((s) => s.questions.map((q) => ({ id: q.id, topic: t.name, text: q.text.replace("{repo}", "your main project") })))),
  ...extra,
];

const out = join(root, "data/ai_answers.json");
const lib = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const save = () => writeFileSync(out, JSON.stringify(lib, null, 2) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM =
  "You are helping a job candidate during a live technical interview. They will read your answer aloud. Answer the interviewer's question in first person, as a confident software engineer, in 60-90 words. Plain spoken English, no lists, no markdown.";

async function ask(model, question, attempt = 0) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.id, temperature: 0.7, max_completion_tokens: 400, ...model.extra, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: question }] }),
  });
  if (res.status === 429 && attempt < 6) {
    const wait = Number(/try again in ([\d.]+)s/.exec(await res.text())?.[1] ?? 10);
    await sleep((wait + 1) * 1000);
    return ask(model, question, attempt + 1);
  }
  if (res.status === 400 && model.extra.reasoning_effort && attempt === 0) {
    // model doesn't accept this reasoning setting: retry without it
    return ask({ ...model, extra: {} }, question, 1);
  }
  if (!res.ok) throw new Error(`${model.id} ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  return data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// Models run in parallel; questions run one after another per model
await Promise.all(
  MODELS.map(async (m) => {
    for (const q of questions) {
      lib[q.id] ??= { question: q.text, topic: q.topic, answers: [] };
      if (lib[q.id].answers.some((a) => a.model === m.name)) continue;
      try {
        const text = await ask(m, q.text);
        if (text) {
          lib[q.id].answers.push({ model: m.name, text });
          save();
          console.log(`✓ ${m.name.padEnd(13)} ${q.id}`);
        }
      } catch (e) {
        console.log(`✗ ${m.name.padEnd(13)} ${q.id}  ${e.message}`);
      }
      await sleep(m.gapMs);
    }
  })
);
const n = Object.values(lib).reduce((a, x) => a + x.answers.length, 0);
console.log(`done: ${Object.keys(lib).length} questions, ${n} AI answers`);
