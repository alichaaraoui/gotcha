// THE SHARED CONTRACT. Agreed by all three in the first 20 minutes.
// Change a shape here only after telling the other two.

// ---------- Candidate ----------
export interface Repo {
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  lastPush: string; // ISO date
  url: string;
}

export interface CandidateProfile {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  linkedinUrl?: string;
  accountAgeYrs: number;
  publicRepos: number;
  topLanguages: { lang: string; pct: number }[];
  repos: Repo[];
  commitsLast90d: number;
  marketDemand?: MarketDemand; // from cached Adzuna data
  source: "live" | "cache" | "fallback";
}

export interface MarketDemand {
  role: string;
  medianSalaryUsd: number;
  openings: number;
  hotSkills: string[];
  difficulty: "junior" | "mid" | "senior";
}

// ---------- Questions and tracks ----------
export type StageId = "warmup" | "core" | "deep" | "probe" | "wrap";
export type QuestionKind = "easy" | "hard" | "probe" | "trap" | "custom";
export type ProbeStyle = "own-code" | "constraint-change" | "polygraph-pair" | "knowledge-boundary";

export interface Question {
  id: string;
  text: string;
  kind: QuestionKind;
  stage: StageId;
  topic: string; // e.g. "caching", used by "Go deeper"
  shadowAnswer: string; // what an AI would say
  goodAnswerHint: string; // plain English, for recruiters who aren't engineers
  probeStyle?: ProbeStyle;
  repoRef?: string; // personalized from GitHub
  followUps?: string[]; // ids for "Go deeper"
  why?: string; // for suggested ideas: what this question reveals, in a few words
  aiAnswers?: AiAnswer[]; // the same question answered by several AI models (research library)
}

export interface AiAnswer {
  model: string; // e.g. "GPT-OSS 120B"
  text: string;
}

// Sarah's private bank of off-script questions (her Google Doc, digitized)
export interface Gotcha {
  id: string;
  text: string;
  topic: string;
  style: "curveball" | "constraint-change" | "knowledge-boundary" | "own-code" | "other";
  realAnswer: string; // what a genuine answer sounds like
  createdAt: number;
}

export interface Stage {
  id: StageId;
  label: string;
  questions: Question[];
}

export interface Track {
  id: string;
  name: string;
  role: string;
  stages: Stage[];
}

// ---------- Live data ----------
export interface WordStamp {
  w: string;
  t: number; // ms since epoch
}

export interface AnswerEvent {
  questionId: string;
  transcript: string;
  words: WordStamp[];
  askedAt: number; // when Sarah finished asking
  firstWordAt: number | null;
  endedAt: number;
}

export interface GazeWindow {
  questionId: string;
  offScreenPct: number; // 0..1 of answer time looking away
  readingSweeps: number; // left-to-right sweeps per minute
  sideBias: number; // -1 left .. 1 right, sustained same-side glance
  blinkRate: number; // blinks per minute
  baselineDelta: number; // 0..1, how far this is from the warm-up baseline
}

// The 11 detection methods
export type MethodId =
  | "eye_reading" // 1
  | "eye_offscreen" // 2
  | "eye_baseline" // 3
  | "latency" // 4
  | "pauses" // 5
  | "steady_rate" // 6
  | "ai_similarity" // 7
  | "llm_style" // 8
  | "github_mismatch" // 9
  | "easy_vs_hard" // 10
  | "manual"; // 11 (checklist + hotkey)

export interface Signal {
  method: MethodId;
  value: number; // 0..1, how suspicious
  why: string; // plain English
}

export type Level = "clear" | "watch" | "warn" | "flag";

export interface Score {
  questionId: string;
  risk: number; // 0..100
  level: Level;
  signals: Signal[];
  methodsFiring: number; // signals >= 0.6; flag needs >= 2
  knownAiMatch?: { id: string; similarity: number };
  suggestedQuestionId?: string;
  suggestedText?: string; // plain-English nudge for Sarah
}

export interface Flag {
  id: string;
  questionId: string;
  at: number;
  level: Level;
  type: "live" | "later";
  source: "auto" | "manual";
  note?: string;
  clipUrl?: string; // object URL of the rolling clip
  snapshot?: string; // data URL frame
}

export interface Checklist {
  earpiece: boolean;
  glassesReflection: boolean;
  virtualBackground: boolean;
  idShown: boolean;
}

export type Verdict = "genuine" | "suspicious";

export interface PinnedClaim {
  text: string; // e.g. "5 yrs Kafka at Stripe"
  supportedByGithub: boolean | null;
  suggestedQuestion: string;
}

export interface Session {
  id: string;
  startedAt: number;
  profile: CandidateProfile | null;
  trackId: string;
  trackPath: string[]; // question ids in the order asked
  questions: Question[]; // track + personalized + custom
  events: AnswerEvent[];
  gaze: GazeWindow[];
  scores: Score[];
  flags: Flag[];
  checklist: Checklist;
  claims: PinnedClaim[];
  verdicts: Record<string, Verdict>; // keyed by flag id
  identity?: IdentityReport; // Setup: does the profile hold together?
}

// ---------- Learning from past interviews ----------
export interface PastInterview {
  id: string;
  date: string;
  trackId: string;
  outcome: Verdict; // what the interview was finally judged as
  minutesToFirstFlag: number | null;
  questionsAsked: { questionId: string; risk: number }[];
  flags: { method: MethodId; verdict: Verdict }[]; // each flag's top method and Sarah's verdict
}

export interface KnownAiAnswer {
  id: string;
  questionId: string;
  text: string;
  seenCount: number;
}

export type Weights = Record<MethodId, number>;

// ---------- API payloads ----------
export interface ProfileRequest {
  login: string;
  role: string;
  linkedinUrl?: string;
}

export interface QuestionsRequest {
  profile: CandidateProfile;
  trackId: string;
  custom?: string; // "Ask your own": generate a shadow answer for this text
  // "Push for more": write one follow-up from their GitHub + the answer that looked off
  followUp?: { question: string; answer: string; level: Level; reasons: string[] };
  // "Dig deeper" panel: several ready-to-ask ideas about one repo, or about their last answer
  ideas?: { focus: "github" | "answer"; repo?: string; lastQuestion?: string; lastAnswer?: string };
}

export interface QuestionsResponse {
  personalized: Question[];
  source: "groq" | "fallback";
}

export interface ScoreRequest {
  question: Question;
  event: AnswerEvent;
  gaze: GazeWindow | null;
  baseline: { latencyMs: number; wpm: number; gaze: GazeWindow | null } | null;
  easyVsHard: { easyLatencyMs: number; easyWpm: number } | null;
  profile: CandidateProfile | null;
  checklist: Checklist;
  weights: Weights;
  knownAi: KnownAiAnswer[];
}

// ---------- Identity consistency (Setup) ----------
export type IdentityStatus = "ok" | "warn" | "risk" | "unknown";

export interface IdentityCheck {
  id: "timeline_account" | "timeline_resume" | "location" | "skills" | "copied_text" | "activity";
  label: string;
  status: IdentityStatus;
  why: string; // plain English
}

/** What the recruiter already has: pasted LinkedIn/resume text and what the candidate claims. LinkedIn stays view-only. */
export interface IdentityRequest {
  login?: string;
  fullName?: string;
  email?: string;
  pastedText?: string; // LinkedIn About + Experience + Education, and/or resume
  claimedLocation?: string;
  claimedSchool?: string;
  gradYear?: number;
}

/** A GitHub account that might be theirs. Shown for the recruiter to confirm, never linked automatically. */
export interface GithubMatch {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  location: string | null;
  createdAt: string | null;
  url: string;
  why: string; // how we found it
}

export interface IdentityReport {
  score: number; // 0..100, higher = more that doesn't line up
  level: "consistent" | "mixed" | "inconsistent";
  headline: string;
  checks: IdentityCheck[];
  questions: string[]; // to verify identity in the interview
  matches?: GithubMatch[];
  githubSource: "live" | "cache" | "fixture" | "none";
  textSource: "groq" | "heuristic" | "none";
}
