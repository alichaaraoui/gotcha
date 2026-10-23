// Identity consistency: does the profile hold together? Pure functions, no network.
// Catches copied/template LinkedIns, impossible timelines, and GitHubs that don't match the person.
// The tool suggests, the recruiter decides.
import type { CandidateProfile, IdentityCheck, IdentityReport, IdentityRequest, IdentityStatus } from "@/lib/types";

/** Raw GitHub fields the identity checks need (more than CandidateProfile keeps). */
export interface GithubFacts {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string; // ISO
  location: string | null;
  company: string | null;
  blog: string | null;
  bio: string | null;
  publicRepos: number;
  repos: { name: string; description: string | null; language: string | null; fork: boolean; createdAt: string; pushedAt: string }[];
  events: { type: string; createdAt: string }[];
}

/** Groq's read of the pasted text (route passes it in; null when Groq is off). */
export interface TextRating {
  score: number; // 0..1, how generic / AI-written / templated
  lines: { text: string; why: string }[];
}

const YEAR = () => new Date().getFullYear();
const yearOf = (iso: string) => new Date(iso).getFullYear();

// ---------- Parsing the pasted LinkedIn / resume text ----------
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+";
const RANGE = new RegExp(`(?:${MONTH})?((?:19|20)\\d{2})\\s*(?:-|–|—|to)\\s*(?:${MONTH})?((?:19|20)\\d{2}|present|current|now)`, "i");
const EDU = /universit|college|school|institute|\bb\.?s\.?\b|\bb\.?a\.?\b|bachelor|master|\bm\.?s\.?\b|ph\.?d|degree|class of/i;
const PART_TIME = /intern|co-?op|part[- ]time|teaching assistant|\bta\b|research assistant|volunteer|freelance|tutor/i;
const SENIOR = /senior|\bsr\.?\b|lead|principal|staff|manager|director|head of|architect/i;

interface Entry { title: string; start: number; end: number; edu: boolean; partTime: boolean; senior: boolean }

export function parseEntries(text: string): Entry[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: Entry[] = [];
  lines.forEach((line, i) => {
    const m = line.match(RANGE);
    if (!m) return;
    // The title is often on the line above the dates
    const before = line.slice(0, m.index).replace(/[·,|–-]\s*$/, "").trim();
    const title = before.length > 3 ? before : `${lines[i - 1] ?? ""} ${before}`.trim();
    const ctx = `${lines[i - 1] ?? ""} ${line}`;
    const start = +m[1];
    const end = /^\d/.test(m[2]) ? +m[2] : YEAR();
    const edu = EDU.test(title) || (EDU.test(ctx) && !/engineer|developer|analyst|scientist|intern/i.test(title));
    out.push({ title: title.slice(0, 80), start, end, edu, partTime: PART_TIME.test(title), senior: SENIOR.test(title) });
  });
  return out;
}

interface Stage { student: boolean; gradYear: number | null; studyStart: number | null; school: string | null; claimedYrs: number | null }

export function careerStage(text: string, input: IdentityRequest, entries = parseEntries(text)): Stage {
  const edu = entries.filter((e) => e.edu).sort((a, b) => b.end - a.end)[0];
  const classOf = text.match(/class of\s*'?((?:20)?\d{2})/i) ?? text.match(/expected(?: graduation)?[^\d\n]{0,20}((?:19|20)\d{2})/i);
  const grad = input.gradYear || (classOf ? +(classOf[1].length === 2 ? `20${classOf[1]}` : classOf[1]) : null) || (edu && edu.end >= YEAR() ? edu.end : null);
  const student = /current(?:ly)?\s+(?:a\s+)?(?:\w+\s+)?student|undergrad|\bsophomore\b|\bjunior\b(?! (?:developer|engineer))|\bfreshman\b/i.test(text) || !!(grad && grad >= YEAR());
  const yrs = text.match(/(\d{1,2})\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:professional\s+)?experience/i);
  return {
    student,
    gradYear: grad,
    studyStart: edu ? edu.start : grad ? grad - 4 : null,
    school: input.claimedSchool || (edu ? edu.title : null),
    claimedYrs: yrs ? +yrs[1] : null,
  };
}

// ---------- Check 1: account age vs. claimed career stage ----------
export function checkAccountTimeline(gh: GithubFacts | null, st: Stage, hasText: boolean): IdentityCheck {
  const base = { id: "timeline_account" as const, label: "GitHub age vs. career stage" };
  if (!gh) return { ...base, status: "unknown", why: "No GitHub account to compare against." };
  const acct = yearOf(gh.createdAt);
  const firstRepo = gh.repos.filter((r) => !r.fork).map((r) => yearOf(r.createdAt)).sort()[0];
  const firstNote = firstRepo && firstRepo !== acct ? ` First own repo: ${firstRepo}.` : "";
  if (!hasText && !st.gradYear) return { ...base, status: "unknown", why: `Account opened in ${acct}. Paste their LinkedIn or resume to compare it with their career stage.` };
  if (st.student && st.studyStart) {
    const age = acct - (st.studyStart - 18); // most students start college around 18
    const stage = `a student who started college in ${st.studyStart}${st.gradYear ? ` (class of ${st.gradYear})` : ""}`;
    if (age <= 12) return { ...base, status: "risk", why: `Account opened in ${acct}. For ${stage}, that's about age ${Math.max(age, 1)}; GitHub requires users to be 13.${firstNote}` };
    if (age <= 15) return { ...base, status: "warn", why: `Account opened in ${acct}, when ${stage} would have been about ${age}. Possible, but worth asking.${firstNote}` };
    return { ...base, status: "ok", why: `Account opened in ${acct}, around age ${age} for ${stage}. That fits.` };
  }
  if (st.claimedYrs && YEAR() - acct > st.claimedYrs + 12) return { ...base, status: "warn", why: `Account is ${YEAR() - acct} years old but they claim ${st.claimedYrs} years of experience.` };
  return { ...base, status: "ok", why: `Account opened in ${acct}, which fits a working professional.${firstNote}` };
}

// ---------- Check 2: degree years vs. job years ----------
export function checkResumeTimeline(text: string, st: Stage, entries = parseEntries(text)): IdentityCheck {
  const base = { id: "timeline_resume" as const, label: "Degree vs. job dates" };
  if (!text.trim()) return { ...base, status: "unknown", why: "Paste their LinkedIn Experience + Education or resume to check the dates." };
  if (!entries.length) return { ...base, status: "unknown", why: "Couldn't find any date ranges in the pasted text." };
  const risks: string[] = [], warns: string[] = [];
  const jobs = entries.filter((e) => !e.edu && !e.partTime);
  if (st.student && st.studyStart) {
    jobs.forEach((j) => {
      if (j.start < st.studyStart! - 1) (j.senior || j.start < st.studyStart! - 3 ? risks : warns).push(`full-time "${j.title}" from ${j.start}, before starting college in ${st.studyStart}`);
      else if (j.senior && j.end >= st.studyStart!) risks.push(`"${j.title}" while still a student`);
    });
    const possible = YEAR() - st.studyStart + 1;
    if (st.claimedYrs && st.claimedYrs > possible + 1) risks.push(`claims ${st.claimedYrs}+ years of experience as a current student`);
  }
  for (let i = 0; i < jobs.length; i++)
    for (let k = i + 1; k < jobs.length; k++) {
      const overlap = Math.min(jobs[i].end, jobs[k].end) - Math.max(jobs[i].start, jobs[k].start);
      if (overlap >= 1) warns.push(`two full-time roles at once for ${overlap}+ years ("${jobs[i].title}" and "${jobs[k].title}")`);
    }
  entries.filter((e) => e.end < e.start).forEach((e) => warns.push(`"${e.title}" ends before it starts`));
  if (risks.length) return { ...base, status: "risk", why: cap([...risks, ...warns].join("; ")) };
  if (warns.length) return { ...base, status: "warn", why: cap(warns.join("; ")) };
  return { ...base, status: "ok", why: `${entries.length} dated entries; degree and job years line up.` };
}

// ---------- Check 3: GitHub location / company / school vs. claims ----------
const STATES: Record<string, string> = Object.fromEntries(
  "al alabama|ak alaska|az arizona|ar arkansas|ca california|co colorado|ct connecticut|de delaware|fl florida|ga georgia|hi hawaii|id idaho|il illinois|in indiana|ia iowa|ks kansas|ky kentucky|la louisiana|me maine|md maryland|ma massachusetts|mi michigan|mn minnesota|ms mississippi|mo missouri|mt montana|ne nebraska|nv nevada|nh new hampshire|nj new jersey|nm new mexico|ny new york|nc north carolina|nd north dakota|oh ohio|ok oklahoma|or oregon|pa pennsylvania|ri rhode island|sc south carolina|sd south dakota|tn tennessee|tx texas|ut utah|vt vermont|va virginia|wa washington|wv west virginia|wi wisconsin|wy wyoming|dc district of columbia"
    .split("|").map((p) => [p.slice(0, 2), p.slice(3)]),
);
const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
const SCHOOL_STOP = new Set(["university", "of", "the", "at", "college", "state", "institute", "technology", "b", "s", "bs", "ba", "computer", "science", "in", "and"]);

/** Place tokens: city words + both the state's code and full name. */
function placeKeys(loc: string): string[] {
  const parts = loc.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  const keys = new Set<string>();
  parts.forEach((p) => {
    if (STATES[p]) keys.add(STATES[p]);
    const full = Object.entries(STATES).find(([, n]) => n === p);
    if (full) keys.add(full[1]);
    if (!STATES[p] && !full) keys.add(p);
  });
  return [...keys];
}
function placeMatches(claimed: string, gh: string): boolean {
  const g = norm(gh.split(",").map((p) => STATES[p.trim().toLowerCase()] ?? p).join(" "));
  return placeKeys(claimed).some((k) => g.includes(norm(k)));
}
function schoolMatches(claimed: string, gh: string): boolean {
  const g = norm(gh);
  const c = norm(claimed);
  if (/nc state|ncsu|north carolina state/.test(c) && /nc state|ncsu|north carolina state|wolfpack/.test(g)) return true;
  if (/unc charlotte|uncc|north carolina at charlotte/.test(c) && /unc charlotte|uncc|charlotte/.test(g)) return true;
  const key = c.trim().split(" ").filter((w) => w.length > 2 && !SCHOOL_STOP.has(w));
  return key.length > 0 && key.every((w) => g.includes(` ${w} `));
}

export function checkLocation(gh: GithubFacts | null, input: IdentityRequest, st: Stage, text: string): IdentityCheck {
  const base = { id: "location" as const, label: "Location & school vs. GitHub" };
  if (!gh) return { ...base, status: "unknown", why: "No GitHub account to compare against." };
  const loc = input.claimedLocation?.trim();
  const school = st.school?.trim();
  if (!loc && !school) return { ...base, status: "unknown", why: "Add where they say they live or study to compare with GitHub." };
  const ghAll = [gh.location, gh.company, gh.blog, gh.bio].filter(Boolean).join(" · ");
  if (!ghAll) return { ...base, status: "unknown", why: "Their GitHub lists no location, company, website or bio." };
  const notes: string[] = [];
  let bad = 0, good = 0;
  if (loc && gh.location) {
    if (placeMatches(loc, gh.location)) { good++; notes.push(`GitHub location "${gh.location}" matches ${loc}`); }
    else { bad++; notes.push(`GitHub says "${gh.location}", they claim ${loc}`); }
  }
  const ghSchool = `${gh.bio ?? ""} ${gh.company ?? ""} ${gh.blog ?? ""}`;
  if (school && /universit|college|\bstate\b|\.edu|uncc|ncsu/i.test(ghSchool)) {
    if (schoolMatches(school, ghSchool)) { good++; notes.push("school in their GitHub bio matches"); }
    else { bad++; notes.push(`GitHub bio mentions a different school ("${ghSchool.trim().slice(0, 60)}")`); }
  }
  const company = gh.company?.replace(/^@/, "").trim();
  if (company && !(school && schoolMatches(school, company)) && !norm(text).includes(norm(company).trim())) {
    bad++;
    notes.push(`GitHub lists employer "${company}", which isn't in their LinkedIn/resume`);
  }
  if (!notes.length) return { ...base, status: "unknown", why: `GitHub shows "${ghAll.slice(0, 60)}", nothing to compare directly.` };
  const status: IdentityStatus = bad >= 2 ? "risk" : bad === 1 ? "warn" : "ok";
  return { ...base, status, why: cap(`${notes.join("; ")}.`) };
}

// ---------- Check 4: skills claimed vs. GitHub evidence ----------
// Own list (not signals.ts unsupportedClaims) so we also get what was claimed, and so "go" only counts as the language.
const TECH: [string, RegExp][] = [
  ["Python", /\bpython\b/i], ["JavaScript", /\bjavascript\b|\bjs\b/i], ["TypeScript", /\btypescript\b/i], ["Java", /\bjava\b(?!script)/i],
  ["C++", /c\+\+|\bcpp\b/i], ["C#", /c#|\.net\b/i], ["Go", /\bGo\b|\bgolang\b/], ["Rust", /\brust\b/i], ["Kotlin", /\bkotlin\b/i],
  ["Swift", /\bswift\b/i], ["Ruby", /\bruby\b|\brails\b/i], ["PHP", /\bphp\b/i], ["React", /\breact\b/i], ["Next.js", /\bnext\.?js\b/i],
  ["Node.js", /\bnode(?:\.?js)?\b/i], ["Vue", /\bvue\b/i], ["Angular", /\bangular\b/i], ["Django", /\bdjango\b/i], ["Flask", /\bflask\b/i],
  ["FastAPI", /\bfastapi\b/i], ["Spring", /\bspring\b/i], ["Kafka", /\bkafka\b/i], ["Redis", /\bredis\b/i], ["Postgres", /\bpostgres(?:ql)?\b/i],
  ["MySQL", /\bmysql\b/i], ["MongoDB", /\bmongo(?:db)?\b/i], ["Docker", /\bdocker\b/i], ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["AWS", /\baws\b|\bs3\b|\blambda\b/i], ["GCP", /\bgcp\b|google cloud/i], ["Azure", /\bazure\b/i], ["Terraform", /\bterraform\b/i],
  ["GraphQL", /\bgraphql\b/i], ["TensorFlow", /\btensorflow\b/i], ["PyTorch", /\bpytorch\b/i], ["Spark", /\bspark\b/i],
];

export function checkSkills(gh: GithubFacts | null, text: string): IdentityCheck {
  const base = { id: "skills" as const, label: "Skills claimed vs. GitHub" };
  const claimed = TECH.filter(([, re]) => re.test(text));
  if (!text.trim() || !claimed.length) return { ...base, status: "unknown", why: text.trim() ? "No specific technologies named in the pasted text." : "Paste their LinkedIn or resume to compare skills." };
  if (!gh) return { ...base, status: "unknown", why: `They list ${claimed.map((c) => c[0]).join(", ")}; no GitHub to check against.` };
  // Forks don't count as evidence: anyone can fork kubernetes
  const corpus = [gh.bio ?? "", ...gh.repos.filter((r) => !r.fork).flatMap((r) => [r.name.replace(/[-_]/g, " "), r.description ?? "", r.language ?? ""])].join(" \n ");
  const missing = claimed.filter(([, re]) => !re.test(corpus)).map((c) => c[0]);
  const found = claimed.length - missing.length;
  const ratio = missing.length / claimed.length;
  const status: IdentityStatus = missing.length >= 3 && ratio >= 0.5 ? "risk" : missing.length <= 1 || ratio <= 0.34 ? "ok" : "warn";
  const why = missing.length
    ? `${found} of ${claimed.length} claimed skills show up in their own repos. Not found: ${missing.slice(0, 6).join(", ")}.`
    : `All ${claimed.length} claimed skills show up in their own repos.`;
  return { ...base, status, why };
}

// ---------- Check 5: copied / template profile text ----------
const BUZZ = ["results-driven", "results driven", "passionate", "proven track record", "leverag", "cutting-edge", "cutting edge", "dynamic", "fast-paced", "synerg", "spearhead", "cross-functional", "high-impact", "detail-oriented", "self-starter", "team player", "go-getter", "innovative", "robust", "scalable", "data-driven", "best-in-class", "thought leader", "seamless", "drive impact", "hit the ground running"];

/** Long sentences repeated word for word (e.g. under two different jobs). */
export function repeatedLines(text: string): string[] {
  const seen = new Map<string, { raw: string; n: number }>();
  text.split(/(?<=[.!?])\s+|\n+/).forEach((s) => {
    const raw = s.trim();
    const k = norm(raw).trim();
    if (k.split(" ").length < 6) return;
    const e = seen.get(k);
    seen.set(k, { raw: e?.raw ?? raw, n: (e?.n ?? 0) + 1 });
  });
  return [...seen.values()].filter((e) => e.n > 1).map((e) => e.raw);
}

export function textHeuristic(text: string): { score: number; buzz: string[]; repeats: string[] } {
  const lower = text.toLowerCase();
  const buzz = BUZZ.filter((b) => lower.includes(b));
  const wordsN = Math.max(1, lower.split(/\s+/).length);
  const density = (buzz.length / wordsN) * 100; // buzzwords per 100 words
  const repeats = repeatedLines(text);
  return { score: Math.min(1, density / 6 + repeats.length * 0.4), buzz, repeats };
}

export function checkCopiedText(text: string, rating: TextRating | null): IdentityCheck {
  const base = { id: "copied_text" as const, label: "Copied or template wording" };
  if (text.trim().split(/\s+/).length < 25) return { ...base, status: "unknown", why: "Paste their LinkedIn About + Experience (or resume) to check the wording." };
  const h = textHeuristic(text);
  const score = Math.max(h.score, rating?.score ?? 0);
  const notes: string[] = [];
  if (h.repeats.length) notes.push(`the same sentence appears under different roles: "${clip(h.repeats[0], 90)}"`);
  const seen = h.repeats.map((r) => norm(r).slice(0, 30));
  rating?.lines
    .filter((l) => !seen.some((k) => norm(l.text).startsWith(k)))
    .slice(0, 2)
    .forEach((l) => notes.push(`"${clip(l.text, 70)}" (${l.why})`));
  if (h.buzz.length >= 3) notes.push(`buzzwords: ${h.buzz.slice(0, 5).join(", ")}`);
  const status: IdentityStatus = h.repeats.length || score >= 0.7 ? "risk" : score >= 0.4 ? "warn" : "ok";
  if (status === "ok") return { ...base, status, why: "Wording reads specific and personal; no repeated or template lines." };
  return { ...base, status, why: cap(`${Math.round(score * 100)}% generic. ${cap(notes.join("; "))}.`) };
}

// ---------- Check 6: activity shape ----------
export function checkActivity(gh: GithubFacts | null): IdentityCheck {
  const base = { id: "activity" as const, label: "GitHub activity shape" };
  if (!gh) return { ...base, status: "unknown", why: "No GitHub account to check." };
  const own = gh.repos.filter((r) => !r.fork);
  const forks = gh.repos.length - own.length;
  const ageYrs = (Date.now() - Date.parse(gh.createdAt)) / 31557600000;
  if (!gh.repos.length && !gh.events.length) return { ...base, status: "warn", why: "Near-empty profile: no public repos and no recent activity." };
  if (!own.length) return { ...base, status: "risk", why: `All ${forks} public repos are forks of other people's projects; nothing of their own.` };
  const recent = own.filter((r) => Date.now() - Date.parse(r.createdAt) < 60 * 86400000);
  const burst = ageYrs > 1 && own.length >= 2 && recent.length / own.length >= 0.7;
  const pushDays = gh.events.map((e) => Date.parse(e.createdAt)).sort((a, b) => a - b);
  const spanDays = pushDays.length ? Math.round((pushDays[pushDays.length - 1] - pushDays[0]) / 86400000) : 0;
  const forkHeavy = forks / gh.repos.length >= 0.6;
  const notes: string[] = [];
  if (burst) notes.push(`${recent.length} of ${own.length} own repos were created in the last 2 months on a ${Math.floor(ageYrs)}-year-old account`);
  if (forkHeavy) notes.push(`${forks} of ${gh.repos.length} repos are forks`);
  if (burst && pushDays.length >= 10 && spanDays <= 21) notes.push(`all ${pushDays.length} recent events fall within ${spanDays} days`);
  if (!notes.length) return { ...base, status: "ok", why: `${own.length} own repos${forks ? ` (+${forks} fork${forks === 1 ? "" : "s"})` : ""}, activity spread over ${Math.max(1, Math.round(spanDays / 7))} weeks.` };
  return { ...base, status: burst && forkHeavy ? "risk" : "warn", why: cap(`${notes.join("; ")}. Looks set up right before applying.`) };
}

// ---------- Verification questions ----------
export function verifyQuestions(checks: IdentityCheck[], gh: GithubFacts | null, st: Stage, input: IdentityRequest, text: string): string[] {
  const off = (id: IdentityCheck["id"]) => checks.find((c) => c.id === id && (c.status === "risk" || c.status === "warn"));
  const out: string[] = [];
  const school = st.school ? ` at ${shortSchool(st.school)}` : "";
  if (off("timeline_account") && gh) out.push(`Your GitHub account goes back to ${yearOf(gh.createdAt)}. What was the first thing you ever pushed to it?`);
  if (off("timeline_resume")) {
    const job = parseEntries(text).find((e) => !e.edu && !e.partTime);
    out.push(job ? `Walk me through a normal week as "${job.title}". Who did you report to, and how did it fit around school?` : "Walk me through your dates: where were you working and studying each year?");
  }
  if (off("location")) out.push(`What part of ${input.claimedLocation?.split(",")[0] || "town"} do you live in, and how do you usually get to ${school ? "campus" : "work"}?`);
  if (off("skills")) {
    const t = TECH.find(([, re]) => re.test(text))?.[0];
    out.push(`You list ${t ?? "a lot of tools"}. What's one thing you built with it, and what broke the first time?`);
  }
  if (off("copied_text")) {
    const line = repeatedLines(text)[0] ?? text.split(/(?<=[.!?])\s+/).find((s) => BUZZ.some((b) => s.toLowerCase().includes(b)));
    if (line) out.push(`Your profile says "${clip(line.trim().replace(/[.!?]$/, ""), 90)}". Tell me about one specific day when that happened.`);
  }
  if (off("activity")) out.push("Most of your repos are new. What were you coding before this, and where does that code live?");
  // Always enough to verify identity even when nothing was found
  out.push(`Which professor did you have for data structures${school}, and what were their exams like?`);
  out.push(`What's the building where most of your CS classes are${school}, and what's nearby to eat?`);
  out.push("Who's someone you've built a project with, and what did they think of your code?");
  return [...new Set(out)].slice(0, 5);
}

const shortSchool = (s: string) => s.replace(/,?\s*(b\.?s\.?|b\.?a\.?|bachelor|master|m\.?s\.?).*/i, "").replace(/\s*·.*/, "").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n)).replace(/[,;:]$/, "")}…`);
const cap = (s: string) => {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return t.length > 260 ? `${t.slice(0, 257)}…` : t;
};

// ---------- Putting it together ----------
const WEIGHT: Record<IdentityStatus, number> = { risk: 30, warn: 12, ok: 0, unknown: 0 };

export function buildIdentityReport(gh: GithubFacts | null, input: IdentityRequest, rating: TextRating | null, sources: Pick<IdentityReport, "githubSource" | "textSource" | "matches">): IdentityReport {
  const text = input.pastedText ?? "";
  const entries = parseEntries(text);
  const st = careerStage(text, input, entries);
  const checks = [
    checkAccountTimeline(gh, st, !!text.trim()),
    checkResumeTimeline(text, st, entries),
    checkLocation(gh, input, st, text),
    checkSkills(gh, text),
    checkCopiedText(text, rating),
    checkActivity(gh),
  ];
  const score = Math.min(100, checks.reduce((a, c) => a + WEIGHT[c.status], 0));
  const risks = checks.filter((c) => c.status === "risk").length;
  const known = checks.filter((c) => c.status !== "unknown").length;
  // Same rule as live flags: the strongest headline needs 2+ independent checks
  const level: IdentityReport["level"] = risks >= 2 ? "inconsistent" : risks || score >= 20 || !known ? "mixed" : "consistent";
  const headline = !known
    ? "Not enough to check yet"
    : { consistent: "Profile looks consistent", mixed: "A few things don't line up", inconsistent: "Strong signs this profile isn't theirs" }[level];
  return { score, level, headline, checks, questions: verifyQuestions(checks, gh, st, input, text), ...sources };
}

/** Fixture GitHub facts → the profile card's shape, so demo candidates work offline. */
export function factsToProfile(gh: GithubFacts): CandidateProfile {
  const own = gh.repos.filter((r) => !r.fork);
  const langs: Record<string, number> = {};
  own.forEach((r) => r.language && (langs[r.language] = (langs[r.language] ?? 0) + 1));
  const total = Object.values(langs).reduce((a, b) => a + b, 0) || 1;
  const cutoff = Date.now() - 90 * 86400000;
  return {
    login: gh.login,
    name: gh.name,
    avatarUrl: gh.avatarUrl,
    accountAgeYrs: Math.round(((Date.now() - Date.parse(gh.createdAt)) / 31557600000) * 10) / 10,
    publicRepos: gh.publicRepos,
    topLanguages: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([lang, n]) => ({ lang, pct: Math.round((n / total) * 100) / 100 })),
    repos: own.map((r) => ({ name: r.name, description: r.description, language: r.language, stars: 0, lastPush: r.pushedAt, url: `https://github.com/${gh.login}/${r.name}` })),
    commitsLast90d: gh.events.filter((e) => e.type === "PushEvent" && Date.parse(e.createdAt) > cutoff).length,
    source: "fallback",
  };
}
