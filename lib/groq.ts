// Groq (Llama-3) via server routes only. Returns null on any failure (no key, offline, timeout,
// bad JSON) so every caller falls back locally. Never throws.
// OWNER: Person 2
const URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqOpts {
  timeoutMs?: number;
  temperature?: number;
}

export async function groqJson<T>(system: string, user: string, opts: GroqOpts | number = {}): Promise<T | null> {
  const { timeoutMs = 4000, temperature = 0.2 } = typeof opts === "number" ? { timeoutMs: opts } : opts;
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        temperature,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? (JSON.parse(content) as T) : null;
  } catch {
    return null;
  }
}
