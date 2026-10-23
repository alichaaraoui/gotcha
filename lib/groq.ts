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
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        temperature: 0.2,
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
