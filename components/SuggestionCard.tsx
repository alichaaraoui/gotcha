// The ONE thing Sarah should do next, in plain English.
// OWNER: Person 1
import type { Question, Score } from "@/lib/types";
import { LEVEL_STYLE, METHOD_LABEL } from "./ui";

export function SuggestionCard({ score, question }: { score?: Score; question?: Question }) {
  return (
    <div className="card space-y-2">
      <div className="label">Next step</div>
      <p className={`text-lg font-medium ${score ? LEVEL_STYLE[score.level].text : ""}`}>{score?.suggestedText ?? "Ask the question, then press Done when they finish."}</p>
      {score?.knownAiMatch && <p className="text-sm text-flag">Matches an AI answer seen in a past interview ({Math.round(score.knownAiMatch.similarity * 100)}%).</p>}
      {score && (
        <ul className="text-xs text-slate-400">
          {[...score.signals].sort((a, b) => b.value - a.value).slice(0, 3).map((s, i) => (
            <li key={i}>• <b>{METHOD_LABEL[s.method]}</b>: {s.why}</li>
          ))}
        </ul>
      )}
      {question && <p className="text-xs text-slate-500">A real answer: {question.goodAnswerHint}</p>}
    </div>
  );
}
