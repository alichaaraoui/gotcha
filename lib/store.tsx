"use client";
// Client state for the whole app: the current session + interview memory (learning).
// Persists to localStorage so a refresh mid-demo doesn't lose anything.
// OWNER: shared. Add actions here rather than keeping parallel state in pages.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Flag, KnownAiAnswer, PastInterview, Question, Score, Session, Track, Verdict, Weights, AnswerEvent, GazeWindow, CandidateProfile, PinnedClaim } from "@/lib/types";
import tracksJson from "@/data/tracks.json";
import seedHistory from "@/data/past_interviews.json";
import seedKnownAi from "@/data/known_ai_answers.json";
import { learnWeights, orderTrack, sessionToPast } from "@/lib/learning";

export const TRACKS = tracksJson as Track[];

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
  removeQuestion: (qid: string) => void;
  markAsked: (qid: string) => void;
  recordAnswer: (e: AnswerEvent, g: GazeWindow | null, sc: Score) => void;
  addFlag: (f: Omit<Flag, "id">) => Flag;
  patchFlag: (id: string, patch: Partial<Flag>) => void;
  addClaim: (c: PinnedClaim) => void;
  setVerdict: (flagId: string, v: Verdict) => void;
  finishInterview: () => void; // saves the session into interview memory → weights relearn
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(blankSession);
  const [savedHistory, setSavedHistory] = useState<PastInterview[]>([]);
  const [savedKnownAi, setSavedKnownAi] = useState<KnownAiAnswer[]>([]);

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSession(load("unscripted.session", blankSession()));
    setSavedHistory(load("unscripted.history", []));
    setSavedKnownAi(load("unscripted.knownAi", []));
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

  const store: Store = {
    session, track, history, knownAi, weights, update,
    setProfile: (p) => update((s) => ({ ...s, profile: p })),
    setTrack: (id) => update((s) => ({ ...s, trackId: id })),
    addQuestions: (qs) => update((s) => ({ ...s, questions: [...s.questions.filter((q) => !qs.some((n) => n.id === q.id)), ...qs] })),
    // The interview clock starts at the first question asked (used for "minutes to first flag")
    removeQuestion: (qid) => update((s) => ({ ...s, questions: s.questions.filter((q) => q.id !== qid) })),
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
      const { past, newKnownAi } = sessionToPast(session, knownAi);
      const h = [...savedHistory.filter((x) => x.id !== past.id), past];
      const k = [...savedKnownAi.filter((x) => !newKnownAi.some((n) => n.id === x.id)), ...newKnownAi];
      setSavedHistory(h);
      setSavedKnownAi(k);
      save("unscripted.history", h);
      save("unscripted.knownAi", k);
    },
    // New candidate: keep the recruiter's track and checklist choices
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
  // A session question with a track question's id (e.g. /api/questions' personalized be-p1) replaces it in place
  const byId = new Map(session.questions.map((q) => [q.id, q]));
  const base = track.stages.flatMap((s) => s.questions).map((q) => byId.get(q.id) ?? (repo && q.text.includes("{repo}") ? { ...q, text: q.text.replace("{repo}", repo), repoRef: repo } : q));
  return [...base, ...session.questions.filter((q) => !base.some((b) => b.id === q.id))];
}
