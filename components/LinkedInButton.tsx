// LinkedIn blocks iframes, so open it in a slim window docked to the right of the screen.
// Uses the recruiter's own logged-in Chrome. View only, no scraping.
// OWNER: Person 1
"use client";

export function openDocked(url: string) {
  const w = 480;
  const left = window.screen.availWidth - w;
  window.open(url, "unscripted-side", `popup=yes,width=${w},height=${window.screen.availHeight},left=${left},top=0`);
}

export function LinkedInButton({ url, githubLogin }: { url?: string; githubLogin?: string }) {
  return (
    <div className="flex gap-2">
      <button className="btn-ghost" disabled={!url} onClick={() => url && openDocked(url)}>Open LinkedIn ↗</button>
      {githubLogin && <button className="btn-ghost" onClick={() => openDocked(`https://github.com/${githubLogin}`)}>Open GitHub ↗</button>}
    </div>
  );
}
