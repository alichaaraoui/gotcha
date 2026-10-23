// The one-glance status: a colored light + three plain words. No percentages during the call.
// OWNER: Person 1
import type { Level } from "@/lib/types";

export const STATUS: Record<Level, { words: string; dot: string; bg: string; text: string }> = {
  clear: { words: "Sounds genuine", dot: "bg-clear", bg: "bg-emerald-50/80", text: "text-emerald-800" },
  watch: { words: "Keep an eye on it", dot: "bg-watch", bg: "bg-amber-50/85", text: "text-amber-800" },
  warn: { words: "Dig deeper", dot: "bg-warn", bg: "bg-orange-50/90", text: "text-orange-800" },
  flag: { words: "Test now", dot: "bg-flag", bg: "bg-rose-50/90", text: "text-rose-800" },
};

export function StatusBar({ level, progress }: { level: Level | null; progress: string }) {
  const s = level ? STATUS[level] : null;
  return (
    <div className={`flex items-center gap-3 rounded-full px-4 py-3 ${s ? s.bg : "bg-white/45"}`}>
      <span className={`h-3.5 w-3.5 rounded-full ${s ? s.dot : "bg-slate-300"} ${level === "flag" ? "animate-pulse" : ""}`} />
      <span className={`text-lg font-normal ${s ? s.text : "text-slate-600"}`}>{s ? s.words : "Waiting for the first answer"}</span>
      <span className="ml-auto text-xs text-slate-500">{progress}</span>
    </div>
  );
}
