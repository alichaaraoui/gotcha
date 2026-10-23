"use client";
// Client state for the whole app: the current session + interview memory (learning).
// Persists to localStorage so a refresh mid-demo doesn't lose anything.
// OWNER: shared. Add actions here rather than keeping parallel state in pages.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AiAnswer, Gotcha, Flag, KnownAiAnswer, PastInterview, Question, Score, Session, Track, Verdict, Weights, AnswerEvent, GazeWindow, CandidateProfile, PinnedClaim } from "@/lib/types";
import tracksJson from "@/data/tracks.json";
import seedHistory from "@/data/past_interviews.json";
import seedKnownAi from "@/data/known_ai_answers.json";
import aiLibrary from "@/data/ai_answers.json";
import { learnWeights, orderTrack, sessionToPast } from "@/lib/learning";

export const TRACKS = tracksJson as Track[];

/** Research library: every question answered by several AI models (scripts/build-ai-library.mjs). */
export const AI_LIBRARY = aiLibrary as Record<string, { question: string; topic: string; answers: AiAnswer[] }>;

/** A few starters so Sarah's bank isn't empty on day one. */
const STARTER_GOTCHAS: Gotcha[] = [
  { id: "g-1", text: "Explain that last answer again, but to a 10-year-old.", topic: "Any", style: "curveball", realAnswer: "Real people simplify their own words easily. Read-out answers fall apart.", createdAt: 0 },
  { id: "g-2", text: "What's something about that approach you actually dislike?", topic: "Any", style: "curveball", realAnswer: "Genuine engineers have opinions and small grudges. AI stays balanced and neutral.", createdAt: 0 },
  { id: "g-3", text: "Same problem, but you only have one afternoon and no budget. What changes?", topic: "System design", style: "constraint-change", realAnswer: "A quick, honest 'I'd cut X' reaction. Relays lag ~2s then sound polished.", createdAt: 0 },
  { id: "g-4", text: "Have you used the --preserve-order flag in Kafka Streams 4? How did it go?", topic: "Backend", style: "knowledge-boundary", realAnswer: "That flag doesn't exist. Honest people say they haven't heard of it.", createdAt: 0 },
  { id: "g-5", text: "Which file in your project would you be most embarrassed for me to open, and why?", topic: "Any", style: "own-code", realAnswer: "They name it instantly and laugh a little. AI gives a generic 'legacy module' answer.", createdAt: 0 },
];

const blankSession = (): Session => ({
  id: `s-${Date.now()}`,
  startedAt: Date.now(),
  profile: null,
  trackId: TRACKS[0].id,
  trackPath: [],
  questions: [],
  events: [],
  gaze: [],
  scores: [],
  flags: [],
  checklist: { earpiece: false, glassesReflection: false, virtualBackground: false, idShown: true },
  claims: [],
  verdicts: {},
});

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

interface Store {
  session: Session;
  track: Track; // ordered by learned question ranking
  history: PastInterview[];
  knownAi: KnownAiAnswer[];
  weights: Weights;
  update: (fn: (s: Session) => Session) => void;
  setProfile: (p: CandidateProfile) => void;
  setTrack: (id: string) => void;
  addQuestions: (qs: Question[]) => void;
  markAsked: (qid: string) => void;
  recordAnswer: (e: AnswerEvent, g: GazeWindow | null, sc: Score) => void;
  addFlag: (f: Omit<Flag, "id">) => Flag;
  patchFlag: (id: string, patch: Partial<Flag>) => void;
  addClaim: (c: PinnedClaim) => void;
  setVerdict: (flagId: string, v: Verdict) => void;
  finishInterview: () => void; // saves the session into interview memory → weights relearn
  gotchas: Gotcha[];
  saveGotcha: (g: Gotcha) => void; // add or update
  removeGotcha: (id: string) => void;
  importGotchas: (pasted: string) => number; // one question per line, e.g. pasted from a Google Doc
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(blankSession);
  const [savedHistory, setSavedHistory] = useState<PastInterview[]>([]);
  const [savedKnownAi, setSavedKnownAi] = useState<KnownAiAnswer[]>([]);
  const [gotchas, setGotchas] = useState<Gotcha[]>(STARTER_GOTCHAS);

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSession(load("unscripted.session", blankSession()));
    setSavedHistory(load("unscripted.history", []));
    setSavedKnownAi(load("unscripted.knownAi", []));
    setGotchas(load("gotcha.bank", STARTER_GOTCHAS));
    setHydrated(true);
  }, []);
  // Only save after loading, or the blank first render overwrites the saved session
  useEffect(() => {
    if (hydrated) save("unscripted.session", session);
  }, [session, hydrated]);

  const history = useMemo(() => [...(seedHistory as PastInterview[]), ...savedHistory], [savedHistory]);
  const knownAi = useMemo(() => [...(seedKnownAi as KnownAiAnswer[]), ...savedKnownAi], [savedKnownAi]);
  const weights = useMemo(() => learnWeights(history), [history]);
  const track = useMemo(() => orderTrack(TRACKS.find((t) => t.id === session.trackId) ?? TRACKS[0], history), [session.trackId, history]);

  const update = useCallback((fn: (s: Session) => Session) => setSession((s) => fn(s)), []);
  const saveGotchas = (g: Gotcha[]) => {
    setGotchas(g);
    save("gotcha.bank", g);
  };

  const store: Store = {
    session, track, history, knownAi, weights, update,
    setProfile: (p) => update((s) => ({ ...s, profile: p })),
    setTrack: (id) => update((s) => ({ ...s, trackId: id })),
    addQuestions: (qs) => update((s) => ({ ...s, questions: [...s.questions.filter((q) => !qs.some((n) => n.id === q.id)), ...qs] })),
    // The interview clock starts at the first question asked (used for "minutes to first flag")
    markAsked: (qid) => update((s) => (s.trackPath.includes(qid) ? s : { ...s, startedAt: s.trackPath.length ? s.startedAt : Date.now(), trackPath: [...s.trackPath, qid] })),
    recordAnswer: (e, g, sc) =>
      update((s) => ({
        ...s,
        events: [...s.events.filter((x) => x.questionId !== e.questionId), e],
        gaze: g ? [...s.gaze.filter((x) => x.questionId !== g.questionId), g] : s.gaze,
        scores: [...s.scores.filter((x) => x.questionId !== sc.questionId), sc],
      })),
    addFlag: (f) => {
      const flag = { ...f, id: `f-${Date.now()}-${Math.round(Math.random() * 1000)}` };
      update((s) => ({ ...s, flags: [...s.flags, flag] }));
      return flag;
    },
    patchFlag: (id, patch) => update((s) => ({ ...s, flags: s.flags.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
    addClaim: (c) => update((s) => ({ ...s, claims: [...s.claims, c] })),
    setVerdict: (flagId, v) => update((s) => ({ ...s, verdicts: { ...s.verdicts, [flagId]: v } })),
    finishInterview: () => {
      const { past, newKnownAi } = sessionToPast(session);
      const h = [...savedHistory.filter((x) => x.id !== past.id), past];
      const k = [...savedKnownAi.filter((x) => !newKnownAi.some((n) => n.id === x.id)), ...newKnownAi];
      setSavedHistory(h);
      setSavedKnownAi(k);
      save("unscripted.history", h);
      save("unscripted.knownAi", k);
    },
    // New candidate: keep the recruiter's track and checklist choices
    gotchas,
    saveGotcha: (g) => saveGotchas([g, ...gotchas.filter((x) => x.id !== g.id)]),
    removeGotcha: (id) => saveGotchas(gotchas.filter((x) => x.id !== id)),
    importGotchas: (pasted) => {
      const seen = new Set(gotchas.map((g) => g.text.toLowerCase()));
      const fresh = pasted
        .split("\n")
        .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, "").trim()) // strip bullets / numbering
        .filter((l) => l.length > 8 && !seen.has(l.toLowerCase()))
        .map((text, i) => ({ id: `g-${Date.now()}-${i}`, text, topic: "Imported", style: "other" as const, realAnswer: "", createdAt: Date.now() }));
      saveGotchas([...fresh, ...gotchas]);
      return fresh.length;
    },
    reset: () => setSession((s) => ({ ...blankSession(), trackId: s.trackId, checklist: s.checklist })),
  };

  // Render nothing until localStorage is loaded so pages never flash "no candidate"
  return <Ctx.Provider value={store}>{hydrated ? children : null}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** All questions available right now: the ordered track + personalized + custom, with {repo} filled. */
export function allQuestions(track: Track, session: Session): Question[] {
  const repo = session.profile?.repos[0]?.name;
  const base = track.stages.flatMap((s) => s.questions).map((q) => (repo && q.text.includes("{repo}") ? { ...q, text: q.text.replace("{repo}", repo), repoRef: repo } : q));
  return [...base, ...session.questions].map((q) => (AI_LIBRARY[q.id] && !q.aiAnswers ? { ...q, aiAnswers: AI_LIBRARY[q.id].answers } : q));
}

/** Turn one of Sarah's gotchas into an askable question. */
export function gotchaToQuestion(g: Gotcha): Question {
  return {
    id: `gq-${g.id}`,
    text: g.text,
    kind: g.style === "knowledge-boundary" ? "trap" : "probe",
    stage: "probe",
    topic: g.topic,
    probeStyle: g.style === "own-code" ? "own-code" : g.style === "constraint-change" ? "constraint-change" : g.style === "knowledge-boundary" ? "knowledge-boundary" : undefined,
    shadowAnswer: "",
    goodAnswerHint: g.realAnswer || "Listen for specifics and a natural, unrehearsed reaction.",
  };
}
