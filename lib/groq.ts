// Groq via server routes only (model from GROQ_MODEL; this key has no Llama chat models, qwen works). Returns null on any failure (no key, offline, timeout,
// bad JSON) so every caller falls back locally. Never throws.
// OWNER: Person 2
const URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqOpts {
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number; // keep small: the free tier counts the reserved max against tokens-per-minute
  model?: string; // override GROQ_MODEL, e.g. to spread a batch over models (free limits are per model)
  retry429?: boolean; // batch jobs: if Groq says "try again in ≤5s", wait once and retry (never for live scoring)
}

/** Short display names for the models, shown next to their answers. */
export const MODEL_LABEL: Record<string, string> = {
  "openai/gpt-oss-120b": "GPT-OSS 120B",
  "qwen/qwen3.8-27b": "Qwen 3.8",
  "openai/gpt-oss-20b": "GPT-OSS 20B",
};

/** Chat models this key can use; batches rotate through them. */
export const GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"] as const;

export async function groqJson<T>(system: string, user: string, opts: GroqOpts | number = {}): Promise<T | null> {
  const { timeoutMs = 4000, temperature = 0.2, maxTokens = 900, model: override, retry429 = false } = typeof opts === "number" ? ({ timeoutMs: opts } as GroqOpts) : opts;
  const model = override || process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const call = () => fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature,
        ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}), // reasoning tokens count against the limit
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    let res = await call();
    const wait = Number(res.headers.get("retry-after"));
    if (res.status === 429 && retry429 && wait > 0 && wait <= 5) {
      await new Promise((r) => setTimeout(r, wait * 1000 + 200));
      res = await call();
    }
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    // Reasoning models may prepend <think>…</think> or wrap the JSON in prose; keep just the object
    const json = content.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*\}/)?.[0];
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
}
