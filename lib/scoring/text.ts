// Text helpers shared by the scorer (server) and the live comparison panel (client).
// Everything here works on STT-style text (lowercase, no punctuation), so replay mode's
// punctuated scripts and Chrome's raw transcripts score the same way.
// OWNER: Person 2
import type { Question } from "@/lib/types";

const STOP = new Set("a an the and or but of to in on for with is are was were be been it this that i you we they my our your at as by from so if then".split(" "));

export function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter(Boolean);
}

/** What Chrome's speech-to-text would hand us: lowercase words, single spaces, no punctuation. */
export function normalize(text: string): string {
  return words(text).join(" ");
}

function ngrams(ws: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
  return out;
}

/** 0..1 similarity between an answer and the AI shadow answer (content words + shared 3-word phrases). */
export function similarity(a: string, b: string): number {
  const wa = words(a), wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const ca = new Set(wa.filter((w) => !STOP.has(w)));
  const cb = new Set(wb.filter((w) => !STOP.has(w)));
  let inter = 0;
  ca.forEach((w) => cb.has(w) && inter++);
  const jaccard = inter / (ca.size + cb.size - inter || 1);
  const ta = ngrams(wa, 3), tb = ngrams(wb, 3);
  let shared = 0;
  ta.forEach((g) => tb.has(g) && shared++);
  const phrase = shared / Math.min(ta.size || 1, tb.size || 1);
  return Math.min(1, 0.55 * jaccard * 2 + 0.45 * phrase * 1.5);
}

/** Word indexes in `answer` that sit inside a 3-word phrase also found in `shadow` (for highlighting). */
export function overlapIndexes(answer: string, shadow: string): Set<number> {
  const wa = words(answer);
  const tb = ngrams(words(shadow), 3);
  const hit = new Set<number>();
  for (let i = 0; i + 3 <= wa.length; i++) {
    if (tb.has(wa.slice(i, i + 3).join(" "))) [i, i + 1, i + 2].forEach((k) => hit.add(k));
  }
  return hit;
}

/** Every AI answer we have for a question: the main shadowAnswer plus any other models' answers. */
export function shadowsOf(q: Pick<Question, "shadowAnswer" | "shadowAnswers">): { model: string; text: string }[] {
  const out = [{ model: "AI", text: q.shadowAnswer }, ...(q.shadowAnswers ?? [])].filter((s) => s.text?.trim());
  return out.filter((s, i) => out.findIndex((x) => x.text.trim() === s.text.trim()) === i);
}

/** The AI answer this transcript is closest to (and how close). */
export function closestShadow(transcript: string, q: Pick<Question, "shadowAnswer" | "shadowAnswers">): { model: string; text: string; similarity: number; of: number } {
  const all = shadowsOf(q);
  let best = { ...all[0] ?? { model: "AI", text: "" }, similarity: 0 };
  for (const s of all) {
    const sim = similarity(transcript, s.text);
    if (sim > best.similarity) best = { ...s, similarity: sim };
  }
  return { ...best, of: all.length };
}

/**
 * Phrasing several AI models agree on for this question (3-word phrases found in 2+ of their answers,
 * not just filler words), and how many of them the transcript uses. Catches paraphrased or other-model answers.
 */
export function consensusHits(transcript: string, q: Pick<Question, "shadowAnswer" | "shadowAnswers">): { hits: string[]; total: number } {
  const all = shadowsOf(q);
  if (all.length < 3) return { hits: [], total: 0 };
  const count = new Map<string, number>();
  for (const s of all) ngrams(words(s.text), 3).forEach((g) => count.set(g, (count.get(g) ?? 0) + 1));
  const shared = [...count].filter(([g, n]) => n >= 2 && g.split(" ").filter((w) => !STOP.has(w)).length >= 2).map(([g]) => g);
  const said = ngrams(words(transcript), 3);
  return { hits: shared.filter((g) => said.has(g)), total: shared.length };
}

// Spoken disfluencies and hedges: people thinking out loud. Chrome often drops "um", so hedges count too.
// (Bare "like"/"well" are left out: "frameworks like FastAPI" and "works well" aren't fillers.)
const FILLERS = ["um", "uh", "erm", "hmm", "i was like", "it's like", "like um", "okay", "oh", "yeah", "i mean", "you know", "actually", "honestly", "basically", "kind of", "sort of", "i guess", "i think", "probably", "i don't know", "i don't think", "not sure", "i'd have to", "i've only", "a little", "let me think", "wait"];
// ChatGPT-isms: connective scaffolding and buzzwords people rarely say out loud.
const AI_MARKERS = ["firstly", "secondly", "thirdly", "additionally", "furthermore", "moreover", "subsequently", "ultimately", "in summary", "overall", "in conclusion", "it's important to", "the importance of", "ensuring", "ensure", "leverage", "leveraging", "robust", "scalable", "scalability", "comprehensive", "optimize", "particularly proud", "extensive ecosystem", "separation of concerns", "separate concerns", "best practices", "enables", "enable rapid", "while maintaining", "enhance", "streamline", "seamless", "versatility", "appropriate"];
// "first ... second ... finally" scaffolding
const ENUM = /\b(first|firstly)\b[\s\S]*\b(second|secondly|then|next|additionally)\b[\s\S]*\b(finally|lastly|third|thirdly|overall)\b/;
// Personal, concrete, slightly messy: what real experience sounds like
const PERSONAL = /\b(i was|we were|we kept|i had|i forgot|i broke|i messed|was wrong|went wrong|bit us|bit me|my bad|i was lazy|which is bad|turned out|the bug was|at my (internship|job|work|last job)|my manager|my team)\b/g;

function countPhrases(t: string, list: string[]): string[] {
  const padded = ` ${t} `;
  return list.filter((f) => padded.includes(` ${f} `));
}

/** Fillers/hedges per 50 words (on STT-normalized text). */
export function fillerRate(text: string): number {
  const t = ` ${normalize(text)} `;
  const n = FILLERS.reduce((acc, f) => acc + (t.split(` ${f} `).length - 1), 0);
  return n / Math.max(1, words(text).length / 50);
}

/** Local stand-in for the Groq "does this read like an LLM?" score. 0..1 */
export function llmStyleHeuristic(text: string): { value: number; markers: string[] } {
  const t = normalize(text);
  const n = t.split(" ").filter(Boolean).length;
  if (n < 6) return { value: 0, markers: [] };
  const markers = countPhrases(t, AI_MARKERS);
  const fillers = fillerRate(text);
  const personal = (t.match(PERSONAL) ?? []).length;
  let value = Math.min(0.75, markers.length * 0.17);
  if (ENUM.test(t)) value += 0.2; // "first ... second ... finally"
  if (fillers < 0.4) value += 0.15; // zero thinking-out-loud
  value -= Math.min(0.4, fillers * 0.12) + personal * 0.15;
  return { value: Math.max(0, Math.min(1, value)), markers };
}

/** Does the first stretch of the answer start cleanly (no "um", "hmm", "okay so")? Relayed answers do. */
export function fluentStart(text: string, n = 6): boolean {
  return fillerRate(words(text).slice(0, n).join(" ")) === 0;
}
