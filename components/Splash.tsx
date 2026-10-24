// Opening screen: the GotCha mark + wordmark fade in, then fade into the app.
// Once per browser session; a tiny inline script in the layout hides it before paint on repeat loads.
// OWNER: Person 1
"use client";
import { useEffect, useRef, useState } from "react";

export const SPLASH_KEY = "gotcha.splash";

export function Splash() {
  const [gone, setGone] = useState(false);
  const seen = useRef<boolean | null>(null); // decided once, even when dev mode runs effects twice

  useEffect(() => {
    if (seen.current === null) {
      try {
        seen.current = !!sessionStorage.getItem(SPLASH_KEY);
        sessionStorage.setItem(SPLASH_KEY, "1");
      } catch {
        seen.current = false;
      }
    }
    if (seen.current) return setGone(true); // already seen this session
    const t = setTimeout(() => setGone(true), 2200); // after the CSS fade-out finishes
    return () => clearTimeout(t);
  }, []);

  if (gone) return null;
  return (
    <div className="splash no-print" aria-hidden onClick={() => setGone(true)}>
      <div className="splash-glow" />
      <div className="splash-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/gotcha-mark.svg" alt="" className="splash-mark" />
        <div className="splash-word">GotCha</div>
        <div className="splash-line">Prove it&apos;s really them.</div>
      </div>
    </div>
  );
}
