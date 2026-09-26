<!-- Generated during planning on 2026-09-24. -->

> **Status:** design reference for implementing agents. `docs/DECISIONS.md` takes precedence where they differ. The M0 installs resolved to newer majors than this document assumes: react-router 8, Vite 8, Vitest 5, TypeScript 6, ESLint 10 (see `package.json`). Node 24 is installed and the git remote and identity are configured.
>
> **Lead changes since planning:**
> - There's no `db/repos` layer. Services use the Dexie `AppDB` (`src/db/schema.ts`) directly through a `ServiceCtx` (`db`, `now`, `newId`; see `src/services/context.ts`).
> - The UI never imports `@/db` or `dexie`. It reads through service query functions (with `useLiveQuery`) and writes through service commands.
> - There's no `loadIncrementLb`. The per-gym step override is `GymExerciseSetting.stepLb`.
> - `TrackStartRow` has no `recalibrationBadge`. The badge shows when `calibrate` is set and a start load exists.
> - Calibration during replay comes from the track start and state, not from `TrackSession.isCalibration`. That flag only serves strength-series exclusion.
> - A track start with no known load (`startLoadLb: null`) always begins with a calibration session, even without `calibrate` (`startsWithCalibration`). Otherwise trial loads would be scored as misses.
> - Deload with `deloadLoadCutPct = 0` is a sets-only deload: the load is kept. Any other cut uses the whole-step `dropLoad`, which drops at least one step.
> - Traps (trained only by the optional shrug finisher) is seeded as exempt from the "low" volume flag, like front delts, calves and abs.
> - **Measured maintenance:**
>   - TDEE = mean kcal over logged days − kcalPerLb × ΔT / D.
>   - ΔT runs from the trend at the close of the day before the window to the trend on its last day, so normally D = L (the window length).
>   - Only real trend points are used. If the trend starts inside the window, or the last days have no weigh-in, ΔT covers fewer days and D is the days it actually spans.
>   - Window choice, logging thresholds, the disruption exclusion and the week-over-week cap follow finding #30 and finding #29 (see `src/domain/tdee.ts`).
> - **Training services after the M2 review:**
>   - A session holds each exercise once: swapping or adding an exercise already in it fails with `exercise_in_session`.
>   - `StartOptions.bodyweight` is the value `startSession` stores (same-day weigh-in → trend → seed → null); pass `bodyweightLb` only when the user edits it. `setSessionBodyweight` fixes it during a session. Bodyweight-plus rows get a `no_bodyweight` notice when it's missing.
>   - Voided sets of an in-progress row that is swapped or removed are deleted with it. This is the one exception to soft deletes: they're scratch data, not history.
>   - Ad hoc sessions are never deload sessions, but ad hoc rows inside a deload session get the deload cut.
>   - `getVolumeDashboard(ctx, { weekOf, today, gymId? })`: the week is complete only after its last day, and sessions dated after `today` don't count.
>   - The summary's `next` is what followed that session (`superseded: true` if the track has moved on).
>   - Stall cards carry `key`/`status` for the suggestion log, and dismissed ones are hidden. Stalls count only exercises still in an active slot.
>   - Session detail lists `voidedSets` for Edit-mode restore.
> - **Nutrition services after the M2 review:**
>   - **Dates:** body, intake and phase dates can't be in the future (`future_date`). A new phase or phase end can't predate the active phase's answered check-ins or target changes (`invalid_start_date` / `invalid_end_date`). Only the first phase may be backdated.
>   - **Target changes:** a change can't be dated before an existing later-dated one (`later_target_exists`). Accepting a check-in re-checks it first (`stale_checkin` if a manual change made it moot).
>   - **Check-in evaluation:** each week is evaluated only with data up to its due date. Intake coverage and measured maintenance use the completed week, dueDate − 7 through dueDate − 1, and proposals use the day before the start. `syncCheckIns` clamps `asOf` to today.
>   - **Weigh-ins:** the first real weigh-in is checked against the seed baseline. Re-entering a voided date restores and patches that row.
>   - **Prompts:** a dismissed prompt stays dismissed only while it is unchanged.
>   - **Proposals:** `proposePhase` accepts an edited `rateMinPct`/`rateMaxPct`/`targetRatePct`.
>   - **Intake:** kcal above 15,000 is refused (`implausible_kcal`).
> - **Data and program services after the M2 review:**
>   - **Track start loads:** `setTrackStart` is refused while a session in progress holds the track (`track_has_history`). Changing an exercise's `equipmentSpecific` (directly or through its load type) re-keys its track starts: per-gym → shared keeps one per day; shared → per-gym copies to every active gym.
>   - **Export:** `exportBackup` checks its own output and throws `export_invalid` rather than write an unrestorable file.
>   - **Import validation:** import also checks references and requires one profile and at least one active gym.
>   - **Import confirmation:** `importBackup` returns `needs_confirm` with per-table `current`/`incoming` counts and a `shrinking` list whenever any history or user-created kind would lose rows. A restore sets `lastBackupAt` to the file's export time.
>   - **Exercise detail:** it lists every implied track with `editable`, and counts only sessions with working sets.

# Implementation plan: Exersise Applet (offline-first Android PWA)

## 0. What I checked, and gaps this plan fills

**Environment:**
- The remote `https://github.com/throbbingmember69/Exersise-Applet.git` exists and is empty (`git ls-remote` returned no refs).
- Node is not installed. winget 1.29 and Git 2.55 are.
- The spec is UTF-8 with LF line endings, and its filename contains `&` and spaces, so it must always be quoted in scripts.

**Numbers I recomputed** (these become test fixtures):
- **Planned weekly volume from the seed program:** triceps 16, chest 14, quads 13.5, biceps 13.5, back 11, glutes 10, hamstrings 9, side delts 8.5, front delts 8.5, rear delts 8, calves 6, abs 5, traps 0.
  - Total is **94 sets** (18/19/18/19/20 per day).
  - The highest planned per-session muscle total is 9.5 (Push triceps), so no session-cap warning fires on the seed.
- **Seed nutrition:**
  - Lean mass is 63.36 kg. Katch-McArdle gives 1,738.6 and Mifflin-St Jeor 1,761.5, so maintenance = 1,750.1 × 1.55 = 2,712.6, which rounds to **2,700**.
  - Bulk offset = 0.375% × 163 × 3500/7/100 = +305.6, so 3,018 rounds to **3,000**.
  - Cut offset = −0.625% × 163 × 5 = −509.4, so 2,203 rounds to **2,200**.
  - Protein: bulk 2.0 × 73.94 = 147.9 → **150**; maintenance **150**; cut 2.7 × 63.36 = 171.1 → **170**.
  - Bulk fat is 83 g and carbs 413 g.
  - Rule: store maintenance unrounded and round only the final targets.

**Gaps where your inputs don't give an answer.** Each is a one-line change if you disagree:

| # | Call made | Why |
|---|---|---|
| G1 | Strength series (e1RM charts and stall) are keyed by (exerciseId, gymScope). They pool across program days, but machine and cable exercises split by gym. | Decision 5 (pool per exercise) and decision 7 (machine loads differ between gyms) conflict; machine loads at two gyms aren't comparable. |
| G2 | The slot stores the full regime (sets, rep range, RIR, rest min/max). The exercise stores a default regime used only for ad hoc additions and new slots. | Decision 6 (the regime belongs to the slot) also covers the per-item overrides rule, with no fallback chain. |
| G3 | Start loads live in a `trackStarts` table keyed by track key, seeded against a default gym "Gym 1". A second gym's machine tracks start in calibration. | Finding #7. No fake sessions. |
| G4 | Ad hoc sessions, ad hoc-added exercises and finishers are logged and count toward volume and strength series, but are never evaluated for progression. | They have no slot or regime. |
| G5 | An abandoned session is kept and can be restored, but is excluded from every calculation, like a voided one. | Simple rule. |
| G6 | Only one in-progress session at a time. A one-off swap is allowed only before any set of that exercise is logged; after that, use "Add exercise". | Keeps each session exercise's history clean. |
| G7 | The rep target after a calibration session is repMin. | This case isn't covered by finding #46. |
| G8 | Body-fat fallback: fewer than 2 readings in 28 days → use the latest reading within 90 days, marked "single". No reading → Mifflin only, and cut protein = 2.2 g/kg bodyweight (a new Heuristic setting). | The seed has only one body-fat reading, and the acceptance tests need cut protein of 170 g. |
| G9 | The seed body entry is tagged `source:'seed'`. It's excluded from the trend but is the trend fallback until a real weigh-in exists. Its 14.3% body fat counts as a reading. | Finding #31 (the trend starts at the first real weigh-in). |
| G10 | No phase is created automatically. Today shows a one-tap "Start lean bulk" card prefilled with 3,000 kcal / 150 g. | Decision 4 (no onboarding) plus finding #42. |
| G11 | Age is stored as `ageYears` + `ageAsOf` (seeded as 22 on the seed date). An optional `birthDate` overrides it. | The spec has no birth date. |
| G12 | Planned / maximum phase lengths: bulk 20/26 weeks, cut 14/16, maintenance 4. A soft note appears at the planned length and a firm prompt at the maximum. | Finding #36. |
| G13 | A manual target edit also resets the check-in miss streak. | Same logic as an accepted change. |
| G14 | Stall checks and the main-lift check use the chin-up's total e1RM (bodyweight + added). The chart shows the added-load equivalent by default, with a toggle to show total. | Decision 9. |

## (a) Directory and module layout

```
/  (repo root = C:\Users\Edward\Documents\Exersise Applet)
  Training & Bulk Cut Plan Findings and Applet Spec.md   (kept at root, unchanged)
  CLAUDE.md                 conventions for implementing agents (see M0)
  docs/DECISIONS.md         the 55 audit findings + the 13 user decisions + G1–G14 (the audit file lives outside the repo; agents in worktrees need it)
  docs/DEVICE-CHECK.md      on-device checklist + results (M4)
  .github/workflows/ci-deploy.yml
  .gitattributes (* text=auto eol=lf)   .gitignore   .nvmrc   .editorconfig
  index.html  vite.config.ts  vitest.config.ts  playwright.config.ts
  tsconfig.json tsconfig.app.json tsconfig.node.json  eslint.config.js  .prettierrc
  public/  favicon.svg, pwa-192.png, pwa-512.png, maskable-512.png (generated)
  src/
    main.tsx  App.tsx  routes.tsx  sw.ts (service worker source, injectManifest)
    domain/                       PURE: no React, Dexie, DOM, Date.now()
      types.ts                    all entity + engine types (the shared contract)
      dates.ts units.ts rounding.ts
      settings/registry.ts        every setting: key, default, tag, unit, bounds, evidence range
      e1rm.ts
      progression/keys.ts drop.ts evaluate.ts prefill.ts
      stall.ts deload.ts strength.ts volume.ts
      trend.ts bodycomp.ts tdee.ts nutritionTargets.ts checkin.ts phaseSwitch.ts
      restTimer.ts csv.ts
      *.test.ts                   colocated
    seed/                         PURE DATA (imports domain/types only)
      muscles.ts exercises.ts program.ts trackStarts.ts profile.ts index.ts
    db/
      schema.ts                   Dexie class, db name 'exersise-applet', version declarations
      migrations/                 vN.ts = pure row transforms (shared by Dexie upgrade + backup import)
      populate.ts                 on('populate') → insert seed
      guards.ts                   assertSessionWritable(session, mode)
      repos/  profileRepo settingsRepo gymRepo exerciseRepo programRepo trackStartRepo
              sessionRepo bodyRepo nutritionRepo phaseRepo targetRepo checkinRepo suggestionRepo appStateRepo
      backup.ts  csvExport.ts  persistence.ts  backupSchema.ts (zod)
    services/                     app layer: repos + domain; the only thing UI calls for writes
      trainingModel.ts            loads history → builds domain inputs → prescriptions, stalls, deload state, series
      sessionService.ts sessionEditService.ts
      bodyService.ts nutritionService.ts phaseService.ts checkinService.ts suggestionService.ts
    platform/                     browser APIs, isolated
      restAlerts.ts notifications.ts wakeLock.ts audio.ts vibrate.ts files.ts swUpdate.ts install.ts
    ui/                           shared components: AppShell, BottomNav, Card, Sheet, ConfirmDialog, Badge,
                                  NumberStepper, MassInput, RirChips, Toast, UPlotChart, BandBars, EmptyState
    features/
      today/ logger/ history/ progress/ volume/ body/ food/ checkin/ program/ settings/ data/
      (each: index.tsx route components + local components + *.test.tsx)
    styles/ tokens.css global.css
  tests/e2e/ smoke.spec.ts offline.spec.ts
  tests/fixtures/ backup-v1.json (migration fixture)
```

**Boundary rules, enforced in ESLint:**
- `src/domain/**` and `src/seed/**` may not import `react`, `dexie`, `dexie-react-hooks`, `@/db`, `@/services`, `@/features`, `@/platform` or `@/ui`. They also may not use `Date.now()` or `new Date()` without arguments. Any "now" or "today" is passed in as a parameter.
- `features/**` never imports `db/repos` directly for writes; all writes go through `services/`.

## (b) Dexie schema (v1)

**Conventions:**
- IDs are `crypto.randomUUID()`. Seed IDs are deterministic slugs (`ex-smith-squat`, `day-lower-a`, `slot-push-2`, `gym-1`, `quads`) so tests and migrations can refer to them. IDs never contain `|`.
- Dates are `LocalDate` strings (`YYYY-MM-DD`). Instants are epoch milliseconds.
- All masses are stored in lb at full precision.
- Booleans and nulls are never indexed, because IndexedDB can't key on them. Filter those in memory. Data volume is about 5,000 sets per year, so services load whole tables and compute in memory.

| Table | Primary key and indexes | Fields | Mutability |
|---|---|---|---|
| `profile` | `id` ('me') | name, sex ('male'\|'female'), ageYears, ageAsOf, birthDate\|null, heightIn, units ('lb'\|'kg'), updatedAt | editable |
| `settings` | `id` ('singleton') | values: Partial<Settings> (merged with registry defaults on read), updatedAt | editable |
| `appState` | `key` | value. Keys: lastGymId, restTimer, wakeLockEnabled, lastBackupAt, seedVersion, notificationsAsked | editable |
| `muscles` | `id, sortOrder` | name, bandMin\|null, bandMax\|null (null = use the global 10–20), exemptLow, lagging, archivedAt\|null. Seed: 12 muscles + traps; front delts, calves and abs exempt | editable |
| `gyms` | `id, sortOrder` | name, archivedAt\|null, createdAt | editable |
| `exercises` | `id, name` | name, loadType ('barbell'\|'dumbbell'\|'machine'\|'cable'\|'bodyweight_plus'), equipmentSpecific (default = machine or cable), unilateral, perHand (default = dumbbell), stepLb, loadIncrementLb\|null, defaultRegime{sets,repMin,repMax,rirMin,rirMax,restMinSec,restMaxSec}, muscleWeights: Record<MuscleId, 0.5\|1>, isMainLift, isFinisher (no progression), notes, archivedAt\|null, createdAt, updatedAt | editable; archived instead of deleted |
| `gymExerciseSettings` | `id, &[gymId+exerciseId]` | gymId, exerciseId, stepLb\|null, loadIncrementLb\|null (a gym's own machine jump) | editable |
| `programDays` | `id, order` | name, weekday 0–6\|null, order, note, archivedAt\|null | editable |
| `programSlots` | `id, programDayId, [programDayId+order], defaultExerciseId` | programDayId, order, label, defaultExerciseId, alternateExerciseIds[], sets, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec, note, archivedAt\|null | editable (only future sessions see the change) |
| `gymSlotOverrides` | `id, &[gymId+slotId], slotId` | gymId, slotId, exerciseId (permanent per-gym swap) | editable |
| `trackStarts` | `trackKey, exerciseId` | programDayId, exerciseId, gymScope, startLoadLb\|null, calibrate, recalibrationBadge, updatedAt | editable (ignored once the track has evaluated history) |
| `sessions` | `id, date, status, startedAt, gymId, programDayId` | date, startedAt, finishedAt\|null, tzOffsetMin, status ('in_progress'\|'finished'\|'abandoned'), programDayId\|null, gymId, isDeload, jointPain, bodyweightLb\|null, bodyweightSource ('weighin'\|'trend'\|'seed'\|'manual'), note, voidedAt\|null, editedAt\|null, createdAt | see immutability rules below |
| `sessionExercises` (the snapshot) | `id, sessionId, exerciseId, slotId, [sessionId+order]` | sessionId, order, slotId\|null, adHoc, exerciseId, exerciseName, loadType, perHand, unilateral, equipmentSpecific, gymScope, isMainLift, isFinisher, swappedFromExerciseId\|null, swapKind ('none'\|'one_off'\|'gym_override'), prescription{sets, setsBeforeDeload, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec, stepLb, loadIncrementLb}, muscleWeights, suggestion{loadLb\|null, repTargets[], branch, missStreakBefore, isCalibration, recalibrationBadge, notices[]}, createdAt | **never editable**, even in Edit mode. Can be added, swapped or removed only while in progress and only with no sets logged |
| `setLogs` | `id, sessionId, sessionExerciseId, exerciseId` | sessionId, sessionExerciseId, exerciseId (denormalized), setIndex, loadLb (per hand or per limb as written; added load for bodyweight_plus, may be ≤ 0), reps (weaker side for unilateral), rir 0–5\|null, isWarmup, note, loggedAt, editedAt\|null, voidedAt\|null | free while in progress; after finish, only in Edit mode |
| `bodyEntries` | `date` | weightLb\|null, bodyFatPct\|null, muscleMassLb\|null, skeletalMusclePct\|null, subcutFatPct\|null, visceralRating\|null, source ('seed'\|'user'), note, createdAt, updatedAt, voidedAt\|null | editable; a user entry replaces a seed entry on the same date |
| `nutritionEntries` | `date` | kcal\|null, proteinG\|null, carbsG\|null, fatG\|null, steps\|null, updatedAt | editable (daily totals) |
| `phases` | `id, startDate, status` | type, startDate, endDate\|null, status ('active'\|'ended'), prevPhaseId\|null, parentPhaseId\|null (reserved for diet breaks), rateMinPct < rateMaxPct, targetRatePct, maintenanceKcalAtStart (unrounded), maintenanceSource ('formula'\|'measured'\|'manual'), trendWeightLbAtStart, bodyFatPctAtStart\|null, bfQuality, leanMassLbAtStart\|null, proteinBasis ('bodyweight'\|'leanMass'\|'bodyweight_fallback'), proteinGPerKg, fatPct, bfCeilingPct\|null, bfTargetPct\|null, plannedWeeks, maxWeeks, endReason\|null, createdAt | immutable except endDate, status, endReason |
| `targetRevisions` | `id, phaseId, effectiveDate, [phaseId+effectiveDate]` | phaseId, effectiveDate, kcal, proteinG, fatPct, source ('phase_start'\|'checkin'\|'manual'), checkInId\|null, note, createdAt | append-only |
| `checkIns` | `id, phaseId, dueDate, &[phaseId+dueDate]` | phaseId, dueDate, phaseWeekIndex, status ('pending'\|'accepted'\|'accepted_steps'\|'skipped'\|'backfilled'), evaluatedAt, trendWeightLb, trendRatePct\|null, bandMinPct, bandMaxPct, intakeLoggedPct, weighInLoggedPct, tdeeEstimate, tdeeSource ('formula'\|'measured'\|'insufficient_data'), tdeeCapped, missDirection\|null, missStreak, suggestionType, suggestedKcalChange, stepsAlternative\|null, appliedKcalChange\|null, switchPrompt{kind, severity, reasons[], suggestedNext}\|null, switchResponse\|null, respondedAt\|null | snapshot refreshed while pending; frozen once answered |
| `suggestions` | `id, kind, &key, status` | kind ('stall'\|'deload'\|'deload_end'\|'volume_ramp'\|'strength_slide'), key (deterministic fingerprint), status ('shown'\|'accepted'\|'dismissed'), payload, firstShownAt, respondedAt\|null | upserted when first shown; status changes once |

**Immutability once a session is finished:**
- `sessionExercises` never change.
- `sessions` fields id, date, startedAt, programDayId, gymId and createdAt never change.
- In Edit mode only (entered from session detail after a confirm; stamps `editedAt`):
  - `sessions`: note, jointPain, isDeload, bodyweightLb, status (finished ↔ abandoned), voidedAt (void / restore).
  - `setLogs`: loadLb, reps, rir, isWarmup and note can change; sets can be added; sets are voided, never hard-deleted.
- `db/guards.ts` enforces these rules and is tested. Services never write any row of another session.

**Migration policy:**
- Keep every `db.version(n)` declaration.
- Never change a primary key. That needs a new table plus a copy step.
- Upgrade callbacks call `migrations/vN.ts` pure transforms, not app code. The same transforms upgrade older backup files on import.
- New settings keys need no migration, because stored values are merged over registry defaults on read.
- Add seed content (for example new library exercises) by id, gated by `appState.seedVersion`.
- Handle `db.on('versionchange')` by closing the database and showing "Reload to update".

**Diet-break seam (for later):** add a `dietBreaks` table {id, phaseId, startDate, endDate}. `checkinSchedule` already takes a `pauses` list and `measuredTdee` a `disruptions` list, and `parentPhaseId` is reserved, so adding breaks later doesn't restart the cut.

## (c) Domain signatures (`src/domain`)

Core types: `LocalDate` (branded string), `Branch = 'start'|'calibration'|'calibrated'|'step'|'same_plus_rep'|'same_after_miss'|'drop'`, `Regime`, `WorkingSet {setIndex, loadLb, reps}`, `TrackSession {sessionId, date, startedAt, isDeload, isCalibration, prescribed:{sets,repMin,repMax}, sets: WorkingSet[]}` (warm-ups and voided sets already removed), `TrackStart {startLoadLb|null, calibrate}`, `TrackState {lastBaseLb|null, lastBranch, missStreak, lastReps: (number|null)[], calibrated, evaluatedCount}`, `NextPrescription {loadLb|null, repTargets, sets, branch, isCalibration, recalibrationBadge, missStreakBefore, notices}`.

**dates.ts**
- `parseLocalDate(s: string): LocalDate`: validates the format and throws otherwise.
- `localDateOf(epochMs: number): LocalDate`: the local calendar date of an instant. This is the only place `Date` getters are used.
- `dayNumber(d: LocalDate): number`: `Date.UTC(y,m-1,d)/86400000`, so DST can't affect it.
- `fromDayNumber(n)`, `addDays(d, n)` and `daysBetween(a, b): number` (b − a).
- `weekday(d): 0..6`, `weekStart(d, startDay): LocalDate`, `ageOn(profile, d): number`.

**units.ts / rounding.ts**
- `KG_PER_LB = 0.45359237`.
- `lbToDisplay(lb, unit)` and `displayToLb(v, unit)` never round.
- `formatMass(lb, unit, dp = 1): string` is the only place masses are rounded for display.
- `formatRate(pct, trendLb, unit)`, `inToCm`, `cmToIn`, `loadsEqual(a, b): boolean` (tolerance 1e-6).
- `roundHalfAway(x)` and `roundToStep(x, step)` are used for 50 kcal and 5 g. Never use `Math.round` on negative values.

**settings/registry.ts**
- `SETTINGS_REGISTRY: readonly SettingMeta[]`, where each entry has {key, label, group, tag:'Evidence'|'Heuristic', unit, default, min, max, step, evidenceRange?}.
- `DEFAULT_SETTINGS`, `resolveSettings(stored): Settings`, `outOfEvidenceRange(key, v): boolean`.
- Keys and defaults:
  - **Energy:** activityFactor 1.55, trendAlpha 0.1, kcalPerLb 3500, tdeeWindowMinDays 14, tdeeWindowMaxDays 21, tdeeMinLoggedPct 80, tdeeMaxWeeklyChangeKcal 150, tdeeExcludeDaysAfterStart 7.
  - **Rate bands:** bulk 0.25/0.5, cut −0.75/−0.5, maintenance −0.25/0.25.
  - **Protein and fat:** bulkProteinGPerKgBw 2.0, maintProteinGPerKgBw 2.0, cutProteinGPerKgLbm 2.7, cutProteinFallbackGPerKgBw 2.2, fatPct 25, kcalRoundTo 50, proteinRoundTo 5, surplusWarnPct 15.
  - **Check-in:** checkinStepKcal 150, checkinMaintStepKcal 100, checkinMissesRequired 2, cutStepsAlternative 2000.
  - **Body data:** weighInConfirmDeviationPct 3, sevenDayAvgMinReadings 3, bfSmoothN 3, bfSmoothWindowDays 28, bfSmoothMin 2, bfSingleFallbackDays 90.
  - **Phases:** bulkBfCeilingPct 18, cutBfTargetPct 12, bulkPlannedWeeks 20, bulkMaxWeeks 26, cutPlannedWeeks 14, cutMaxWeeks 16, maintWeeks 4, cutStrengthDropPct 5, strengthLookbackDays 21, strengthWindowDays 7.
  - **Training:** weeklyVolumeMin 10, weeklyVolumeMax 20, sessionCap 11, stallWindow 3, missesBeforeDrop 2, dropPct 10, e1rmRepCutoff 12, deloadStallCount 3, deloadJointPainHits 2, deloadJointPainWindow 3, deloadSetFraction 0.5, deloadLoadCutPct 10, deloadSessions 5, stallRemedyWeeks 2, trainingWeekStartDay 1, rampEveryWeeks 3, backupReminderDays 7.
  - All are editable. Evidence-tagged values show a warning when set outside their evidence range.

**e1rm.ts**
- `epley(totalLb, reps): number`: load × (1 + reps/30).
- `setStrength(set, {loadType, bodyweightLb}): {totalLb, displayLb} | null`: for bodyweight_plus, total = bodyweight + added and display = e1RM − bodyweight. Returns null if reps < 1.
- `metricKind(exerciseDefaultRepMax, s): 'e1rm'|'repsAtLoad'`: repsAtLoad only when repMax is strictly greater than the cutoff.
- `sessionMetric(sets, kind, ctx, repMin): MetricValue|null`: for e1rm, the max total e1RM; for repsAtLoad, the lexicographic max of (load, reps) over sets with reps ≥ repMin.
- `compareMetric(a, b): -1|0|1`: numeric for e1rm, lexicographic for repsAtLoad (with `loadsEqual`). Under this ordering, "more reps at the same or higher load" and "any load increase with reps ≥ repMin" both count as higher.

**progression/keys.ts / drop.ts**
- `gymScope(equipmentSpecific, gymId): string` returns gymId or `'*'`.
- `trackKey(dayId, exerciseId, scope)` and `seriesKey(exerciseId, scope)`.
- The scope is computed when reading, from the current `equipmentSpecific` flag, so toggling the flag regroups history.
- `dropLoad(baseLb, stepLb, pct, allowNegative): number`: base − max(1, floor(pct/100 × |base| / step)) × step. The result is clamped at 0 unless the exercise is bodyweight_plus.

**progression/evaluate.ts / prefill.ts**
- `evaluateSession(prev: TrackState, h: TrackSession, s): {state, result: SessionResult}` is one step of the flowchart:
  1. A deload session is not evaluated and sets the streak to 0.
  2. No working sets: not evaluated; the state carries forward unchanged.
  3. A calibration session sets base to the last working set's load, the streak to 0 and calibrated to true.
  4. Otherwise E = the first N working sets by setIndex (N = the snapshot's set count). Base = the minimum load in E, with a `mixed_loads` notice if the loads differ. allTop = |E| ≥ N and every rep count ≥ repMax. anyBelow = some rep count < repMin (including 0).
  5. allTop → step (streak 0). Not anyBelow → same_plus_rep (streak 0).
  6. anyBelow → the streak becomes (load changed vs the previous base ? 0 : streak) + 1. If the streak ≥ missesBeforeDrop → drop (streak 0); otherwise same_after_miss.
- `replayTrack(start, history, s): {state, results}` folds finished, non-voided sessions in (date, startedAt) order. It never reads stored suggestions.
- `nextPrescription(state, start, regime, stepLb, loadType, s): NextPrescription`:
  - no history → the start load (blank plus calibration if the start load is null or `calibrate` is set)
  - step → base + current step
  - same branches → base
  - drop → `dropLoad` (the configured drop %)
  - after calibration → base
- `repTargets(branch, lastReps, sets, repMin, repMax)`:
  - same_plus_rep → min(last + 1, repMax)
  - step, drop or calibrated → repMin
  - same_after_miss → last reps
  - a missing set index → repMin
  - RIR is always left blank.
- `deloadPrescription(p, regime, stepLb, loadType, s)`: sets = ceil(sets × 0.5), load = `dropLoad(p.loadLb, step, deloadLoadCutPct)`. The pre-deload suggestion comes back automatically afterwards, because deload sessions are skipped during replay.

**stall.ts / deload.ts / strength.ts**
- `seriesPoints(sessions: SeriesSession[], kind, ctx, repMin, s): MetricPoint[]` excludes deload sessions, calibration sessions, post-drop sessions (snapshot branch 'drop') and sessions with no qualifying set.
- `detectStall(points, window): {stalled, sinceSessionId?, bestBefore?}` needs at least window + 1 points. Stalled means the max of the last `window` points is ≤ the max of all earlier points. The flag clears itself on the next gain, since it's derived.
- `deloadTrigger({stalledSeries, recentSessions:{id,jointPain}[]}, s): {suggest, reasons, fingerprint}` fires at ≥ 3 concurrent stalls, or joint pain in 2 of the last 3 sessions.
- `deloadStatus({acceptedAt, endedAt, sessionsSince}, s): {active, remaining}` treats the deload as over after 5 finished deload sessions.
- `mainLiftSlide(series[], asOf, s): {meanChangePct|null, perLift, triggered}` compares the best total e1RM in [asOf−6, asOf] with [asOf−27, asOf−21], per series key. Lifts missing data in either window are skipped. It triggers when the mean is below −5%.

**volume.ts**
- `plannedWeeklyVolume(days, slots, resolveWeights): {byMuscle, totalSets}` = sum of sets × weight. Archived items are excluded; a unilateral set counts once.
- `plannedDayVolume(slots, resolveWeights)` feeds the editor's session-cap warning.
- `loggedSessionVolume(sessionExercises, workingSetCounts)` uses the snapshot muscle weights.
- `weeklyLoggedVolume(sessions, weekStartDay): Map<LocalDate, {byMuscle, isDeloadWeek}>`.
- `volumeFlag(total, band, {weekComplete, deloadWeek}): 'low'|'ok'|'high'|null`: no 'low' for exempt muscles, for the current unfinished week or for deload weeks.
- `overSessionCap(byMuscle, cap)` flags totals strictly greater than the cap.

**trend.ts / bodycomp.ts**
- `dailyWeights(userEntries): DailyWeight[]`: T0 = the first user weigh-in, one reading per date, interior gaps linearly interpolated and flagged. Nothing is extrapolated past the last reading.
- `emaTrend(daily, alpha): TrendPoint[]` and `trendOn(trend, d): {trendLb, stale}|null`.
- `weeklyRatePct(trend, d): number|null`: (T_d − T_{d−7}) / T_{d−7} × 100. Null until 7 days of trend exist.
- `sevenDayAvg(entries, d, minReadings)`: shown only with at least 3 real readings in the window.
- `smoothedBodyFat(readings, asOf, s): {pct, n, quality:'smoothed'|'single'}|null` (see G8).
- `leanMassLb`, `bmi`, `ffmi`, `mifflinStJeor({weightKg, heightCm, age, sex})` (both sex constants) and `katchMcArdle(leanKg)`.

**tdee.ts / nutritionTargets.ts**
- `formulaTdee({trendLb, bf, heightIn, age, sex}, s): {kcal, method:'avg'|'mifflin_only'}`.
- `measuredTdee({asOf, intake, weighInDates, trend, disruptions}, s): {kcal, windowDays, intakePct, weighInPct}|null`:
  - Picks the longest window between 21 and 14 days where at least 80% of days have kcal and at least 80% have a weigh-in.
  - The window must start at least 7 days after every disruption (phase start).
  - TDEE = mean kcal over logged days − 3500 × ΔT / L, where L = the window length in calendar days.
- `tdeeTimeline(checkpoints, …, s): TdeePoint[]`: the first measured estimate replaces the formula value with no cap. Later estimates are clamped to ±150 kcal of the previous one. When data is insufficient, the previous estimate is kept and labelled 'insufficient_data'.
- `rateBand(type, s)`.
- `kcalOffset(midPct, trendLb, s)` = midPct × W × kcalPerLb / 7 / 100.
- `proteinG(type, {trendLb, leanLb}, s)` rounds to 5 g.
- `macroSplit(kcal, proteinG, fatPct): {fatG, carbsG}`.
- `proposePhaseTargets({type, maintenanceKcal, maintenanceSource, trendLb, bf}, s): PhaseProposal` gives kcal = round50(maintenance + offset), plus impliedSurplusPct and warnings.
- `activeTargetOn(revisions, d)` returns the latest revision with effectiveDate ≤ d, ties broken by createdAt. Protein stays fixed on a kcal change, fat = fatPct × kcal and carbs fill the rest.

**checkin.ts / phaseSwitch.ts**
- `checkinSchedule(phaseStart, asOf, pauses = []): {weekIndex, dueDate}[]` with dueDate = start + 7k. A check-in is evaluated as of its due date, even if opened late.
- `missDirection(ratePct, band): 'low'|'high'|null`.
- `missStreak(weeks, lastAcceptedWeekIndex): {direction, count}` excludes week 1, requires the same direction, and resets after an accepted or manual change. A skip does not reset it.
- `evaluateCheckin(input, s): CheckinEvaluation`:
  - week 1 → `none_first_week`
  - rate null → `none_insufficient`
  - streak ≥ 2 → a kcal change: ±150 for bulk or cut; 100 back toward zero for maintenance
  - a cut losing too slowly also offers `stepsAlternative`
- `phaseSwitchPrompt({phase, weekIndex, smoothedBf, strength}, s): SwitchPrompt|null` gives a soft prompt at the planned length and a firm one at the maximum, body-fat ceiling or target, cut strength slide, or maintenance length.
- `nextPhaseType(current, lastNonMaintenance)`: bulk → maintenance → cut → maintenance → bulk.

**restTimer.ts / csv.ts**
- `restView(t, now): {stage:'rest'|'min'|'max', msToMin, msToMax, elapsedMs}` and `alertTimes(t): number[]` (at the minimum, then at the maximum if it's larger, plus any +30 s extensions).
- `toCsv(header, rows, {bom}): string`: RFC 4180 with CRLF. Text cells starting with `= + - @` get a formula-injection guard; numbers don't.
- `setsCsv(...)` columns: date, session_id, session_status, program_day, gym, exercise, exercise_id, load_type, per_hand, set_index, is_warmup, load_lb, reps, rir, set_note, session_bodyweight_lb, is_deload.
- `bodyCsv(...)` and `nutritionCsv(...)`.
- Exports use lb and ISO dates, and exclude voided rows.

**Service-layer signatures (not pure):**
- `startSession({gymId, programDayId|null, isDeload, bodyweightLb?}): Promise<id>` computes every snapshot first, then writes the session and its session-exercise rows in one Dexie transaction.
- Also: `logSet`, `updateSet`, `voidSetInProgress`, `swapExercise`, `addExercise`, `finishSession(id, {jointPain, note})`, `abandonSession`.
- `sessionEditService.apply(id, patch)`, plus `voidSession` and `restoreSession`.
- `trainingModel.load(): TrainingModel` exposes `prescriptionsFor(dayId, gymId)`, `sessionResults(id)`, `stallFlags()`, `deloadState()`, `series(exerciseId)`.
- `phaseService.propose(type, startDate)` and `startPhase(proposal)` (ends the current phase and writes the Phase plus a phase_start revision).
- `checkinService.current()`, which also backfills rows for missed weeks, plus `respond(id, action, amount?)`.

## (d) Screens, routes and flows (HashRouter, mobile-first, dark by default)

The bottom navigation has five tabs: **Today · Train · Body · Food · More**. Routes are lazy-loaded per feature.

| Route | Screen |
|---|---|
| `#/` | Today: next day + gym + Start/Resume, weigh-in and intake quick entry, today's target and what's left, check-in due, stall/deload cards, phase card or "Start lean bulk", backup reminder |
| `#/train/start` | Start sheet: gym (last used), day (suggested next; or Ad hoc), deload toggle (auto-on while a deload is active, "2/5"), bodyweight (same-day weigh-in → trend → seed, editable), preview with suggested loads and Calibrate/Recalibrate badges |
| `#/train/session/:id` | Logger |
| `#/train/session/:id/summary` | Post-session results |
| `#/train/history`, `#/train/history/:id` | Session list; read-only detail with Edit session (confirm), Void and Restore |
| `#/train/progress`, `#/train/progress/:exerciseId` | Stall list; e1RM or reps-at-load chart (split by gym where relevant, "per hand" label, chin-up total/added toggle) |
| `#/train/volume` | Weekly planned vs logged sets per muscle against bands, session-cap warnings, deload-week marker, week picker |
| `#/body` | Weigh-in and scale fields; trend + 7-day average + raw chart; body-composition card (lean mass, FFMI, BMI); entry list |
| `#/food`, `#/food/phase/new`, `#/food/checkin` | Intake and targets (per-meal protein tip = target ÷ 4); phase setup wizard; weekly check-in plus history |
| `#/program`, `#/program/day/:id`, `#/program/exercises[/:id]`, `#/program/gyms` | Days (order, weekday, archive); slots (regime, default, alternates, per-gym exercise, reorder, planned-volume preview with cap warnings); exercise library editor; gyms |
| `#/settings`, `#/settings/profile`, `#/settings/data` | Grouped settings with Evidence/Heuristic badges; profile and units; backup/restore, 3 CSVs, storage persistence, notification permission, wake-lock default |

**Flow 1: start → log → finish → suggestions**
1. Today → Start. Pick the gym and day, then tap Start.
2. `startSession` writes the snapshots.
3. On that tap: request the wake lock if it's on, ask for notification permission the first time, and unlock the AudioContext.
4. The logger shows one card per exercise:
   - regime line ("4 × 6–10 @ RIR 1–2 · rest 2:00–3:00")
   - last-session line and branch reason
   - set rows: load stepper (± the resolved step, unit-aware), reps (prefilled target), RIR chips 0–5 (blank), warm-up toggle, Save
   - Save writes the `setLog` immediately, so nothing is lost if the app crashes
5. Saving starts the timer: a sticky bar counts down to the minimum rest, then the maximum, with +30 s and Skip.
6. The exercise menu has: swap (alternates first, then the library; only while no sets are logged), note, "set starting load" (calibration), skip.
7. "Add exercise" includes finishers.
8. Finish: confirm if sets are missing, then the joint-pain toggle and a note. Status becomes finished.
9. The summary shows each exercise's outcome (Step ▲ / +1 rep / Miss 1 of 2 / Drop ▼ / Calibrated / Skipped) with next time's load × reps, e1RM and PR badges, session volume against the cap, stall flags and a deload card (Accept/Dismiss, written to the suggestion log).

**Flow 2: daily weigh-in and intake**
- Today → weight → Save. If the reading is more than 3% from the trend, a confirm dialog appears. The entry is upserted by date, and the trend, 7-day average and weekly rate update live.
- Intake: kcal is required to count the day as logged. Protein, carbs, fat and steps are optional. A hint appears when macros and kcal disagree by more than 10%. The entry stays editable all day.

**Flow 3: weekly check-in**
- A "Check-in due (week N)" card appears from the due date.
- The screen shows:
  - a 3-week trend chart with the band shaded
  - the rate against the band and the streak
  - the percentage of intake and weigh-in days logged
  - the TDEE estimate and its source (measured, capped / formula / insufficient)
  - the suggestion, with [Accept] [Other amount] [Skip], plus [+2,000 steps instead] on a cut
- Accepting writes a TargetRevision effective the next day.
- A switch prompt offers [Plan next phase], which opens the wizard with the next phase preselected and proposed targets you can edit.

## (e) Library choices

| Need | Choice | Rationale |
|---|---|---|
| Framework | React 19 + TypeScript strict (`strict`, `noUncheckedIndexedAccess`; skip `exactOptionalPropertyTypes`, which fights Dexie types) + Vite (latest stable) | Your decision |
| Router | react-router v7, `createHashRouter` | Needs no server rewrite on GitHub Pages, and agents know it well |
| Storage | dexie 4 + dexie-react-hooks (`useLiveQuery`) | Dexie *is* the state store; no Redux or Zustand. React context only for the rest timer and resolved settings/profile |
| Validation | zod v4 (`zod/mini`) | Backup import validation plus form parsing; small bundle |
| Charts | uPlot (~20 KB gzip, canvas, touch cursor) for trend and e1RM; plain CSS bars for volume | Recharts and Chart.js are 3–5× heavier and slower on phones; volume bars don't need a chart library |
| PWA | vite-plugin-pwa with `strategies:'injectManifest'` (custom `sw.ts` using workbox-precaching and a `notificationclick` handler), `registerType:'prompt'`; @vite-pwa/assets-generator for icons | Full service-worker control. A prompted update never reloads during a workout |
| Dates | No library. Own `dates.ts` (day numbers) and `Intl.DateTimeFormat` for display | Local-date strings plus UTC day numbers can't hit DST or timezone bugs; date-fns isn't needed |
| Styling | CSS Modules + CSS custom-property tokens, no UI kit | Zero dependencies. Touch targets ≥ 48 px; `inputmode="decimal"` inputs |
| Tests | Vitest projects (domain = node, db = node + fake-indexeddb, ui = happy-dom + @testing-library/react + user-event), @vitest/coverage-v8, fast-check (units round-trip, drop invariants, EMA); Playwright chromium with Pixel 7 emulation for smoke + offline | Fast unit loop plus a real SW/base-path check |
| Tooling | npm, ESLint flat config (typescript-eslint, react-hooks, no-restricted-imports/syntax boundary rules), Prettier | npm ships with Node, fewest moving parts on Windows |

## (f) Milestones

**M0 Tooling** (one agent, serial). Steps 1 and 8 need you.
1. **Install Node.** You run or approve `winget install --id OpenJS.NodeJS.LTS -e` yourself, because it asks you to accept package agreements. Restart Claude Code so PATH refreshes, or call `/c/Program Files/nodejs/node.exe` directly. Check `node -v` and `npm -v`.
2. **Initialize git.**
   - `git init -b main`.
   - Repo-local `user.name "throbbingmember69"` and `user.email "<ID>+throbbingmember69@users.noreply.github.com"`. Take the ID from `https://api.github.com/users/throbbingmember69` or GitHub → Settings → Emails.
3. **Author the scaffold by hand.** `npm create vite` refuses a folder that isn't empty. The package name is `exersise-applet`.
4. **Install every planned dependency now**, so parallel worktrees never conflict on the lockfile.
5. **Configure Vite** with `base: '/Exersise-Applet/'` in all modes, so path bugs show up in dev. Add the `@/` alias to tsconfig, Vite and Vitest.
6. **Scripts:** dev, build (`tsc -b && vite build`), preview, test, test:watch, coverage, typecheck, lint, e2e.
7. **Commit the docs:**
   - `.gitattributes` with eol=lf.
   - `CLAUDE.md`: commands, domain purity, lb-only storage, LocalDate rule, writes only through services, every number from Settings, tests with every domain change.
   - `docs/DECISIONS.md`.
   - The spec.
8. **Deploy.**
   - Workflow `ci-deploy.yml`: checkout → setup-node (`.nvmrc`) → `npm ci` → lint, typecheck, test, build → configure-pages → upload-pages-artifact (`dist`) → deploy-pages. Permissions `pages:write, id-token:write`, concurrency group `pages`. Deploy only on `main`.
   - You set Settings → Pages → Source: "GitHub Actions" once.
   - First push: `git remote add origin …`, then `git push -u origin main`. Git Credential Manager opens a browser and you complete the sign-in.

**M0 is done when:** a placeholder page loads at `https://throbbingmember69.github.io/Exersise-Applet/` with no asset 404s; CI is green; lint, typecheck and a trivial test pass locally.

**M1 Domain engine.**
- **M1.0 Contracts** (lead, serial, small): `domain/types.ts`, the full settings registry, `dates`, `units`, `rounding` with tests, and the `platform/restAlerts` interface. Freeze these before splitting up the work.
- Then parallel worktrees:
  - **WT-A `m1-training`:** e1rm, progression/*, stall, deload, strength, restTimer.
  - **WT-B `m1-seed-volume`:** `src/seed/*` and `volume.ts`.
    - 13 muscles.
    - 33 exercises: the 30 names in the spec's Volume accounting table plus alternates Flat DB press, Romanian deadlift and Leg press, and finishers Barbell shrug (traps 1.0) and Hyper Y-W (rear delts 1.0, back 0.5).
    - loadType follows finding #45. The first-named exercise in an "or" slot is the default.
    - 5 days, 34 slots.
    - trackStarts: blank + calibrate for the flat press and BSS slots; recalibration badge for machine fly, lateral raise (both days), rear delt fly, face pull, dip machine and deadlift.
    - Profile and first body entry.
  - **WT-C `m1-nutrition`:** trend, bodycomp, tdee, nutritionTargets, checkin, phaseSwitch.
  - **WT-D `m1-csv`:** `csv.ts` and `db/backupSchema.ts` (zod); small.

**M1 is done when:** all domain acceptance tests pass; `src/domain` line coverage is at least 90%; the boundary lint rule passes; test inputs are deep-frozen to prove functions are pure.

**Flowchart test table** (`progression.flowchart.test.ts`):
- all top → +step (220 → 230)
- in range → same load with per-set +1 rep targets
- one miss → same load with last reps as targets
- two misses in a row at the same load → drop (220 → 200: floor(22/10) = 2 steps)
- miss, in range, miss → no drop
- miss at a changed load → streak 1
- drop then miss → no second drop in a row
- missing set with the rest at top → not a step
- extra set below range → ignored
- skipped session between two misses → drop
- deload between misses → reset
- warm-ups ignored
- minimum drop is 1 step (20 lb with 5 lb step → 15; lateral raise 40 → 37.5)
- bodyweight-plus drop on added load (+50 → +45; 0 → −5)
- 53 + 5 → 58
- calibration → the last working set's load
- reps above repMax count as top
- mixed loads → the lowest load, with a notice

**M2 Database, seed and I/O** (WT-E can start once M1.0 lands; populate uses the seed after WT-B merges, stub before):
- **WT-E `m2-db`:** schema v1, populate, guards, repos, migration harness (fixture `tests/fixtures/backup-v1.json`).
- **WT-F `m2-data-io`** (after WT-E's schema exists):
  - JSON backup export and validated import: refuse newer versions, migrate older ones, optionally download a backup of current data first, clear + bulkAdd in one transaction.
  - CSV export with download and a Web Share fallback.
  - `persistence.ts`.
- **Then serial, on the critical path:** `services/*` and `trainingModel`, which need WT-A, WT-C and WT-E.

**M2 is done when:**
- Backup round-trips: export, wipe, import, deep-equal.
- The immutability test passes: snapshot every row of finished session A, then start, log, finish, abandon and void session B, and find A byte-identical. Also show that editing A in Edit mode can't touch its `sessionExercises`.
- Switching units rewrites only `profile.units`; a snapshot of every other table is unchanged.
- The CSV contains every non-voided set with date, exercise, load, reps and RIR.

**M3 UI** (logger first):
- **WT-G `m3-shell`** can run from the start of M1:
  - AppShell, BottomNav, `routes.tsx` with lazy placeholders for every feature folder (so agents only edit their own folder), UI kit (MassInput, NumberStepper, RirChips, Sheet, Badge, UPlotChart, BandBars), tokens.
  - Today renders `<TrainingTodayCards/>` from `features/logger` and `<NutritionTodayCards/>` from `features/food`.
- After the services merge, these run in parallel:
  - **WT-H `m3-logger` (critical path):** start sheet, logger, rest-timer bar, summary, history, Edit mode.
  - **WT-I `m3-body-food`:** body, food, check-in, phase wizard, nutrition Today cards.
  - **WT-J `m3-program`:** program editor, library, gyms, per-gym overrides, planned-volume preview.
  - **WT-K `m3-insights`:** progress charts, volume dashboard, stall and deload cards. The lagging-muscle ramp prompt is a stretch goal.
  - **WT-L `m3-settings`:** settings, profile, data screens.

**M3 is done when:**
- Component tests pass: the logger prefill matches the snapshot, saving a set starts the timer, a finished session is read-only; the Settings screen renders an editable input for every Heuristic key in the registry.
- The Playwright smoke test passes: start Push → log sets → finish → summary shows the next suggestion.
- It works one-handed at 360–412 px width.

**M4 PWA, offline, notifications, deploy** (WT-M `m4-platform` can run in parallel from WT-G, then an integration pass):
- **Service worker and install:**
  - `sw.ts` precaches the build and uses `cleanupOutdatedCaches`.
  - Manifest: `id`, `start_url`, `scope` all `/Exersise-Applet/`; `display: standalone`; 192 and 512 icons plus maskable.
  - Install prompt.
  - Update toast, deferred while a session is in progress.
- **Rest alerts** (`platform/restAlerts.ts`):
  - One single-shot `setTimeout` per alert time. The timer state is persisted in `appState.restTimer` so it survives a reload.
  - Visible page: vibrate, Web Audio oscillator beep, banner.
  - Hidden page: `registration.showNotification('Rest done', {tag:'rest', renotify:true, vibrate, data:{url}})`.
  - When the page becomes visible again, close the rest notification and resync from timestamps.
- **Wake lock:** re-acquired on `visibilitychange`.
- **Storage:** request `navigator.storage.persist()` after install or the first finished session, and show the result in Settings.
- **Offline test:** Playwright goes offline, reloads, and the app renders.

**M4 is done when:** the app is installable on your phone; Airplane-mode reload works; the `docs/DEVICE-CHECK.md` matrix is recorded (timer with screen on + wake lock, app backgrounded, screen locked; notification tap resumes the logger; backup saved to Files; CSV shared to Drive; persisted = true); the production deploy is live.
- If the locked-screen alert turns out late, add an opt-in "keep-alive silent audio" setting.

**Parallel-work rules:**
- The lead owns `types.ts`, `registry.ts`, `routes.tsx` and `package.json`. Any change to them goes through the lead.
- Each worktree runs `npm ci` (node_modules aren't shared), rebases on `main` before merging, and needs green CI.
- Critical path: M0 → M1.0 → (WT-A ‖ WT-C ‖ WT-E) → services → WT-H → M4 device check.

## (g) Risks and gotchas

- **Android background timers:**
  - Chrome throttles hidden pages and may freeze a locked-screen page. The Notification Triggers API never shipped, and there's no push server.
  - Mitigations:
    - Timers are computed from timestamps.
    - Timeouts are single-shot, which avoids Chrome's heavier throttling of chained timers.
    - The notification is fired from the page when it's hidden.
    - The wake lock (default on) keeps the page in the foreground.
    - When the page returns, it catches up ("Rest ended 0:40 ago").
    - Verify on the device, with the audio keep-alive as a fallback.
  - Also note:
    - `navigator.vibrate` needs a prior tap and does nothing on a hidden page.
    - The AudioContext must be resumed inside a tap.
    - Notification permission must be requested from a tap.
- **IndexedDB persistence:** data can be evicted without `persist()`, and clearing Chrome's site data (possibly also uninstalling) wipes it. Mitigations: show persistence status, remind you to back up every 7 days (`lastBackupAt`), and offer "back up current data first" before any restore.
- **Dexie:**
  - Never await a non-Dexie promise inside a transaction, because the transaction auto-commits. Compute first, then write.
  - Booleans and nulls can't be indexed.
  - Keep old version declarations, and make upgrade functions pure and self-contained.
  - Handle `versionchange` and `blocked`.
  - Test migrations with fake-indexeddb.
- **GitHub Pages:**
  - The path is `/Exersise-Applet/`; treat the base as case-sensitive and matching the repo spelling exactly.
  - Renaming the repo breaks the installed app's start_url and scope. Data survives, since IndexedDB is per origin.
  - The origin `throbbingmember69.github.io` is shared with every other Pages project of yours, so use a unique database name and service-worker scope, and never register a root-scoped worker from another repo.
  - Keep SW dev mode off and test the service worker with `vite preview`.
  - Pages sends `max-age=600`, but the service-worker script bypasses the HTTP cache by default, so updates still arrive.
- **Floating point and units:**
  - Store lb at full precision and round only in formatters.
  - Compare loads with `loadsEqual`.
  - Use `roundHalfAway`, since `Math.round(-10.5)` gives −10.
  - 2.5 lb and 0.5-set values are exact in binary.
  - A whole-kg entry must display back unchanged (property test).
  - CSVs always use lb with unit-suffixed headers.
- **Dates and timezones:**
  - Never call `new Date('YYYY-MM-DD')`, which parses as UTC midnight and shifts the day.
  - Store `LocalDate` strings, and do date math with UTC day numbers.
  - A session's date is the local date when it started (store `tzOffsetMin` as well).
  - Training weeks start Monday by default and are separate from the phase-relative check-in weeks.
- **Windows and repo setup:** the folder path has spaces and `&`, so quote paths. Use LF line endings via `.gitattributes`. PATH isn't refreshed after winget in the running session.
- **Service-worker updates:** with `registerType: 'prompt'`, never auto-reload during an in-progress session.
- **Restore safety:** validate with zod, check the version, do it in a single transaction, and warn if the backup has fewer rows than the current data.

## Acceptance criteria → tests

| Criterion | Test (milestone) |
|---|---|
| Logging never changes past sessions | `db/sessionImmutability.test.ts` (M2) + frozen-input purity tests (M1) |
| Loads follow the flowchart, including the 2-miss rule | `domain/progression/flowchart.test.ts` (M1) |
| Seed volume (all 12 rows, 94 sets) | `domain/volume.seed.test.ts` imports `src/seed` (M1) |
| Seed targets 2,700 / 3,000 / 150 g; cut 2,200 / 170 g (±50 kcal, ±5 g) | `domain/nutritionTargets.seed.test.ts` (M1) |
| No change in week 1 | `domain/checkin.test.ts` (M1) |
| Every Heuristic setting editable | `registry.test.ts` (every spec Default-settings row mapped; all editable) (M1) + `features/settings/Settings.test.tsx` (M3) |
| lb/kg changes display only | `units.property.test.ts` (M1) + `db/unitsSwitch.test.ts` (M2) |
| CSV has every set with date, exercise, load, reps, RIR | `domain/csv.test.ts` (M1) + `db/csvExport.test.ts` (M2) |

### Critical Files for Implementation
- C:\Users\Edward\Documents\Exersise Applet\src\domain\types.ts
- C:\Users\Edward\Documents\Exersise Applet\src\domain\progression\evaluate.ts
- C:\Users\Edward\Documents\Exersise Applet\src\seed\program.ts
- C:\Users\Edward\Documents\Exersise Applet\src\db\schema.ts
- C:\Users\Edward\Documents\Exersise Applet\src\services\sessionService.ts

Source inputs: `C:\Users\Edward\Documents\Exersise Applet\Training & Bulk Cut Plan Findings and Applet Spec.md` and `C:\Users\Edward\.claude\projects\C--Users-Edward-Documents-Exersise-Applet\34d13b58-b87b-49b1-858b-8e26a287c5ed\tool-results\bh9ezmppk.txt` (copy the second into `docs/DECISIONS.md` in M0).
