// GitHub REST: the ONE live API call. live → write cache → else read cache → else fallback fixture.
// OWNER: Person 2
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CandidateProfile } from "@/lib/types";
import fallback from "@/data/fixtures/github_fallback.json";

const CACHE_DIR = join(process.cwd(), "data/cache");
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function live(login: string): Promise<CandidateProfile> {
  const opts = { headers, signal: AbortSignal.timeout(5000) };
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
  const file = join(CACHE_DIR, `github_${login.toLowerCase()}.json`);
  try {
    const p = await live(login);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(p, null, 2));
    return p;
  } catch {
    try {
      return { ...(JSON.parse(await readFile(file, "utf8")) as CandidateProfile), source: "cache" };
    } catch {
      return { ...(fallback as CandidateProfile), source: "fallback" };
    }
  }
}
