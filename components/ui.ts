import type { Level } from "@/lib/types";

export const LEVEL_STYLE: Record<Level, { dot: string; text: string; label: string }> = {
  clear: { dot: "bg-clear", text: "text-clear", label: "Clear" },
  watch: { dot: "bg-watch", text: "text-watch", label: "Watch" },
  warn: { dot: "bg-warn", text: "text-warn", label: "Warning" },
  flag: { dot: "bg-flag", text: "text-flag", label: "Test now" },
};

export const METHOD_LABEL: Record<string, string> = {
  eye_reading: "Reading eye pattern", eye_offscreen: "Looking off-screen", eye_baseline: "Eyes vs. warm-up",
  latency: "Delay before answering", pauses: "Pause pattern", steady_rate: "Steady reading speed",
  ai_similarity: "Matches AI answer", llm_style: "AI-style wording", github_mismatch: "Not in their GitHub",
  easy_vs_hard: "Easy vs. hard", manual: "Recruiter / environment",
};
