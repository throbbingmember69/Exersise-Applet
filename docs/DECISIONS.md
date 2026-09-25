# Decisions

Binding decisions for the Exercise Applet. **Precedence:** the user decisions below override everything else; then the adopted defaults; then each audit finding's recommended default; then the spec (`Training & Bulk Cut Plan Findings and Applet Spec.md`) where it is unambiguous.

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

## Spec audit: confirmed findings

A read-only audit of the spec (3 lenses plus a verifier) confirmed 55 findings and rejected 7. Findings marked *needs user input* were resolved by the user decisions above.

### 1. `platform-storage-backup` (Architecture / platform)
*blocks implementation, needs user input*

**Issue:** This is the largest open architectural decision, and the user asked to be consulted on those. The features point to a phone used at the gym (per-set logging, rest timer). But 'persist locally' for a single user means one device, with no sync or backup unless someone designs it in. The only way out is CSV export, and nothing can import it back, so losing the device loses the data. The platform choice decides the storage engine, whether the rest timer can alert with the screen locked or the app in the background, how CSV files get saved, and whether the new GitHub repo can host the app.

**Spec quote:** Platform and tech stack are open; data must persist locally and export to CSV.

**Options:**
1. Installable web app (PWA): static site, IndexedDB storage, works offline on a phone, free hosting on GitHub Pages
2. Native mobile app (React Native/Expo + SQLite): reliable background timer alerts, but installed through an app store or sideloading
3. Local desktop/web app (Node or Python + SQLite) on a laptop, with logging done after the gym
4. Any of the above plus a user-triggered full JSON backup and restore

**Recommended default:** Ask the user. Proposal to confirm: an offline-first PWA using IndexedDB, single user on one device, no accounts, hosted on GitHub Pages, with a JSON backup/restore in addition to the CSV export.

### 2. `history-corrections-policy` (Data integrity / history)
*blocks implementation, needs user input*

**Issue:** The spec forbids overwriting history but gives no way to fix mistakes. A mistyped load (2250 instead of 225) would corrupt e1RM, stall and progression results, and an accidental or duplicate session can't be removed. It isn't stated whether the in-progress session is editable. It also isn't stated whether the rule covers BodyEntry and NutritionEntry. NutritionEntry is a daily total that naturally gets updated through the day, and one mistyped weigh-in shifts the α = 0.1 trend enough to cause a false band miss.

**Spec quote:** Logging a session never changes a past session's data." / "Never overwrite a past session.

**Options:**
1. Sessions are editable while in progress. After finishing, corrections are stored as append-only revisions and deletes are soft voids; the original is kept but left out of calculations
2. Everything editable in place, with a change log
3. Strictly immutable: a wrong entry can only be voided and re-entered
4. Immutability for sessions and sets only; body and nutrition entries are editable in place, with a confirm prompt for weigh-ins more than 3% from the trend

**Recommended default:** Read the rule as 'logging or editing one session never changes another'. Sessions are editable while in progress. Finished records are corrected or voided through append-only revisions (the latest wins, the original is kept, voided records are excluded from calculations). Daily nutrition totals stay editable. Ask for confirmation on a weigh-in more than 3% from the trend.

### 3. `prescription-snapshot` (Data model / Program editor)
*blocks implementation, needs user input*

**Issue:** A Session records only programDayId and a SetLog only exerciseId. The rep range, RIR target, set count, step and muscle weights all live on editable Exercise and ProgramDay records. After any program edit, past 'top of range' and 'below range' results, miss streaks, stall windows and past weekly volume would all be silently reinterpreted. The 'follow the flowchart exactly' test also can't be audited, because nothing stores the load that was suggested. The editor's scope isn't stated either: adding, removing or reordering exercises and days, changing a day's weekday, and deleting an exercise that has history.

**Spec quote:** edit exercises, sets, rep ranges, RIR, rest, step size and muscle weights." / "| Session | id, date, programDayId, bodyweightLb |

**Options:**
1. When a session starts, store a SessionExercise snapshot row (repMin/Max, rirMin/Max, targetSets, suggestedLoadLb, stepLb, muscleWeights)
2. Version the program: a ProgramVersion with an effective date, referenced by each Session
3. Always evaluate history against current values and accept that it gets reinterpreted

**Recommended default:** A SessionExercise snapshot row created when the session starts. Exercises and days with history are archived, never hard-deleted. The editor supports adding, removing and reordering exercises and days and changing a day's weekday.

### 4. `per-item-prescription` (Data model / Training program)
*blocks implementation*

**Issue:** Leg extension is 10–15 reps on Lower A and 12–15 on Lower B. Rep range, RIR and rest are stored on Exercise, and ProgramDay items hold only a set count, so the seed program can't be stored as written. The workarounds either split the exercise's history (a second Exercise record) or change the program (one shared range). The other five exercises that appear on two days differ only in set count, which items already hold.

**Spec quote:** | 2 | Leg extension | 3 × 10–15 | 0–1 | 90 s | 170 | 5 |" vs "| 5 | Leg extension | 2 × 12–15 | 0–1 | 90 s | 170 | 5 |"; "id, name, repMin, repMax, rirMin, rirMax, restSec, stepLb"; "id, name, weekday, items

**Options:**
1. Optional per-item overrides of repMin/repMax/rirMin/rirMax/rest on ProgramDay items, with Exercise holding the defaults
2. Create a separate Exercise record for each day ('Leg extension (A)' and '(B)'), each with its own history
3. Use one range on both days and update the doc

**Recommended default:** Per-item overrides of rep range, RIR and rest, falling back to the Exercise defaults. Exercise keeps identity, step, loadType and muscle weights.

### 5. `nutrition-history-model` (Data model: Phase / CheckIn / target history)
*blocks implementation*

**Issue:** An accepted check-in can only be stored by overwriting Phase.kcalTarget. That loses which target applied on which day and conflicts with 'never overwrites history'. There's no effective date, and no way to record applying a different amount than suggested. It isn't stated how macros change after a kcal change: whether protein stays fixed, fat stays at 25% of the new kcal, or carbs absorb all of it. CheckIn has no phaseId, and its boolean 'accepted' can't tell pending from skipped. It also has no applied amount, no data-sufficiency result (logging %, whether the TDEE is formula, measured or insufficient), no suggestion type, no record of phase-switch prompts, and no snapshot of the band and trend used. Phase has no field for the maintenance kcal used at the start or its source, the target rate, the protein basis and multiplier, planned or maximum weeks, or a diet-break link. The order of rateMinPct and rateMaxPct for negative cut rates is undefined.

**Spec quote:** | Phase | id, type (bulk, maintenance, cut), startDate, endDate?, rateMinPct, rateMaxPct, kcalTarget, proteinG, fatPct, bfCeilingPct?, bfTargetPct? |"; "| CheckIn | weekStart, trendRatePct, tdeeEstimate, suggestedKcalChange, accepted |

**Options:**
1. New TargetRevision entity {id, phaseId, effectiveDate, kcal, proteinG, fatPct, source (phaseStart | checkIn | manual), checkInId?}
2. Effective target = Phase.kcalTarget + the sum of applied CheckIn changes (add appliedKcalChange and effectiveDate to CheckIn)
3. Overwrite Phase.kcalTarget (not recommended)
4. Extend CheckIn and Phase with snapshot fields, or keep them minimal and recompute on the fly (not reproducible after data edits)

**Recommended default:** Use the TargetRevision entity. A change takes effect the day after the check-in; protein grams stay fixed, fat is fatPct of the new kcal, and carbs fill the rest. Extend CheckIn with phaseId, dueDate, phaseWeekIndex, trendWeightLb, trendRatePct, bandMin/MaxPct, intake and weigh-in logged %, tdeeEstimate and tdeeSource, suggestionType, suggestedKcalChange, status (pending/accepted/skipped), appliedKcalChange and the switch prompt with the user's response. Extend Phase with maintenanceKcalAtStart and its source, targetRatePct, protein basis and multiplier, plannedWeeks, maxWeeks and parentPhaseId?. Require rateMinPct < rateMaxPct numerically.

### 6. `settings-store` (Data model: settings)
*blocks implementation*

**Issue:** There's no Settings entity. activityFactor sits on UserProfile and also in the settings table. The body-fat ceiling and target exist both as global settings and as optional Phase fields, with no rule for which wins. Many values tagged Heuristic in the body have no settings row, so 'every Heuristic setting is editable' can't be checked. Missing rows: drop %, e1RM rep cutoff, deload set fraction and load cut, the 'several' stall count, stall-remedy length, the cut-ending e1RM drop and its window, the 100–150 kcal step, first-week exclusion, maintenance length, body-fat averaging and the lagging-muscle ramp. It also isn't stated whether changing a setting (e.g. α) recomputes derived history.

**Spec quote:** Every setting tagged Heuristic is editable." / "| UserProfile | name, sex, age, heightIn, units (lb or kg), activityFactor |

**Options:**
1. A Settings singleton (key/value with default and tag); a Phase copies the relevant thresholds when created and can override them
2. All settings on UserProfile
3. Versioned settings with effective dates

**Recommended default:** A Settings singleton, with a row added for every numeric value the v1 engine automates. A Phase copies the body-fat and length thresholds when created, and the Phase value wins. Derived series (trend, TDEE, volume) are recomputed with current settings; accepted check-ins and session snapshots keep their stored numbers.

### 7. `start-load-storage` (Data model / Seed data)
*blocks implementation*

**Issue:** The 'Start load (lb)' column has nowhere to go. Neither Exercise nor ProgramDay items have a load field, and SetLog is empty at install, so the first pre-fill has no source. Nothing stores the current suggested load or miss count either; these can only be derived from history.

**Spec quote:** Starting loads are your current sheet weights"; "Seed data: program days and exercises from Training program

**Options:**
1. A nullable startLoadLb on the progression-track owner (the item, or Exercise), used only until history exists; all later state is derived from SetLog
2. Seed a synthetic baseline session for each exercise
3. Add a ProgressionState entity (track, currentLoadLb, missCount, lastSessionId) seeded from the start loads

**Recommended default:** A nullable startLoadLb on whatever owns the progression track, with all later state derived from SetLog. Avoid synthetic sessions: they would pollute e1RM, volume and the CSV export.

### 8. `shared-progression-track` (Progression engine)
*blocks implementation, needs user input*

**Issue:** Six exercises appear on two program days: leg extension, seated leg curl, hip thrust, standing calf raise and cable crunch on Lower A/B, and machine lateral raise on Push/Upper. Their set counts often differ between the days. The doc doesn't say whether Monday's result sets Friday's pre-fill, whether a Monday miss followed by a Friday miss counts as the 'second session in a row', or whether a step earned on the 2-set day carries over to the 3-set day. The words 'per exercise' and the identical start loads suggest one shared track, but the different prescriptions make that awkward.

**Spec quote:** The applet runs this check per exercise after each session and pre-fills the next session with the suggested load.

**Options:**
1. One shared track per Exercise: sessions are ordered by date across days, and the miss counter spans both days
2. A separate load and miss-counter track per (programDay, exercise) item; e1RM trends and stall detection are still pooled per exercise
3. Shared load, with a separate miss counter per day

**Recommended default:** A separate track per ProgramDay item, with both days seeded from the same start load. e1RM trends and stall detection are pooled per Exercise. Confirm with the user, since the literal 'per exercise' wording leans toward a shared track.

### 9. `either-or-variants` (Training program / Data model)
*blocks implementation, needs user input*

**Issue:** Three slots each name two exercises whose loads can't be compared: machine stack vs dumbbells per hand, a 315 lb deadlift vs a much lighter RDL, and split-squat dumbbells vs a leg-press sled. The split squat/leg press slot also gives a step of '5–10', but stepLb holds one number. Storing each slot as one Exercise would mix histories and corrupt progression, e1RM and stall detection. The doc doesn't say whether the user picks one variant once or can swap per session.

**Spec quote:** Deadlift (or Romanian deadlift)"; "Flat machine or DB press (new)"; "Bulgarian split squat or leg press (new)"; "| Set in week 1 | 5–10 |

**Options:**
1. Pick one variant per slot at setup and seed only that; switching later is a program edit
2. Seed both variants as separate Exercises; the item holds a primary exerciseId plus alternates, and the logger allows a swap per session
3. One Exercise with a free-text variant note, accepting mixed history

**Recommended default:** Separate Exercises, with a primary and alternates on the item and a per-session swap. The step follows the variant: split squat 5 lb per hand, leg press 10, RDL 10. Planned volume doesn't change because both variants share muscle weights. Ask the user which variant is the default in each slot.

### 10. `every-set-at-top-evaluation` (Progression engine)
*blocks implementation*

**Issue:** The doc doesn't say which sets the flowchart evaluates: every logged set, or only the prescribed number. Open cases: fewer sets logged than prescribed (2 of 3, both at the top: does that earn a step?), extra sets, reps above repMax, an exercise skipped entirely, and a failed 0-rep set.

**Spec quote:** B{Every set at top<br/>of rep range?}"; "Step is the load added once every set reaches the top of its range.

**Options:**
1. Evaluate exactly the prescribed working-set count. Missing sets count as 'not at top' but not 'below'; extra sets are ignored; reps ≥ repMax is top; reps < repMin (including 0) is below. A skipped exercise isn't evaluated and its suggestion carries forward
2. Evaluate every logged working set, so fewer sets than prescribed can still earn a step
3. Evaluate only when the logged set count matches the prescription; otherwise keep the same load

**Recommended default:** Evaluate the prescribed working-set count as described in the first option.

### 11. `mixed-load-base` (Progression engine)
*blocks implementation*

**Issue:** The flowchart assumes one working load per exercise per session, but SetLog stores a load for each set, and users will change weight mid-exercise or ignore the pre-fill. 'Add one step', 'same load' and 'drop' each need a base load. The doc doesn't say which: the suggested load, the first set, the heaviest set or the lowest.

**Spec quote:** | SetLog | id, sessionId, exerciseId, setIndex, loadLb, reps, rir, note? |"; "C[Next session:<br/>add one step]

**Options:**
1. Use the logged loads; when sets differ, take the lowest working-set load and show a notice
2. The first working set's load
3. The previous suggested load, ignoring what was actually lifted
4. The most common load, with ties going to the heaviest

**Recommended default:** Base on logged loads, never on the suggestion. When loads differ, use the lowest working-set load and show a notice.

### 12. `drop-amount-and-rounding` (Progression engine)
*blocks implementation*

**Issue:** There's no single percentage and no rounding rule. Raw 5–10% cuts usually give loads that can't be set on the equipment. On light loads 5% is less than one step, so rounding to the nearest step can mean no drop at all. Some start loads aren't multiples of their step (53 lb with a 5 lb step), so 'round to a multiple of the step' is ambiguous. Machines whose stack jump differs from the step add another case. The deload's '~10% lighter' has the same problem.

**Spec quote:** H[Drop load 5–10%]"; "| Miss rule | 2 sessions below range, then 5–10% less load | Heuristic |"; "if a machine's smallest stack jump differs from the step shown, use the machine's jump.

**Options:**
1. Fixed 10%, editable: drop floor(pct × load ÷ step) whole steps from the current load, minimum 1 step
2. Fixed 5% with the same rounding
3. Editable percent, rounded to the nearest multiple of the step
4. Always drop exactly one step and ignore the percentage

**Recommended default:** Editable percent, default 10%. Drop floor(pct × load ÷ step) whole steps (minimum 1), counted from the current load and using the machine's jump where set. Use the same routine for the deload load cut.

### 13. `miss-streak-reset` (Progression engine)
*blocks implementation*

**Issue:** The doc doesn't say when the below-range streak resets. After a drop, a third straight miss could trigger another drop immediately. It's also unclear whether misses at different loads chain (for example after the user changes the load by hand), and whether a deload, a skipped exercise or a long break ends the streak.

**Spec quote:** F{Second session<br/>in a row?}

**Options:**
1. Count consecutive evaluated sessions with any set below repMin. Reset on any session with none below, after a drop, after any load change and after a deload
2. Count consecutive below-range sessions regardless of load; reset only on a session with none below
3. The first option, plus a reset after a gap of more than 14 days

**Recommended default:** The first option, with deload sessions excluded from evaluation. Count sessions of that exercise (or program item), not calendar days.

### 14. `warm-up-sets` (Logging / Progression / Volume)
*blocks implementation*

**Issue:** The doc never mentions warm-ups, and SetLog has no set-type field. A logged warm-up (e.g. 5 reps before a 6–10 range) counts as below range. It fails 'every set at top', trips the miss rule and inflates volume.

**Spec quote:** record load, reps and RIR (0–5) for every set

**Options:**
1. Don't log warm-ups; the logger shows only the prescribed working sets
2. Add SetLog.isWarmup (default false), excluded from progression, volume, e1RM and stall, and flagged in the CSV
3. Automatically treat sets below X% of the working load as warm-ups

**Recommended default:** An isWarmup flag, default false, excluded from every engine calculation.

### 15. `set-in-week-1-calibration` (Progression engine / Seed data)
*blocks implementation*

**Issue:** Two slots have no start load. The doc doesn't say what the logger pre-fills for them. It also doesn't say whether the calibration session, which will probably include several trial loads, goes through the flowchart. If it does, a too-heavy first try counts as a miss and a too-light one earns a step. Nor does it say which trial load becomes the base for the next session.

**Spec quote:** "Set in week 1" means find a load that fits the rep range and RIR.

**Options:**
1. Blank pre-fill; the first session is evaluated normally
2. Blank pre-fill; the first session is calibration (no miss or step evaluation), and the next pre-fill is the last working set's load
3. Ask the user for an estimate at setup

**Recommended default:** Blank pre-fill with the hint 'find a load for X–Y reps at RIR a–b'. The first session is calibration and isn't evaluated; the next suggestion uses the last working set's load.

### 16. `e1rm-metric-and-best-set` (Progression engine / e1RM)
*blocks implementation*

**Issue:** 'Best set' isn't defined: highest e1RM, heaviest load or most reps. The '~12' cutoff isn't exact (above 12, or 12 and up). Many seeded ranges straddle 12 (10–15, 10–20, 12–15, 12–20). If the rule is applied per set, those exercises would flip between e1RM and reps-at-load from session to session, breaking trend charts and stall detection.

**Spec quote:** Use each session's best set."; "e1RM is least reliable above ~12 reps; for those, track reps at a given load instead.

**Options:**
1. Per exercise: repMax ≤ 12 uses e1RM with the highest-Epley set as best; repMax > 12 uses reps-at-load with the heaviest set as best (ties go to most reps)
2. Per set: exclude sets above 12 reps from e1RM, and fall back to reps-at-load when a session has none
3. Always compute e1RM and mark values from sets above 12 reps as low-confidence

**Recommended default:** Choose the metric per exercise from repMax, with an editable cutoff (default 12; the metric switches strictly above it). Exclude 0-rep and warm-up sets.

### 17. `stall-definition` (Progression engine / Stall)
*blocks implementation*

**Issue:** The baseline for a 'gain' isn't defined: the previous session, the best before the window, or the all-time best. For reps-at-load, it isn't said whether a load increase with fewer reps counts as a gain. After a miss-rule drop or a deload, e1RM falls by design, and the doc doesn't say whether those sessions count toward a stall. There's also no rule for when a stall flag clears.

**Spec quote:** no e1RM (or reps-at-load) gain in 3 straight sessions of an exercise

**Options:**
1. Stall when the best metric in the last 3 sessions isn't higher than the best of all earlier sessions (needs at least 4 sessions). A reps-at-load gain is more reps at the same or higher load, or any load increase with reps ≥ repMin. Exclude deload and post-drop sessions; clear the flag on the next gain
2. Stall when each of 3 consecutive sessions fails to beat the one before it
3. Stall when the best of the latest 3 sessions is below the all-time best

**Recommended default:** The first option.

### 18. `bodyweight-plus-load` (Progression engine / e1RM / Data model)
*blocks implementation*

**Issue:** '+50 added' and the display rule imply SetLog.loadLb holds only the added load. Three things remain unstated. First, where Session.bodyweightLb comes from: the same-day weigh-in, trend weight, or manual entry. Second, what the 5–10% drop applies to; added load and total system load give drops that differ about fourfold. Third, how zero or assisted (negative) added load is handled.

**Spec quote:** put bodyweight + added load into the formula, then subtract bodyweight for display."; "| Session | id, date, programDayId, bodyweightLb |

**Options:**
1. loadLb = added load (0 or negative allowed for assisted). Session.bodyweightLb auto-fills from the same-day BodyEntry, otherwise the latest trend weight, and is editable. The drop % applies to the added load
2. loadLb = added load, but the drop % applies to total system load and is converted back
3. loadLb = total system load

**Recommended default:** The first option.

### 19. `main-lifts` (Phase switching / Progression engine)
*blocks implementation, needs user input*

**Issue:** 'Main lifts' are never listed, and Exercise has no flag for them. The doc doesn't say how lifts are combined (any one, a majority, or the mean) or how the drop is measured (best e1RM now vs 3 weeks ago, vs the cut's peak, or a slope). It doesn't say whether the chin-up uses total load; bodyweight loss on a cut lowers its total-load e1RM by itself. Variant swaps (deadlift/RDL) would produce false drops. Nor does it say whether ~5% and 3 weeks are editable settings. The deload's 'several lifts' also depends on what counts as a lift.

**Spec quote:** if main-lift e1RMs fall more than ~5% over 3 weeks

**Options:**
1. Add Exercise.isMainLift and seed the compounds (Smith squat, deadlift, incline DB bench, overhead press, machine barbell row, with or without the weighted chin-up)
2. Trigger when the mean change across main lifts is below −5%
3. Trigger when any single main lift falls more than 5%
4. Trigger when a majority of main lifts fall more than 5%

**Recommended default:** An isMainLift flag. For each lift, compare the best e1RM in the last 7 days with the 7-day window ending 21 days earlier. Prompt when the mean change across lifts with data is below −5% (threshold and window editable). Skip a lift whose variant changed within the window. Ask the user which lifts count and whether chin-ups are included.

### 20. `deload-trigger` (Progression engine / Deload)
*blocks implementation*

**Issue:** 'Several' has no number, 'at once' has no time window, and 'lifts' isn't defined. There's no input for 'joints ache' anywhere: Session has no wellness field and SetLog has only a free-text note. The doc also doesn't say how a deload suggestion interacts with individual stall remedies.

**Spec quote:** if several lifts stall at once or joints ache, suggest a week at about half the sets and ~10% lighter loads

**Options:**
1. Trigger at 3 or more exercises with concurrent active stall flags (editable). Add an optional Session.jointPain flag that triggers when set in 2 of the last 3 sessions, plus a manual 'suggest deload' button
2. Trigger when 2 or more main lifts are stalled; joint pain only through a manual button
3. Trigger when 25% or more of program exercises are stalled, and scan notes for pain keywords

**Recommended default:** The first option. While a deload is suggested, hide individual stall remedies.

### 21. `deload-execution` (Progression engine / Deload)
*blocks implementation*

**Issue:** Several parts are unspecified. (1) Halving odd set counts: rounding up leaves 58 of the 94 seed sets and rounding down (minimum 1) leaves 36, so neither is half. (2) How to round the lighter load. (3) Whether 'a week' means 7 days or one pass through the 5 program days. (4) Whether deload sessions feed the flowchart, miss counter, stall check and e1RM. (5) How the volume dashboard shows a deload week, when every muscle would flag 'low'. (6) Where loads resume afterwards. No Session field marks a deload.

**Spec quote:** suggest a week at about half the sets and ~10% lighter loads"; "trigger them from data, not the calendar

**Options:**
1. Add Session.isDeload. Sets = ceil(sets/2); load = the pre-deload suggestion cut 10% using the drop routine; lasts one program cycle (5 sessions). Excluded from progression, stall and miss logic; the dashboard marks the week without low flags; afterwards loads resume at the pre-deload suggestions
2. Same, but sets = floor(sets/2) with a minimum of 1, lasting 7 calendar days
3. Advisory text only; the engine doesn't change anything

**Recommended default:** The first option.

### 22. `rest-timer` (Workout logger / Data model)
*blocks implementation*

**Issue:** Four compounds (Smith squat, incline DB bench, overhead press, weighted chin-up) list rest as '2–3 min', but restSec holds one value. The timer's behavior is also unspecified. It isn't said whether it starts automatically when a set is saved or by hand, or what alert it gives when the screen is locked or the app is in the background (this depends on the platform). It also isn't said whether it runs after an exercise's last set, or whether it can be paused, extended or skipped.

**Spec quote:** with a rest timer using each exercise's rest value"; "| 1 | Smith machine squat | 4 × 6–10 | 1–2 | 2–3 min | 220 | 10 |

**Options:**
1. Store restMinSec and restMaxSec; alert at the minimum and again at the maximum
2. Single restSec = lower bound (120 s)
3. Single restSec = midpoint (150 s)
4. Timer started by hand vs started automatically when a set is saved

**Recommended default:** Store the minimum and maximum (equal when the doc gives one value). Auto-start when a set is saved, alert at the minimum and again at the maximum, and provide +30 s and skip controls. Background notifications only if the chosen platform supports them.

### 23. `volume-planned-vs-logged` (Volume dashboard)
*blocks implementation*

**Issue:** The acceptance test implies planned volume (program sets × muscle weights). The seed program reproduces every row of the Weekly totals table and the 94-set total. On a tracker, though, 'weekly fractional sets' could equally mean logged sets, which change whenever a session is skipped, and a partial current week would flag every muscle as low. It isn't said which logged sets count as 'hard sets' (for example, sets at RIR 4–5). The session-cap warning could be checked on planned ProgramDay sets, on logged sets per Session, or both. The seed program peaks below the cap, so it never fires at the start.

**Spec quote:** weekly fractional sets per muscle against the 10–20 band, plus a warning when one session exceeds 11 for a muscle."; "With the seed program, weekly fractional sets match Volume accounting (quads 13.5, chest 14, triceps 16).

**Options:**
1. Planned volume only, computed from the current program
2. Logged volume only; the acceptance test uses a synthetic, fully logged week
3. Both: planned (editor plus a reference column) and logged actuals for each completed week, with band flags on each

**Recommended default:** Show both; the acceptance test checks the planned numbers. The current week shows progress toward the plan, with no 'low' flags until the week ends. Count every logged working (non-warm-up) set. The session cap warns in the editor on planned sets per day and on the dashboard on logged sets per session, at strictly more than 11.

### 24. `training-week-boundary` (Volume dashboard / Deload / Stall)
*blocks implementation*

**Issue:** Weekly logged volume, the deload 'week' and the 2-week stall remedy all need a defined window. If a session slides (Upper done Sunday, Lower A on Monday), a Mon–Sun week could contain two Lower A sessions and no Upper. The doc doesn't say whether training weeks line up with check-in weeks.

**Spec quote:** Train five days in this order: Mon Lower A, Tue Push, Wed Pull, Thu off, Fri Lower B, Sat Upper, Sun off.

**Options:**
1. Calendar week starting Monday (start day editable), independent of check-in weeks
2. Rolling last 7 days
3. One program cycle (each of the 5 days logged once) counts as a week
4. Align with the check-in week

**Recommended default:** Calendar week Mon–Sun with an editable start day, separate from check-in weeks.

### 25. `session-lifecycle` (Data model: Session)
*blocks implementation*

**Issue:** Session has no status or timestamps. These are needed to resume a workout after the app closes, to know when the 'after each session' progression check runs, and to decide whether sets in the current session are still editable. There's no session-level note. It isn't stated whether two sessions on one date, or a session with no program day (ad hoc), are allowed.

**Spec quote:** | Session | id, date, programDayId, bodyweightLb |"; "The applet runs this check per exercise after each session

**Options:**
1. Add status (in progress / finished / abandoned), startedAt, finishedAt and note; progression runs when a session is marked finished
2. No status; every save is final and progression runs on each save

**Recommended default:** The first option. Allow multiple sessions per date and a nullable programDayId for ad hoc sessions. The jointPain and isDeload fields come from the deload findings.

### 26. `kcal-target-derivation` (Nutrition targets / phase setup)
*blocks implementation*

**Issue:** No setting defines how a phase's starting kcal target is derived from maintenance, and Phase stores no offset. The doc gives several rules that disagree at the computed seed maintenance of about 2,713: +10–15% (targets table), +10–20% (evidence bullet), 'about +300', '0.5 lb a week', or the rate band. The resulting bulk targets range from about 2,965 to 3,120 kcal. For the cut, −500 and the band midpoint agree at 163 lb but drift apart at post-bulk weight. Phase setup asks for a rate band but never says how the band sets kcal.

**Spec quote:** | Change vs. maintenance | +10–15% (about +300) | 0 | About −500 |"; "+10–20% over maintenance and 0.25–0.5% bodyweight a week suit novices and intermediates

**Options:**
1. Fixed editable kcal offsets: bulk +300, maintenance 0, cut −500
2. Percent of maintenance (e.g. bulk +11%)
3. Rate-derived offset = target rate × trend weight × 3,500 ÷ 7, with the target rate defaulting to the band midpoint
4. The user types kcal directly, and the app shows the implied rate

**Recommended default:** Rate-derived offset from the band midpoint, rounded to the nearest 50 and editable before confirming. For the seed profile this reproduces about 3,000 for the bulk and 2,200 for the cut. Show the implied % surplus and warn above 15%.

### 27. `maintenance-protein` (Nutrition targets)
*blocks implementation*

**Issue:** The targets table gives maintenance protein as 150 g, but Default settings has rules only for bulk (g/kg bodyweight) and cut (g/kg lean mass). There's no rule for maintenance phases or diet-break weeks.

**Spec quote:** | Protein (g/day) | 150 (range 120–165) | 150 | 170 (range 145–195) |"; "| Bulk protein | 2.0 g/kg bodyweight | Evidence |

**Options:**
1. 2.0 g/kg bodyweight, the same as the bulk
2. 1.6 g/kg bodyweight
3. Carry over the previous phase's protein grams
4. 2.7 g/kg lean mass, the same as the cut

**Recommended default:** Add a 'Maintenance protein' setting of 2.0 g/kg trend bodyweight. Diet-break weeks keep the cut's protein.

### 28. `phase-start-recalc-inputs` (Phase switching / recalculation)
*blocks implementation*

**Issue:** Several inputs to phase-start recalculation are unstated. (1) Which body-fat value feeds lean mass for cut protein and Katch-McArdle: the latest reading, an average, or the seed value. (2) What to use when there's no valid measured maintenance (first phase, under 14 days of data, under 80% logged) or no body-fat reading at all. (3) Whether the formula fallback uses trend weight. (4) Whether new targets apply automatically or are proposed for the user to confirm.

**Spec quote:** each phase's targets from current trend weight and measured maintenance when the phase starts

**Options:**
1. Lean mass = trend weight × (1 − latest body-fat reading)
2. Lean mass = trend weight × (1 − smoothed body fat, as in the body-fat smoothing finding)
3. With no valid measured TDEE, fall back to the formula average × activity factor using trend weight; with no body-fat reading, use Mifflin-St Jeor alone
4. Apply new targets automatically vs show a proposed-targets screen to confirm or edit

**Recommended default:** Lean mass from trend weight and smoothed body fat. Use the last valid measured TDEE, otherwise the formula with trend weight (Mifflin-St Jeor only if there's no body-fat data). Always show the proposed targets for confirmation and editing before the phase starts.

### 29. `tdee-cap-scope` (Measured TDEE)
*blocks implementation*

**Issue:** The body text caps the weekly update to measured TDEE, but the settings row caps the target change. Check-in suggestions are already at most 150 kcal, so a target cap only matters at phase starts (about −300 for bulk→maintenance and about −500 for maintenance→cut), where it would block the planned change. It's also unclear whether the first measured estimate is capped against the formula value, which the doc says can miss by a few hundred kcal.

**Spec quote:** cap each weekly update at ±150 kcal so noise doesn't swing targets"; "| Max weekly target change | ±150 kcal | Heuristic |

**Options:**
1. Cap only the week-over-week change in the TDEE estimate
2. Cap only kcalTarget changes, with phase starts exempt
3. Cap both
4. Cap the first measured estimate against the formula value, or leave it uncapped

**Recommended default:** Cap only week-over-week changes in the TDEE estimate. The first valid measured estimate replaces the formula value uncapped, and phase-start target changes are exempt. Rename the setting to 'Max weekly TDEE-estimate change'.

### 30. `tdee-window-and-logging` (Measured TDEE)
*blocks implementation*

**Issue:** Several parts are unstated. (1) When to use 14 days vs 21. (2) What counts as a logged day: intake, a weigh-in, or both. (3) Whether mean kcal is taken over logged days only, and whether 'days' means the calendar span. (4) What happens below 80%. (5) Whether the window may include the first week of a new phase or diet break. Water and glycogen shifts plus EMA lag bias the estimate in that week; for example, it reads low right after a bulk→cut switch.

**Spec quote:** intake and trend change over the last 14–21 days"; "Require at least 80% of days logged

**Options:**
1. Always 21 days when available, otherwise 14
2. The longest 14–21-day window that meets the 80% threshold
3. Always 14 days
4. 80% applies to intake only / to weigh-ins only / to both

**Recommended default:** The longest 14–21-day window where at least 80% of days have a kcal entry and at least 80% have a weigh-in. Mean kcal over logged intake days; days = calendar span. Exclude the first 7 days after a phase or diet-break start. If the rules aren't met, keep the previous estimate and label it 'insufficient data'.

### 31. `trend-ema-initialization` (Body log / trend weight)
*blocks implementation*

**Issue:** The EMA is underspecified. (1) How T_0 is set: the seeded 163 lb entry or the first real weigh-in; a seed that differs from real readings creates a fake slope. (2) Whether t indexes calendar days or weigh-ins. (3) How days without a weigh-in are handled, which determines what T_{t-7} means across gaps. (4) Multiple weigh-ins on one date. (5) The rate before 7 days of history exist. (6) The minimum number of readings for the 7-day average.

**Spec quote:** Trend weight is an exponential moving average with α = 0.1, the Hacker's Diet method; also show the 7-day average.

**Options:**
1. Calendar-day index, T_0 = first weigh-in; the trend carries forward unchanged on missing days
2. Calendar-day index with linear interpolation of interior gaps, carrying forward only at the trailing edge
3. Weigh-in index (T_{t-7} = 7 weigh-ins ago)

**Recommended default:** Calendar-day index with T_0 = first real weigh-in and interpolation of interior gaps. One weight per date (latest entry wins). The rate is undefined until 7 days of history exist. The 7-day average is shown only when there are at least 3 readings in the window.

### 32. `first-week-and-streak` (Weekly check-in)
*blocks implementation*

**Issue:** It's unclear whether week 1 (the no-change week) counts toward 'two weeks running'. Because of EMA lag, week 2's rate still carries about a quarter of any week-1 water shift, which can be enough to push a bulk out of its band on its own. Also unstated: whether the streak resets after an accepted change (EMA lag means a change takes about 2 weeks to show, risking back-to-back corrections) or after a skip, and whether both misses must be in the same direction.

**Spec quote:** | Any | First week of a new phase | No change (water and glycogen shift) |"; "change calories only when the trend misses its band two weeks running

**Options:**
1. Week 1 counts; the earliest change is at the end of week 2
2. Week 1 is excluded; the earliest change is at the end of week 3
3. Weeks 1 and 2 are both excluded
4. After an accepted change, require two fresh misses vs allow consecutive changes

**Recommended default:** Exclude week 1 and require two consecutive misses in the same direction. Reset the streak at phase start and after any accepted change; a skip doesn't reset it.

### 33. `checkin-cadence` (Weekly check-in)
*blocks implementation*

**Issue:** No check-in day is defined. It could follow the training week (starting Monday) or run every 7 days from Phase.startDate. A phase that starts mid-week makes 'first week' and '26 weeks' ambiguous. The doc also doesn't say whether a late check-in is evaluated as of its due date or as of today, or whether missed weeks are backfilled.

**Spec quote:** | CheckIn | weekStart, trendRatePct, tdeeEstimate, suggestedKcalChange, accepted |

**Options:**
1. Phase-relative: due on startDate + 7k
2. A fixed weekday chosen by the user
3. On demand, using the trailing 7 days

**Recommended default:** Phase-relative cadence, evaluated as of the due date even when opened late. Missed weeks are backfilled for history, and only the latest can be acted on. Phase week counts (26/16) use the same anchor.

### 34. `adjustment-step-size` (Weekly check-in)
*blocks implementation*

**Issue:** No rule picks 100, 150 or a value in between for bulk and cut adjustments. The cut band '−0.5 to −0.75' doesn't say which value is rateMinPct, so the 'slower than' and 'faster than' comparisons need a sign convention.

**Spec quote:** Adjust in 100–150 kcal steps."; "| Lean bulk | Below +0.25% bodyweight/week | +100–150 kcal |

**Options:**
1. Always 150 for bulk and cut
2. Always 100
3. Proportional to the distance from the band midpoint, clamped to 100–150 and rounded to 10
4. The user picks within 100–150 at each check-in

**Recommended default:** 150 kcal for bulk and cut (editable), and 100 kcal for maintenance in the direction opposite the trend, as the table says. Store rateMinPct as the numerically smaller value (cut: −0.75 and −0.5).

### 35. `bf-smoothing` (Body log / phase switching)
*blocks implementation*

**Issue:** Body fat is logged weekly, so a '7-day average' is usually a single reading, sometimes none or two. One noisy bioimpedance reading, which the doc says can be off by several points, would trigger the bulk-end prompt. With no reading in the last 7 days the value is undefined. The cut's 12% target has the same problem. Also, BodyEntry requires weightLb, so a scale-only entry is impossible, and the doc doesn't say whether there's one entry per date.

**Spec quote:** when your 7-day average scale body fat reaches your ceiling (default 18%)"; "log scale readings weekly under the same conditions

**Options:**
1. Mean of all body-fat readings in the last 7 days (allow daily entry)
2. Mean of the last 3 readings within 28 days, requiring at least 2
3. EMA of the body-fat readings
4. Require two consecutive weekly readings past the threshold

**Recommended default:** Mean of the last 3 readings within 28 days, requiring at least 2, used for both switch prompts and lean mass. It only raises a prompt and never switches phase automatically. One BodyEntry per date; weight is optional when only scale fields are entered.

### 36. `phase-length-and-switch-prompts` (Phase plan / check-in)
*blocks implementation*

**Issue:** The cut is planned at 10–14 weeks but capped at 16, so it's unclear whether the prompt comes at 14 or 16. It's unclear whether 20 weeks is a bulk minimum that suppresses an early body-fat-ceiling prompt. Maintenance (2–4 weeks) has no setting and no exit trigger. The phase after maintenance depends on the phase before it, which Phase doesn't record. Also unstated: whether ending a phase creates the next one with recalculated targets, and whether only one phase can be active.

**Spec quote:** C[Cut<br/>10–14 weeks]"; "|BF target, 16 weeks,<br/>or strength sliding|"; "M1[Maintenance<br/>2–4 weeks]

**Options:**
1. Prompt only at the maximum: 26 weeks for bulk, 16 for cut, 4 for maintenance
2. A soft reminder at the planned length (bulk 20, cut 14) plus a firm prompt at the maximum
3. The user sets a planned length for each phase
4. Pre-select the next phase from the flowchart vs let the user choose freely

**Recommended default:** A soft note at the planned length and a firm prompt at the maximum. Body-fat and strength triggers are active at any point in the phase. The next phase is pre-selected from the flowchart (inferred from the last non-maintenance phase) and editable. Add a maintenance-length setting (default 4 weeks). Only one phase is active at a time, and diet-break weeks don't count toward the cut cap.

### 37. `diet-breaks` (Phase plan / Data model)
*blocks implementation, needs user input*

**Issue:** Optional diet breaks aren't in the v1 feature list or the data model. If a break were modelled as a new maintenance phase, it would restart the cut: the first-week rule, the 16-week count and the rate band would all reset, and the flowchart would route the next phase to a bulk. Unstated: whether breaks are in v1 at all, whether the app prompts for them or the user starts them, whether the cadence is every 3 or 4 weeks, whether they're on or off by default, and what protein and TDEE-window handling apply during a break.

**Spec quote:** a week at maintenance every 3–4 weeks of cutting

**Options:**
1. Out of scope for v1; the user can create a maintenance phase by hand
2. A DietBreak record inside a cut: targets go to maintenance, check-ins and the cut-length clock pause, and the week after is treated like a first week
3. A maintenance Phase with a parentPhaseId, after which the same cut resumes

**Recommended default:** A DietBreak record inside a cut, started by the user and off by default. Break kcal = the current TDEE estimate, with protein kept at the cut level. Break weeks don't count toward the cap, and there are no band adjustments during the break or the week after. Ask the user whether diet breaks belong in v1.

### 38. `seed-personal-data` (Privacy / seed data)
*blocks implementation, needs user input*

**Issue:** Seeding the profile and first BodyEntry from the doc means committing age, weight, body fat, visceral rating and other readings as code or fixtures in the new GitHub repo. If the repo is public, that publishes personal health data. The same applies to committing this spec file, a local database or exported CSVs.

**Spec quote:** the profile plus first BodyEntry from Profile and baseline

**Options:**
1. A first-run onboarding form collects the profile and first body entry; only the non-personal program seed is committed
2. Personal seed values go in a gitignored local file, with a committed template
3. Commit as-is if the repo stays private

**Recommended default:** First-run onboarding for personal data. Commit only the program and exercise seed, and gitignore data and export files. Ask the user whether the repo is public and whether this spec should be committed.

### 39. `per-muscle-band` (Volume dashboard)
*needs user input*

**Issue:** Under the global flag rule, six muscles flag 'low' on day one: hamstrings, side delts, front delts, rear delts, calves and abs. That includes front delts, which the doc calls 'Enough', and calves and abs, which it calls 'Low by choice'. Neither settings nor the data model has a per-muscle band or exemption.

**Spec quote:** under 10 fractional sets a week is "low""; "| Front delts | 3 | 8.5 | Enough; pressing covers them |"; "| Calves | 6 | 6 | Low by choice; raise if a priority |

**Options:**
1. Keep the global band and accept six 'low' flags
2. Per-muscle min/max overrides that inherit the global 10–20
3. A per-muscle 'don't flag' toggle plus a 'just under' status

**Recommended default:** Per-muscle overrides inheriting 10–20. Seed front delts, calves and abs as exempt, and keep hamstrings, side delts and rear delts flagged, since the doc says to add sets if they lag. Confirm with the user.

### 40. `evidence-tag-editability` (Settings / acceptance)

**Issue:** The volume flags are tagged Heuristic in Volume accounting but Evidence in Default settings, so the acceptance criterion gives opposite answers on whether they must be editable. It's never stated whether Evidence-tagged settings are read-only, yet phase setup lets the user choose a rate band, which is tagged Evidence.

**Spec quote:** [Heuristic, set from the evidence ranges]" vs "| Weekly volume band | 10–20 fractional sets per muscle | Evidence |" and "| Session cap | 11 fractional sets per muscle | Evidence (preprint) |

**Options:**
1. Every default editable; the tag is shown as a badge only
2. Only Heuristic settings editable; fix the tags to match the body text
3. Evidence settings editable behind an advanced toggle

**Recommended default:** Make every default editable, show the Evidence/Heuristic tag as a badge, and warn when an Evidence setting is set outside its evidence range.

### 41. `seed-loads-to-adjust` (Seed data)

**Issue:** The Start load column repeats the old sheet weights for the six exercises whose rep ranges changed. The notes say these should start lighter or heavier but give no amount. The deadlift's 315 × 8 already sits at the top of its new 5–8 range. Seeding the table as-is contradicts the note.

**Spec quote:** start lighter on machine fly, lateral raise, rear delt fly and face pull (higher reps now). Start heavier on dip machine and deadlift (lower reps now).

**Options:**
1. Seed the listed loads and flag these six for week-1 recalibration, using the 'Set in week 1' calibration rule
2. Seed these six as blank ('Set in week 1')
3. Apply a fixed adjustment (e.g. −10% for the lighter four, +1 step for dip and deadlift)
4. Ask the user for new starting loads now

**Recommended default:** Seed the listed loads with a recalibration badge and treat the first session as calibration. Ask the user in passing whether they already know the new loads.

### 42. `seed-initial-phase` (Seed data / phase setup)

**Issue:** The seed list includes no Phase, yet the acceptance test expects starting targets. The seeded BodyEntry has no date, and it doubles as the EMA's starting point.

**Spec quote:** Seed data: program days and exercises from Training program, muscle weights from Volume accounting, and the profile plus first BodyEntry from Profile and baseline."; "Start with a lean bulk at about 3,000 kcal/day

**Options:**
1. Seed an active lean bulk starting on first launch
2. First-run onboarding with a lean bulk preselected and targets computed
3. No phase until the user creates one

**Recommended default:** Onboarding with a lean bulk preselected and today as the start date. The seed BodyEntry is dated on first launch and replaced by the first real weigh-in that day.

### 43. `rounding-and-tolerance` (Nutrition targets / acceptance criteria)

**Issue:** Recomputed from the seed profile: maintenance is about 2,713, not the printed 2,715, and 1,750 × 1.55 itself isn't 2,715. Bulk protein at 2.0 g/kg is about 148 g, not 150. The table's carbs are rounded inconsistently. Katch-McArdle, Mifflin-St Jeor, fat and cut protein all reproduce. There's no rule for rounding stored vs displayed targets, and no tolerance for what 'about' allows in the acceptance test.

**Spec quote:** 1,750 × 1.55 ≈ 2,715 kcal"; "about 2,700 kcal maintenance, 3,000 kcal bulk, 150 g protein

**Options:**
1. Store exact values and round only for display
2. Round kcal and protein when the phase is saved, then derive fat and carbs from the rounded values
3. An explicit test tolerance (±50 kcal, ±5 g)

**Recommended default:** Round at save: kcal to the nearest 50 and protein to the nearest 5 g, with fat and carbs derived from those. Acceptance tolerance ±50 kcal and ±5 g.

### 44. `per-hand-and-unilateral` (Data model / Logging / Volume)

**Issue:** For dumbbells, the doc doesn't say whether loadLb is per hand or the total of both, or whether e1RM is per hand. For one-sided work (single-arm extension, Bulgarian split squat), it doesn't say whether a set covers both sides, how unequal left/right reps are logged, or whether volume counts each set once or twice. The acceptance triceps total only reproduces if each set counts once.

**Spec quote:** | 1 | Incline DB bench press | 3 × 6–10 | 1–2 | 2–3 min | 70 per hand | 5 |"; "Single-arm overhead cable triceps extension

**Options:**
1. loadLb is the per-hand or per-limb load as written, e1RM per hand, labelled 'per hand' in the UI and CSV; a one-sided set covers both sides, counts once and logs the weaker side's reps
2. loadLb is the total of both dumbbells
3. A separate SetLog for each side, with a side field

**Recommended default:** The first option.

### 45. `loadtype-seed` (Seed data)

**Issue:** The program tables never give loadType, and several names are ambiguous: Smith machine squat (barbell or machine, and does 220 include the bar?), 'Incline DB biceps curl (machine)', 'Machine barbell row', and hip thrust. The doc never says what behavior depends on loadType.

**Spec quote:** loadType (barbell, dumbbell, machine, cable, bodyweight-plus)"; "| 5 | Incline DB biceps curl (machine) | 3 × 10–15 | 0–1 | 90 s | 40 | 2.5 |

**Options:**
1. loadType only affects labels ('per hand') and the bodyweight-plus e1RM math; seed a best-guess mapping the user can fix in the editor
2. Ask the user to confirm the ambiguous exercises at setup
3. Replace loadType with isPerHand and isBodyweightPlus flags

**Recommended default:** The first option. Seed dumbbell for incline DB bench and DB hammer curl, bodyweight-plus for the chin-up, barbell for the deadlift, cable for the cable and pulldown moves, and machine for the rest. Loads are recorded as the user reads them.

### 46. `rep-and-rir-prefill` (Workout logger / Progression engine)

**Issue:** Only the load pre-fill is defined. The doc doesn't say what '+1 rep' applies to (each set, total reps, or the first set short of the top), whether reps or RIR are pre-filled, or what the rep target is after a step, after a drop, or on the 'Same load' branch after a single miss.

**Spec quote:** E[Same load,<br/>aim for +1 rep]"; "exercises arrive pre-filled with suggested loads

**Options:**
1. Per set: target = min(last reps for that setIndex + 1, repMax); repMin after a step or drop; last reps on the single-miss branch; RIR left blank
2. Show 'beat last session's total reps by 1'
3. No rep pre-fill; show last session's reps for reference

**Recommended default:** The first option.

### 47. `stall-remedy-and-suggestions` (Progression engine / UX)

**Issue:** Stall, deload, volume and phase-switch suggestions have no storage and no accept or dismiss mechanics. 'One fewer set for 2 weeks' and a deload week both imply temporary program changes that revert automatically, which the data model can't store. A 'close variation' needs a list of substitutes. When the exercise is on two days, it isn't clear which day's item loses the set.

**Spec quote:** Suggest checking sleep and calories, then a close variation or one fewer set for 2 weeks.

**Options:**
1. Advisory text only; the user edits the program by hand
2. One-click apply as a permanent program edit
3. A temporary override entity (itemId, setsDelta, loadFactor, start, end) that reverts automatically
4. In any case, a Suggestion log (type, date, exerciseId, status)

**Recommended default:** In v1 a stall shows a flag and advisory text with a shortcut into the editor. A deload is applied as temporary pre-fills (see deload-execution). Every suggestion is recorded in a Suggestion log with shown/accepted/dismissed status.

### 48. `cut-steps-alternative` (Weekly check-in)

**Issue:** CheckIn can't record choosing more steps instead of fewer calories. Steps are optional, so there may be no baseline, and there's no step-target field. It's unclear whether choosing steps resets the two-week streak.

**Spec quote:** | Cut | Slower than −0.5% bodyweight/week | −100–150 kcal, or ~2,000 more steps a day |

**Options:**
1. A text-only hint with no tracking
2. A selectable alternative recorded on the CheckIn (action type kcal or steps), with a steps target = 14-day average + 2,000 when steps were logged on at least 80% of days
3. Drop it from v1

**Recommended default:** A selectable alternative on cuts only. Choosing it resets the streak just like an accepted kcal change. The steps target is shown only when a baseline exists.

### 49. `phase-volume-adjustments` (Training adjustments by phase)

**Issue:** The phase volume rules have no feature, 'lagging' is undefined, and 'recovery suffers' has no input. The doc doesn't say whether the app prompts, edits the program automatically, or leaves this to the program editor.

**Spec quote:** Add 1 set to a lagging muscle every 3–4 weeks, up to ~20 fractional sets"; "Keep volume; if recovery suffers, drop up to a third of sets

**Options:**
1. Out of scope for v1; guidance text only, with manual edits
2. The user marks lagging muscles; during a bulk, the check-in suggests +1 set every 4 weeks while planned volume is below 20
3. Detect lagging muscles automatically from e1RM trends
4. Apply changes to the program automatically

**Recommended default:** The user marks lagging muscles and gets check-in prompts to accept or skip. Volume cuts during a cut stay manual.

### 50. `finishers-adhoc-and-muscle-list` (Training program / Workout logger / Muscles)

**Issue:** The optional finishers have no sets, rep range, load, step, rest, program day or muscle weights. Traps aren't in any muscle list, and the Y-W combo isn't mapped to a muscle. A 'ladder' doesn't fit double progression. The logger spec doesn't say whether exercises not on the day can be added to a session. There's no canonical muscle list (the Weekly totals table implies 12), and it isn't said whether the editor can add muscles.

**Spec quote:** barbell shrug ladder, hyper Y-W combo"; "muscleWeights {muscle: 1.0 or 0.5}

**Options:**
1. Leave the finishers out of the seed; the user adds them in the editor
2. Seed them as library exercises not attached to any day, add them ad hoc in the logger, count their volume through muscle weights (e.g. a new Traps muscle; Y-W as rear delts 1.0 and back 0.5), and exclude them from progression
3. Add an optional flag on items and attach them to days, excluded from planned volume

**Recommended default:** The second option. The muscle list is the 12 from the Weekly totals table plus traps, and the user can add more.

### 51. `units-display` (Units)

**Issue:** Values entered in kg have to be converted to lb for storage, and the spec doesn't set the precision; a whole-kg entry must display back unchanged. Loads built from lb steps show as awkward kg numbers. The doc doesn't say whether height switches to cm, whether rates are shown in kg per week, whether steps can be edited in kg, or which units the CSV uses.

**Spec quote:** Switching between lb and kg changes displayed values only, never stored data.

**Options:**
1. Store lb at full precision (0.45359237 kg per lb); display bodyweight to 0.1 kg and loads to 0.5 kg
2. Store lb rounded to 0.1
3. Step sizes editable in display units, stored as lb equivalents
4. Round kg suggestions to available plates

**Recommended default:** Full-precision lb storage with rounded display. In kg mode, show height in cm and rates in kg per week. CSV always uses lb, with unit-suffixed headers.

### 52. `csv-export-shape` (Export)

**Issue:** Unspecified: one file per entity or a single zip; the columns (session id, program day, exercise name, set index, note, per-hand or load type, warm-up flag, session bodyweight); units; date format; whether derived values are included; whether phases, check-ins, the program and settings are exported; and whether voided records are included.

**Spec quote:** CSV files for sets, body entries and nutrition entries"; "CSV export includes every set with date, exercise, load, reps and RIR.

**Options:**
1. Three flattened CSVs (sets, body, nutrition) with ISO 8601 dates, UTF-8 and a header row
2. A CSV for every entity
3. The three CSVs plus a full JSON backup with import

**Recommended default:** Three flattened CSVs with ISO dates, lb units and voided rows excluded. Backup and restore is decided under platform-storage-backup.

### 53. `nutrition-entry-kcal-vs-macros` (Nutrition logging)

**Issue:** Kcal and macros entered separately rarely match the 4/4/9 conversion. The spec doesn't say which one feeds the TDEE, whether macros are required for a day to count toward the 80% threshold, or whether kcal is computed from macros.

**Spec quote:** | NutritionEntry | date, kcal, proteinG, carbsG, fatG, steps? |

**Options:**
1. Kcal is authoritative; macros are optional
2. Kcal is derived from macros
3. Both required, with a warning if they differ by more than 10%

**Recommended default:** Kcal is authoritative for the TDEE, and a day counts as logged if kcal is present. Macros are optional, with a mismatch hint above 10%.

### 54. `age-and-profile` (Data model: UserProfile)

**Issue:** Mifflin-St Jeor uses age, and targets are recalculated at every phase start across a cycle of roughly 34–50 weeks, so a stored age goes stale. Only the male Mifflin constant is given, even though UserProfile has a sex field.

**Spec quote:** | UserProfile | name, sex, age, heightIn, units (lb or kg), activityFactor |

**Options:**
1. Store birthDate and derive age
2. Keep age and prompt for an update at each phase start
3. Keep a static age

**Recommended default:** Store birthDate (confirm it during onboarding) and include both sex constants in the Mifflin formula.

### 55. `guidance-without-features` (Feature coverage)

**Issue:** 'Applies every rule in this doc' can't be met literally, because several rules have no matching feature. Protein per meal can't be tracked from daily totals. Partial reps have no field, and reps is a single integer, so it's unclear whether partials count toward top-of-range and e1RM. The lean mass, FFMI and BMI figures from Profile aren't shown anywhere. Weigh-in and logging tips and reminders have no feature either.

**Spec quote:** spread protein over 4 or more meals of about 30–40 g each"; "A few partial reps in the stretched position after the last full rep are optional.

**Options:**
1. Keep these as guidance text on help screens
2. Minimal support: a partialReps field, a body-composition card and a per-meal protein tip
3. Defer meal logging and reminders to v2

**Recommended default:** Help text, plus a derived body-composition card and a static per-meal protein tip (target ÷ 4). Partial reps are excluded from reps and can go in the set note. No meal logging or reminders in v1.

## Spec audit: rejected findings

- `rir-role-in-progression`: The doc answers this. The acceptance criterion says suggested loads follow the flowchart exactly, and the flowchart compares only reps with the rep range, so RIR is informational. An out-of-range RIR badge would be a UI nicety, not something a developer has to guess. The same RIR sub-point in prefill-and-set-count-edge-cases is rejected for the same reason.
- `tdee-vs-rate-adjustment-interaction`: The doc answers this with 'change calories only when the trend misses its band two weeks running' and 'Recalculate each phase's targets from current trend weight and measured maintenance when the phase starts'. Mid-phase targets move only through the band rules; measured TDEE is shown at check-in and used when the next phase starts. The remaining ambiguity about the ±150 cap is kept in tdee-cap-scope.
- `tdee-cap-and-target-link`: Split up. The question of whether the target follows TDEE is answered (see tdee-vs-rate-adjustment-interaction). The cap-scope part moved to tdee-cap-scope, and the logged-day and window parts moved to tdee-window-and-logging.
- `program-day-scheduling`: The doc answers this: 'pick today's program day' means the user chooses the day. Pre-selecting a default is a UI convenience. The weekly effects of sessions sliding to other days are covered in training-week-boundary, and ad hoc sessions without a program day are covered in session-lifecycle.
- `bulk-surplus-pct-contradiction`: Not a contradiction on its own: the table's +10–15% is a sub-range inside the +10–20% evidence range, and +300 fits both. No feature checks the surplus %. The real gap, how the starting kcal target is derived, is kept in kcal-target-derivation.
- `muscle-list-and-table-sums`: The sums don't match (the revised column omits front delts and sums to 91; the current column doesn't sum to 84), but only in the informational 'Current vs. revised' table, which the applet never uses. The acceptance test uses the Weekly totals table, which reproduces exactly from the seed program (all 12 muscles, 94 sets). The canonical-muscle-list part was merged into finishers-adhoc-and-muscle-list.
- `range-valued-defaults`: Duplicate. The window part is kept in tdee-window-and-logging and the step part in adjustment-step-size; the rest, step and miss ranges are covered in rest-timer, either-or-variants and drop-amount-and-rounding.
