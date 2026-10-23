// GitHub REST for the identity check: raw profile facts + "possible matches" search.
// Same rule as lib/github.ts: live → write cache → else read cache → else fixture / nothing.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GithubMatch } from "@/lib/types";
import type { GithubFacts } from "@/lib/identity";
import demo from "@/data/fixtures/identity_demo.json";

const CACHE_DIR = join(process.cwd(), "data/cache");
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};
const opts = () => ({ headers, signal: AbortSignal.timeout(5000) });

export const DEMO_FACTS: Record<string, GithubFacts> = Object.fromEntries(
  Object.values(demo).map((d) => [d.github.login, d.github as GithubFacts]),
);

async function live(login: string): Promise<GithubFacts> {
  const [uRes, rRes, eRes] = await Promise.all([
    fetch(`https://api.github.com/users/${login}`, opts()),
    fetch(`https://api.github.com/users/${login}/repos?per_page=100&sort=pushed`, opts()),
    fetch(`https://api.github.com/users/${login}/events/public?per_page=100`, opts()),
  ]);
  if (!uRes.ok || !rRes.ok) throw new Error(`github ${uRes.status}/${rRes.status}`);
  const u = await uRes.json();
  const repos: any[] = await rRes.json();
  const events: any[] = eRes.ok ? await eRes.json() : [];
  return {
    login: u.login, name: u.name, avatarUrl: u.avatar_url, createdAt: u.created_at,
    location: u.location, company: u.company, blog: u.blog || null, bio: u.bio, publicRepos: u.public_repos,
    repos: repos.map((r) => ({ name: r.name, description: r.description, language: r.language, fork: r.fork, createdAt: r.created_at, pushedAt: r.pushed_at })),
    events: events.map((e) => ({ type: e.type, createdAt: e.created_at })),
  };
}

export async function getFacts(login: string): Promise<{ facts: GithubFacts | null; source: "live" | "cache" | "fixture" | "none" }> {
  if (DEMO_FACTS[login]) return { facts: DEMO_FACTS[login], source: "fixture" };
  const file = join(CACHE_DIR, `identity_${login.toLowerCase()}.json`);
  try {
    const facts = await live(login);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(facts, null, 2));
    return { facts, source: "live" };
  } catch {
    try {
      return { facts: JSON.parse(await readFile(file, "utf8")) as GithubFacts, source: "cache" };
    } catch {
      return { facts: null, source: "none" };
    }
  }
}

/** No GitHub given: look for likely accounts by email, then by name (+ location). Never linked automatically. */
export async function searchMatches(email?: string, fullName?: string, location?: string): Promise<GithubMatch[]> {
  const queries: { q: string; why: string }[] = [];
  if (email?.includes("@")) queries.push({ q: `${email} in:email`, why: `public email matches ${email}` });
  if (fullName?.trim()) {
    const city = location?.split(",")[0]?.trim();
    if (city) queries.push({ q: `fullname:"${fullName.trim()}" location:"${city}"`, why: `name + location match "${fullName.trim()}, ${city}"` });
    queries.push({ q: `fullname:"${fullName.trim()}"`, why: `name matches "${fullName.trim()}"` });
  }
  const found = new Map<string, { login: string; why: string }>();
  for (const { q, why } of queries) {
    try {
      const res = await fetch(`https://api.github.com/search/users?per_page=5&q=${encodeURIComponent(q)}`, opts());
      if (!res.ok) continue;
      const items: any[] = (await res.json()).items ?? [];
      items.forEach((it) => !found.has(it.login) && found.set(it.login, { login: it.login, why }));
    } catch {}
    if (found.size >= 4) break;
  }
  // Fill in name / location / account age so the recruiter can judge each one
  return Promise.all(
    [...found.values()].slice(0, 4).map(async ({ login, why }) => {
      try {
        const u = await (await fetch(`https://api.github.com/users/${login}`, opts())).json();
        return { login, name: u.name ?? null, avatarUrl: u.avatar_url ?? null, location: u.location ?? null, createdAt: u.created_at ?? null, url: `https://github.com/${login}`, why };
      } catch {
        return { login, name: null, avatarUrl: null, location: null, createdAt: null, url: `https://github.com/${login}`, why };
      }
    }),
  );
}
