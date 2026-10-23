// GitHub REST: the ONE live API call. live → write cache → else read cache → else fallback fixture.
// (Offline, rate-limited (403) or slow (>4s): served from data/cache/, so look candidates up once before the demo.)
// OWNER: Person 2
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CandidateProfile } from "@/lib/types";
import fallback from "@/data/fixtures/github_fallback.json";
import { DEMO_FACTS } from "@/lib/identityGithub";
import { factsToProfile } from "@/lib/identity";

// Vercel's servers can only write to /tmp; locally the cache lives in data/cache
const CACHE_DIR = process.env.VERCEL ? "/tmp/gotcha-cache" : join(process.cwd(), "data/cache");
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

// GitHub usernames: letters, digits, single hyphens, max 39 chars. Anything else never hits the network
// or the filesystem (the login becomes a cache filename).
const VALID_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

async function live(login: string): Promise<CandidateProfile> {
  const opts = { headers, signal: AbortSignal.timeout(4000), cache: "no-store" as const };
  const [uRes, rRes, eRes] = await Promise.all([
    fetch(`https://api.github.com/users/${login}`, opts),
    fetch(`https://api.github.com/users/${login}/repos?per_page=100&sort=pushed`, opts),
    fetch(`https://api.github.com/users/${login}/events/public?per_page=100`, opts),
  ]);
  if (!uRes.ok || !rRes.ok) throw new Error(`github ${uRes.status}/${rRes.status}`);
  const u = await uRes.json();
  const repos: any[] = (await rRes.json()).filter((r: any) => !r.fork);
  const events: any[] = eRes.ok ? await eRes.json() : [];

  const langCount: Record<string, number> = {};
  repos.forEach((r) => r.language && (langCount[r.language] = (langCount[r.language] ?? 0) + 1));
  const total = Object.values(langCount).reduce((a, b) => a + b, 0) || 1;
  const cutoff = Date.now() - 90 * 86400000;
  const commitsLast90d = events
    .filter((e) => e.type === "PushEvent" && Date.parse(e.created_at) > cutoff)
    .reduce((a, e) => a + (e.payload?.size ?? e.payload?.commits?.length ?? 1), 0);

  return {
    login: u.login,
    name: u.name,
    avatarUrl: u.avatar_url,
    accountAgeYrs: Math.round(((Date.now() - Date.parse(u.created_at)) / 31557600000) * 10) / 10,
    publicRepos: u.public_repos,
    topLanguages: Object.entries(langCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, n]) => ({ lang, pct: Math.round((n / total) * 100) / 100 })),
    repos: repos.slice(0, 12).map((r) => ({
      name: r.name, description: r.description, language: r.language,
      stars: r.stargazers_count, lastPush: r.pushed_at, url: r.html_url,
    })),
    commitsLast90d,
    source: "live",
  };
}

export async function getProfile(login: string): Promise<CandidateProfile> {
  if (login === fallback.login) return { ...(fallback as CandidateProfile), source: "fallback" };
  if (DEMO_FACTS[login]) return factsToProfile(DEMO_FACTS[login]); // identity-check demo candidates, offline
  if (!VALID_LOGIN.test(login)) return { ...(fallback as CandidateProfile), source: "fallback" }; // never hits network or disk
  const file = join(CACHE_DIR, `github_${login.toLowerCase()}.json`);
  try {
    const p = await live(login);
    await mkdir(CACHE_DIR, { recursive: true }).then(() => writeFile(file, JSON.stringify(p, null, 2))).catch(() => {}); // a failed cache save never breaks a live lookup
    return p;
  } catch {
    try {
      return { ...(JSON.parse(await readFile(file, "utf8")) as CandidateProfile), source: "cache" };
    } catch {
      return { ...(fallback as CandidateProfile), source: "fallback" };
    }
  }
}
