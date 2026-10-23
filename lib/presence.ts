// Public presence beyond GitHub: email domain, Gravatar, personal website (+ domain age), Stack Overflow.
// Free, keyless public APIs only. LinkedIn is never fetched or scraped: the recruiter reads it in their own browser.
// Same rule as lib/github.ts: live → write cache → else read cache → else fixture / nothing.
import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IdentityRequest } from "@/lib/types";
import type { PresenceFacts } from "@/lib/identity";
import demo from "@/data/fixtures/identity_demo.json";

const CACHE_DIR = join(process.cwd(), "data/cache");
const T = (ms = 4000) => AbortSignal.timeout(ms);

const DEMO: Record<string, PresenceFacts> = Object.fromEntries(Object.values(demo).map((d) => [d.github.login, d.presence as PresenceFacts]));

// Throwaway inbox services (short list; enough to catch the common ones)
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc", "fakeinbox.com", "throwawaymail.com"]);
// Shared hosting: the domain's age says nothing about the person
const PLATFORM = /(^|\.)(github\.io|vercel\.app|netlify\.app|pages\.dev|herokuapp\.com|wixsite\.com|squarespace\.com|wordpress\.com|notion\.site|carrd\.co|framer\.website|webflow\.io)$/i;

const decode = (s: string) => s.replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

async function emailFacts(email: string): Promise<PresenceFacts["email"]> {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return undefined;
  let mx: boolean | null = null;
  try {
    mx = (await Promise.race([dns.resolveMx(domain), new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 3000))])).length > 0;
  } catch (e: any) {
    mx = e?.code === "ENOTFOUND" || e?.code === "ENODATA" ? false : null; // null = couldn't tell (offline)
  }
  return { domain, edu: /\.edu$|\.ac\.[a-z]{2}$/.test(domain), disposable: DISPOSABLE.has(domain), mx };
}

async function gravatar(email: string): Promise<PresenceFacts["gravatar"]> {
  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  const res = await fetch(`https://gravatar.com/${hash}.json`, { signal: T(), headers: { "User-Agent": "GotCha-recruiter-tool" } });
  if (!res.ok) return null; // 404 = no public Gravatar profile
  const e = (await res.json()).entry?.[0];
  if (!e) return null;
  return {
    url: e.profileUrl,
    name: e.displayName || e.name?.formatted || null,
    location: e.currentLocation || null,
    accounts: (e.accounts ?? []).map((a: any) => ({ service: String(a.shortname ?? a.domain ?? ""), url: String(a.url ?? "") })),
  };
}

async function website(url: string): Promise<PresenceFacts["website"]> {
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let host = "";
  try {
    host = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  // The URL can come from the candidate's own GitHub profile: never fetch local or private addresses
  if (/^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(host) || !/^https?:$/i.test(new URL(href).protocol)) return null;
  const platform = PLATFORM.test(host);
  const [page, rdap] = await Promise.all([
    fetch(href, { signal: T(), redirect: "follow", headers: { "User-Agent": "GotCha-recruiter-tool" } })
      .then(async (r) => ({ ok: r.ok, html: r.ok ? (await r.text()).slice(0, 200000) : "" }))
      .catch(() => ({ ok: false, html: "" })),
    platform
      ? Promise.resolve(null)
      : fetch(`https://rdap.org/domain/${host.split(".").slice(-2).join(".")}`, { signal: T() })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d?.events?.find((e: any) => e.eventAction === "registration")?.eventDate ?? null)
          .catch(() => null),
  ]);
  const text = page.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  return {
    url: href,
    ok: page.ok,
    title: decode(text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "").slice(0, 80) || null,
    text: decode(text.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").slice(0, 4000),
    links: [...page.html.matchAll(/href="(https?:\/\/(?:www\.)?(?:github\.com|linkedin\.com)\/[^"]+)"/gi)].map((m) => m[1]).slice(0, 10),
    registeredAt: rdap,
    platform,
  };
}

async function stackOverflow(name: string): Promise<NonNullable<PresenceFacts["stackoverflow"]>> {
  const res = await fetch(`https://api.stackexchange.com/2.3/users?pagesize=4&order=desc&sort=reputation&site=stackoverflow&inname=${encodeURIComponent(name)}`, { signal: T() });
  if (!res.ok) return [];
  const items: any[] = (await res.json()).items ?? [];
  return items.map((u) => ({
    name: decode(u.display_name),
    url: u.link,
    location: u.location ?? null,
    createdAt: new Date(u.creation_date * 1000).toISOString(),
    reputation: u.reputation,
  }));
}

/** Everything public we can check besides GitHub. Each source fails on its own without breaking the rest. */
export async function getPresence(input: IdentityRequest, login: string | undefined, githubBlog: string | null): Promise<{ facts: PresenceFacts; source: "live" | "cache" | "fixture" | "none" }> {
  if (login && DEMO[login]) return { facts: DEMO[login], source: "fixture" };
  const site = input.website?.trim() || githubBlog?.trim() || "";
  const email = input.email?.includes("@") ? input.email.trim() : "";
  const name = input.fullName?.trim() ?? "";
  if (!email && !site && !name) return { facts: {}, source: "none" };

  const key = createHash("md5").update(`${email}|${site}|${name}`.toLowerCase()).digest("hex").slice(0, 16);
  const file = join(CACHE_DIR, `presence_${key}.json`);
  const settle = <T,>(p: Promise<T>) => p.catch(() => undefined);
  const [em, gr, web, so] = await Promise.all([
    email ? settle(emailFacts(email)) : undefined,
    email ? settle(gravatar(email)) : undefined,
    site ? settle(website(site)) : undefined,
    name.split(/\s+/).length >= 2 ? settle(stackOverflow(name)) : undefined,
  ]);
  const facts: PresenceFacts = { email: em, gravatar: gr, website: web, stackoverflow: so };
  const reached = gr !== undefined || web?.ok || so !== undefined;
  if (reached) {
    try {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, JSON.stringify(facts, null, 2));
    } catch {}
    return { facts, source: "live" };
  }
  try {
    return { facts: JSON.parse(await readFile(file, "utf8")) as PresenceFacts, source: "cache" };
  } catch {
    return { facts, source: em ? "live" : "none" };
  }
}
