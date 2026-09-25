# Plan: Exercise Applet (offline phone PWA for training + bulk/cut tracking)

## Context
You want the single-user tracker described in `Training & Bulk Cut Plan Findings and Applet Spec.md` (the only file in the folder). It logs workouts, bodyweight and nutrition, applies every rule in the spec, never overwrites history, and exports CSV. It will live in the empty public repo https://github.com/throbbingmember69/Exersise-Applet. There's no code yet.

On this machine: Git 2.55 with Credential Manager, Python 3.13 and winget are installed. Node.js is missing, and git user.name/email aren't set. A read-only audit of the spec (3 lenses plus a verifier) turned up 55 confirmed ambiguities. You decided the architectural ones; the rest use the defaults below.

## Your decisions
| Topic | Decision |
|---|---|
| Platform | Installable, offline-first Android PWA, hosted on GitHub Pages at `throbbingmember69.github.io/Exersise-Applet/` |
| Data | One device, IndexedDB. Full JSON backup/restore, plus the spec's 3 CSV exports. No cloud sync. |
| Stack | Vite + React 19 + TypeScript (strict) + Dexie 4 + Vitest |
| Repo | Public. Commit everything, including the spec. Seed data uses your real stats. |
| Progression | Separate track per program day. Track key = (day, exercise, gym scope). e1RM/stall series pool across days. |
| Exercise swapping | The program is a set of slots (sets, rep range, RIR, rest). Any library exercise can fill a slot. "X or Y" rows become a default exercise plus alternates. Swaps can be one-off (logger) or permanent (editor). |
| Gym profiles | Saved gyms, each with its own slot→exercise overrides. Machine/cable tracks are separate per gym; barbell/dumbbell/bodyweight-plus tracks are shared. Per-exercise `equipmentSpecific` override. |
| Past sessions | Read-only. An explicit "Edit session" (with confirm) fixes typos, and delete is a soft void (restorable). All suggestions are derived from history, never stored as mutable state. |
| Main lifts | Smith squat, deadlift, incline DB bench, OHP, weighted chin-up (total-load e1RM). Editable flag. |
| Volume flags | Per-muscle bands (default 10–20). Front delts, calves and abs are exempt from "low". |
| Diet breaks | Not in v1. The model reserves `parentPhaseId` and check-in "pauses" so they can be added later. |
| Timer alerts | Android: vibrate + sound + a service-worker notification when backgrounded. Timestamp-based. Screen wake lock during sessions. |
| Git identity | Repo-local, using your GitHub noreply email (confirmed with you before the first commit) |

**Correction:** chin-up e1RM uses bodyweight + added load. On a cut, bodyweight loss alone lowers it by about 1–1.5% over 3 weeks (at 1 lb/week), well under the 5% strength-slide trigger.

## Defaults adopted for spec gaps (all editable settings, tagged Evidence/Heuristic)
- **Flowchart:** evaluate exactly the prescribed working sets. Reps ≥ repMax means top; reps < repMin means below; missing sets are "not top" but not "below". Warm-ups (an `isWarmup` flag) are excluded everywhere. The base load is the lowest working load, with a notice if loads were mixed. The miss streak resets after a clean session, a drop, a load change or a deload.
- **Drop and deload:** drop = max(1, floor(10% × load / step)) steps (220→200, 40→37.5, +50→+45). A deload = ceil(sets/2) sets at −10% load for one 5-session cycle. It's triggered by ≥3 concurrent stalls, joint pain flagged in 2 of the last 3 sessions, or a manual button. Deload sessions are skipped in progression.
- **Stall:** the best metric in the last 3 sessions is no higher than the earlier best. The metric is e1RM, or reps-at-load when repMax > 12. Stalls show as a flag plus advisory text.
- **Rep targets:** min(last reps + 1, repMax) per set. repMin after a step or drop. RIR left blank. Rest stored as min/max (a "2–3 min" rest alerts at 2:00 and 3:00).
- **Calibration:** "Set in week 1" slots (flat press, BSS) start blank, and their first session is calibration. Six exercises whose rep ranges changed (machine fly, lateral raise, rear delt fly, face pull, dip machine, deadlift) get a "recalibrate" badge.
- **Nutrition:** maintenance = average(Katch-McArdle, Mifflin-St Jeor) × 1.55. The phase kcal offset comes from the rate-band midpoint, which gives 2,700 / 3,000 / 2,200 for the seed profile. kcal is rounded to 50 and protein to 5 g (bulk and maintenance 2.0 g/kg bodyweight, cut 2.7 g/kg lean mass). Fat is 25%, and carbs fill the rest. The next phase's targets are always proposed for you to confirm; nothing starts automatically ("Start lean bulk" card).
- **Trend and TDEE:** EMA (α 0.1) over calendar days with interpolated gaps; T0 = the first real weigh-in. Measured TDEE uses the longest 14–21-day window with ≥80% of kcal and weigh-ins logged, excluding the first 7 days of a phase. The ±150 cap applies only to week-over-week TDEE estimate changes.
- **Check-ins:** every 7 days from the phase start. Week 1 is excluded. A change needs 2 consecutive misses in the same direction, and the streak resets after an accepted change. Steps are 150 kcal on a bulk or cut and 100 on maintenance. A cut also offers "+2,000 steps instead". Accepted changes are stored as dated `TargetRevision` rows (append-only).
- **Body fat:** the mean of the last 3 readings within 28 days (needs ≥2). It only prompts phase switches. Soft prompt at the planned length (bulk 20, cut 14 weeks), firm prompt at the maximum (26/16) or on a body-fat or strength trigger. Maintenance lasts 4 weeks.
- **Units:** everything is stored in lb at full precision, and only formatters round. Dates are local `YYYY-MM-DD` strings. CSVs use lb and ISO dates, and exclude voided rows.

## Architecture
**Libraries:**
- react-router v7 (hash router, which GitHub Pages needs)
- dexie + dexie-react-hooks (the DB is the state store; no Redux)
- zod/mini for backup validation
- uPlot for charts (CSS bars for volume)
- vite-plugin-pwa (injectManifest with a custom `sw.ts`)
- CSS Modules + tokens, no UI kit and no date library
- Vitest (+ fake-indexeddb, Testing Library, fast-check) and Playwright (Pixel 7 emulation)

**Layout (`src/`):**
- `domain/`: pure TypeScript. No React, Dexie, or argument-less `new Date()`/`Date.now()`; "now" is always passed in. ESLint enforces this. Modules: `types`, `dates`, `units`, `rounding`, `settings/registry`, `e1rm`, `progression/{keys,drop,evaluate,prefill}`, `stall`, `deload`, `strength`, `volume`, `trend`, `bodycomp`, `tdee`, `nutritionTargets`, `checkin`, `phaseSwitch`, `restTimer`, `csv`. Tests sit next to each module.
- `seed/`: pure data. 13 muscles (the spec's 12 + traps); 33 exercises (the 28 program rows with the 3 "or" rows split, plus 2 finishers); 5 days / 34 slots; track start loads; your profile and first body entry; default "Gym 1".
- `db/`: Dexie schema (versioned, with pure migration transforms reused by backup import), populate-from-seed, `guards.ts` (session immutability), repos, backup, CSV, `persistence.ts`.
- `services/`: the only path for UI writes. Includes `trainingModel` (replays history → prescriptions, stalls, series), session, edit, body, nutrition, phase, check-in and suggestion services.
- `platform/`: rest alerts, notifications, wake lock, audio, vibrate, file save/share, SW update, install.
- `features/`: `today`, `logger`, `history`, `progress`, `volume`, `body`, `food`, `checkin`, `program`, `settings`, `data`. `ui/` holds shared components.

**Tables (Dexie v1):**
- `profile`, `settings` (singleton, merged over registry defaults), `appState`, `muscles` (with bands and exemptions), `gyms`
- `exercises` (loadType, equipmentSpecific, perHand, unilateral, stepLb, muscleWeights, isMainLift, isFinisher, archivedAt)
- `gymExerciseSettings`, `programDays`, `programSlots` (full regime, default and alternate exercises), `gymSlotOverrides`, `trackStarts`
- `sessions` (status in_progress/finished/abandoned, gymId, isDeload, jointPain, bodyweightLb, voidedAt)
- `sessionExercises`: a prescription snapshot taken at session start (regime, weights, suggested load and branch). Never editable.
- `setLogs` (isWarmup, voidedAt), `bodyEntries` (keyed by date), `nutritionEntries` (keyed by date)
- `phases`: immutable except endDate/status
- `targetRevisions` (append-only), `checkIns` (snapshot fields plus status pending/accepted/skipped), `suggestions` log

**Screens:** bottom tabs are Today · Train · Body · Food · More.
- **Training flow:** Start sheet (gym, day, deload toggle, bodyweight, preview of loads) → Logger (per-exercise cards with prefilled load and reps, RIR chips, a warm-up toggle, a sticky rest-timer bar with +30 s / Skip, and swap/add exercise) → Summary (Step ▲ / +1 rep / Miss 1 of 2 / Drop ▼, the next load, e1RM, PRs, stall and deload cards).
- **Other screens:** History (read-only with Edit/Void), Progress charts, Volume (planned vs logged vs band, session-cap warnings), Body (trend, 7-day average, body-composition card), Food (targets, what's left, phase wizard, check-in), Program editor (days, slots, library, gyms, planned-volume preview), Settings (every setting with Evidence/Heuristic badges and an out-of-evidence-range warning), Data (backup/restore, CSVs, storage-persist status, backup reminder every 7 days).

## Execution (milestones; parallel parts run as multi-agent workflows in git worktrees)
1. **M0 Tooling:**
   - Install Node LTS via `winget install OpenJS.NodeJS.LTS`. It accepts the Node.js license and triggers UAC, so I'll ask right before running it.
   - `git init -b main` with the repo-local noreply identity. I'll look up your numeric GitHub ID from the public API and confirm the address with you.
   - Hand-written Vite scaffold with `base: '/Exersise-Applet/'`. Install all dependencies up front so worktrees don't fight over the lockfile.
   - `.gitattributes` (LF), `CLAUDE.md` (conventions for implementing agents), and `docs/DECISIONS.md` + `docs/DESIGN.md` (the full audit and design, including algorithm contracts, regenerated from session outputs as UTF-8).
   - GitHub Actions `ci-deploy.yml` (lint, typecheck, test, build, deploy Pages).
   - First push to `origin main`. Credential Manager opens a browser sign-in for you. You set Settings → Pages → Source = "GitHub Actions" once.
2. **M1 Domain engine:**
   - Freeze `types.ts`, the settings registry, `dates`, `units` and `rounding` first.
   - Then run parallel worktrees: (A) training (e1RM, progression, stall, deload, strength, timer); (B) seed + volume; (C) nutrition (trend, body composition, TDEE, targets, check-in, phase switching); (D) CSV + backup schema.
3. **M2 Data:**
   - Dexie schema, populate, guards, repos and migration harness; backup/restore and CSV I/O.
   - Then the services layer + `trainingModel` (critical path).
4. **M3 UI:**
   - The app shell can start during M1.
   - After the services land, parallel worktrees: (H) logger, timer, summary, history and Edit mode (critical path); (I) body, food, check-in and phase wizard; (J) program editor, gyms and library; (K) progress, volume, stall and deload cards; (L) settings and data.
5. **M4 PWA:**
   - Service worker precache, manifest (scope `/Exersise-Applet/`, icons), install prompt, and an update toast held back while a session is in progress.
   - Rest alerts, wake lock, `navigator.storage.persist()`.
   - Production deploy and an on-device check with you.

Each milestone merges to `main` only after lint, typecheck and tests pass, and is pushed when green. Each parallel stage gets a review/verify pass before merge.

## Verification
- **Automated tests (Vitest), one per spec acceptance criterion:**
  - `progression/flowchart.test.ts`: every flowchart branch, including the two-session miss rule, drop rounding, calibration, warm-ups and mixed loads.
  - `volume.seed.test.ts`: all 12 rows of the Weekly totals table (quads 13.5, chest 14, triceps 16, …) and 94 sets; no seed session exceeds the cap.
  - `nutritionTargets.seed.test.ts`: maintenance ≈ 2,700, bulk ≈ 3,000, cut ≈ 2,200 (±50); protein 150 / 170 g (±5).
  - `checkin.test.ts`: no change in week 1, plus the two-week streak rules.
  - `registry.test.ts` plus a Settings UI test: every Heuristic setting is editable.
  - `db/sessionImmutability.test.ts`: finished session A stays byte-identical after session B is logged, abandoned or voided.
  - `units` property test and `db/unitsSwitch.test.ts`: switching lb/kg changes only `profile.units`.
  - `csv.test.ts` / `csvExport.test.ts`: every non-voided set appears with date, exercise, load, reps and RIR.
  - Backup round-trip: export, wipe, import, deep-equal.
- **Playwright smoke test** (Pixel 7 emulation, against `vite preview`): start Push → log sets → finish → summary shows the next load. Offline reload renders the app.
- **In-app browser check** of the deployed Pages URL: no asset 404s, the app installs, and it works offline.
- **On your Android phone** (`docs/DEVICE-CHECK.md`): the timer alert with the screen on, backgrounded, and locked; tapping the notification returns to the logger; backup to Files; CSV shared; storage persisted = true.

## Risks to watch
- **Rest timer when the screen is locked:** Android Chrome can freeze a locked page, so alerts may arrive late. The wake lock is on by default, and an opt-in silent-audio keep-alive is the fallback.
- **Data loss:** IndexedDB can be evicted, and clearing site data wipes it. Mitigations: `persist()`, a 7-day backup reminder, and a "back up first" step before restore.
- **Repo name:** the Pages path is case-sensitive and must match the repo name. Renaming the repo breaks the installed app's scope.
- **Dexie:** don't await non-Dexie work inside transactions, and keep every old `version()` declaration.
