// Groq (Llama-3) via server routes only. Returns null on any failure so callers fall back locally.
// OWNER: Person 2
const URL = "https://api.groq.com/openai/v1/chat/completions";

export async function groqJson<T>(system: string, user: string, timeoutMs = 4000): Promise<T | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Groq retired Llama 3; gpt-oss-20b is the fast model available on the free plan
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        temperature: 0.2,
        max_completion_tokens: 900,
        ...((process.env.GROQ_MODEL || "openai/gpt-oss-20b").startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content) as T;
  } catch {
    return null;
  }
}
