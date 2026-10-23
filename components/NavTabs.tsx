// Pill navigation + report export. OWNER: Person 1
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Setup" },
  { href: "/live", label: "Live interview" },
  { href: "/report", label: "Report" },
  { href: "/library", label: "Library" },
  { href: "/insights", label: "Learning" },
];

export function NavTabs() {
  const path = usePathname();
  return (
    <nav className="no-print flex items-center gap-3 px-8 py-5">
      <Link href="/" className="mr-6 flex shrink-0 items-center" aria-label="GotCha home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/gotcha-logo-dark.svg" alt="GotCha" className="h-8 w-auto" />
      </Link>
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`whitespace-nowrap rounded-full px-4 py-1.5 text-xs transition ${path === t.href ? "bg-white text-black" : "border border-white/15 text-white/70 hover:text-white"}`}>
          {t.label}
        </Link>
      ))}
      <span className="ml-auto hidden text-xs text-white/40 lg:inline">Only you can see this screen</span>
    </nav>
  );
}
