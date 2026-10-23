// OWNER: Person 1
import type { Checklist as C } from "@/lib/types";

const ITEMS: [keyof C, string][] = [
  ["earpiece", "Earpiece / headphones"],
  ["glassesReflection", "Screen reflection in glasses"],
  ["virtualBackground", "Virtual / blurred background"],
  ["idShown", "ID shown on camera"],
];

export function Checklist({ value, onChange }: { value: C; onChange: (c: C) => void }) {
  return (
    <div className="card space-y-2">
      <div className="label">Environment check</div>
      {ITEMS.map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} /> {label}
        </label>
      ))}
    </div>
  );
}
