// Text helpers shared by the scorer (server) and the live comparison panel (client).
// OWNER: Person 2

const STOP = new Set("a an the and or but of to in on for with is are was were be been it this that i you we they my our your at as by from so if then".split(" "));

export function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter(Boolean);
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

const FILLERS = ["um", "uh", "hmm", "like", "i mean", "you know", "actually", "kind of", "sort of", "i guess", "okay so"];
const AI_MARKERS = ["firstly", "secondly", "additionally", "furthermore", "moreover", "subsequently", "ultimately", "in summary", "overall", "in conclusion", "it's important to", "the importance of", "ensuring", "leverage", "robust", "scalable", "comprehensive", "optimize"];

export function fillerRate(text: string): number {
  const t = ` ${text.toLowerCase()} `;
  const n = FILLERS.reduce((acc, f) => acc + (t.split(` ${f} `).length - 1), 0);
  return n / Math.max(1, words(text).length / 50); // fillers per 50 words
}

/** Local stand-in for the Groq "does this read like an LLM?" score. 0..1 */
export function llmStyleHeuristic(text: string): { value: number; markers: string[] } {
  const t = text.toLowerCase();
  const markers = AI_MARKERS.filter((m) => t.includes(m));
  const fillers = fillerRate(text);
  const sentences = text.split(/[.!?]+/).filter((x) => x.trim().length > 0);
  const avgLen = words(text).length / Math.max(1, sentences.length);
  const tidy = text.includes(".") && /^[A-Z]/.test(text.trim()) ? 0.15 : 0; // speech-to-text rarely capitalizes/punctuates this cleanly
  const value = Math.min(1, markers.length * 0.18 + (fillers < 0.5 ? 0.2 : 0) + (avgLen > 18 ? 0.15 : 0) + tidy);
  return { value, markers };
}
