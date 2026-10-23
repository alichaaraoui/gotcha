// Tiny line icons (no icon library needed). OWNER: Person 1
const PATHS = {
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3",
  stop: "M7 7h10v10H7z",
  deeper: "M12 4v12m0 0-5-5m5 5 5-5M5 20h14",
  probe: "M12 3v3m0 12v3M3 12h3m12 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  plus: "M12 5v14M5 12h14",
  back: "M15 6l-6 6 6 6",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z",
  link: "M7 17 17 7M9 7h8v8",
  pin: "M12 17v5M8 3h8l-1 6 3 3H6l3-3-1-6Z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
