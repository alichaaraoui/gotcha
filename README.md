# GotCha: live interview co-pilot

A recruiter side panel that spots AI-assisted answers in live technical interviews and suggests what to ask next. The tool suggests; the recruiter decides. No auto-rejection.

## Run
```
npm install
cp .env.example .env.local   # add GROQ_API_KEY (free at console.groq.com); works without it via local fallback
npm run dev                  # http://localhost:3000  (Chrome only: Web Speech API)
node scripts/score-demo.mjs  # offline: risk per answer for both demo candidates, exit 1 if off-target
```
`score-demo.mjs` imports the real scorer (no server needed) and replays each candidate 30× with the same word-timing jitter as replay mode. Flags: `--verbose` (every signal + suggestion), `--gaze` (webcam path), `--stt` (simulated live Chrome mic: no punctuation, bursty word stamps), `--url http://localhost:3000` (through `/api/score`, uses Groq if keyed). Re-run it after touching anything in `lib/scoring/`.

## Who owns what (search the code for TODO(P1/P2/P3))
| Person | Owns |
|---|---|
| **P1 · Ali: Live Room + tracks** | `app/page.tsx`, `app/live/page.tsx`, `lib/speech.ts`, `components/*` except EyePanel |
| **P2: Scoring engine + APIs** | `app/api/*`, `lib/github.ts`, `lib/groq.ts`, `lib/scoring/*`, `lib/learning.ts` |
| **P3: Eyes + report + learning UI** | `lib/eyes.ts`, `lib/clips.ts`, `components/EyePanel.tsx`, `app/report`, `app/insights`, `scripts/seed-past-interviews.mjs` |

**`lib/types.ts` is the shared contract.** Don't change a shape without telling the other two. `lib/store.tsx` is shared state; add actions there.

## Rules from the brief
- GitHub REST is the ONE live call → cached in `data/cache/` → fallback `data/fixtures/github_fallback.json`
- Adzuna: cached only (`data/adzuna_cache.json`). Groq: server routes only, with a timeout and a local fallback
- Must work with the Wi-Fi off. Replay mode (`data/demo_scripts.json`) for when the mic fails
- Never say "cheater" in the UI. A red flag needs 2+ detection methods

## Flags
20% Watch · 50% Warning (check GitHub, follow-up) · 75% Test now (probe track, clip saved). Max 5 live prompts; the rest become "review later".

## How the risk % works (P2)
`lib/scoring/score.ts` → `signals.ts` (each method 0..1) → `fuse.ts`. Methods under 0.2 count as noise and add nothing; the rest add evidence × learned weight, saturating toward 100%. The 3 eye methods are one webcam, so they share a family (no triple-counting). Each answer is scaled by how much its question *can* prove: easy 0.35, hard 0.55, probe/trap 1.0 (polished intros are normal; own-code and trap questions are hard to fake). Guardrails: warm-up answers max out at Watch (they are the baseline), Warning needs 1+ method firing (≥0.6), red needs 2+. A known-AI-answer match jumps straight to Warning. Groq's style verdict is blended 50/50 with the local heuristic so one odd LLM reply can't swing the demo.

## 11 detection methods
Eyes: reading sweeps, off-screen gaze, vs. warm-up baseline · Voice: latency vs. baseline, pause pattern, steady speaking rate · Content: AI shadow-answer similarity, LLM style (Groq), GitHub mismatch, easy vs. hard · Manual: environment checklist + F hotkey

## Checkpoints
1:30 full interview end to end · 2:45 feature freeze · 3:00 backup video · 3:20 pitch rehearsal
