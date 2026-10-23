import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { StoreProvider } from "@/lib/store";

export const metadata = { title: "Unscripted", description: "Live interview co-pilot for recruiters" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          <nav className="flex items-center gap-6 border-b border-slate-800 px-6 py-3 text-sm">
            <span className="font-semibold tracking-tight">Unscripted</span>
            <Link href="/" className="text-slate-300 hover:text-white">Setup</Link>
            <Link href="/live" className="text-slate-300 hover:text-white">Live room</Link>
            <Link href="/report" className="text-slate-300 hover:text-white">Report</Link>
            <Link href="/insights" className="text-slate-300 hover:text-white">Learning</Link>
            <span className="ml-auto text-xs text-slate-500">Only the recruiter sees this screen</span>
          </nav>
          <main className="mx-auto max-w-7xl p-6">{children}</main>
        </StoreProvider>
      </body>
    </html>
  );
}
