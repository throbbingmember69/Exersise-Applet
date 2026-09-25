// Shared contract for every layer: persisted entity shapes (Dexie rows) and the engine types that
// cross module boundaries. FROZEN during parallel work; change it only on main.
// Module-private types (e.g. trend points) live in their own module.
//
// Conventions: masses in lb at full precision; calendar dates are LocalDate strings; instants are
// epoch milliseconds; `null` (never `undefined`) for "no value" in persisted rows.

import type { Settings, SettingKey } from './settings/registry'

export type { Settings, SettingKey }

// ── Primitives ──────────────────────────────────────────────────────────────

/** Local calendar date `YYYY-MM-DD`. Create with `parseLocalDate` / `localDateOf`. */
export type LocalDate = string & { readonly __brand: 'LocalDate' }
export type EpochMs = number
/** 0 = Sunday … 6 = Saturday (Date#getDay convention). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type Sex = 'male' | 'female'
export type UnitSystem = 'lb' | 'kg'
export type LoadType = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight_plus'

/** Muscle ids are slugs ('quads', 'side_delts', …). Users can add muscles, so this stays open. */
export type MuscleId = string
/** 1.0 = the muscle the exercise mainly trains; 0.5 = an assisting muscle. */
export type MuscleWeight = 0.5 | 1
export type MuscleWeights = Readonly<Record<MuscleId, MuscleWeight>>

/** The prescription a program slot carries: "3 × 8–12 @ RIR 1–2, rest 2:00". */
export interface Regime {
  sets: number
  repMin: number
  repMax: number
  rirMin: number
  rirMax: number
  restMinSec: number
  restMaxSec: number
}

/** The gym scope of a track or series: a gym id, or '*' when shared across gyms. */
export type GymScope = string
export const SHARED_GYM_SCOPE: GymScope = '*'

// ── Profile, settings, app state ────────────────────────────────────────────

export interface UserProfile {
  id: 'me'
  name: string
  sex: Sex
  /** Age on `ageAsOf`; `ageOn()` advances it. `birthDate` wins when set. */
  ageYears: number
  ageAsOf: LocalDate
  birthDate: LocalDate | null
  heightIn: number
  /** Display unit only; stored data is always lb. */
  units: UnitSystem
  updatedAt: EpochMs
}

export interface SettingsRow {
  id: 'singleton'
  /** Overrides merged over registry defaults by `resolveSettings`. */
  values: Partial<Record<SettingKey, number>>
  updatedAt: EpochMs
}

export interface AppStateRow {
  key: string
  value: unknown
}

// ── Training library and program ────────────────────────────────────────────

export interface Muscle {
  id: MuscleId
  name: string
  sortOrder: number
  /** null = use the global weeklyVolumeMin / weeklyVolumeMax settings. */
  bandMin: number | null
  bandMax: number | null
  /** Never flag this muscle as "low" (front delts, calves, abs by default). */
  exemptLow: boolean
  /** User marks a muscle as lagging to get add-a-set prompts on a bulk. */
  lagging: boolean
  archivedAt: EpochMs | null
}

export interface Gym {
  id: string
  name: string
  sortOrder: number
  archivedAt: EpochMs | null
  createdAt: EpochMs
}

export interface Exercise {
  id: string
  name: string
  loadType: LoadType
  /**
   * true → progression tracks and strength series are separate per gym (machine stacks differ).
   * Defaults to loadType machine/cable; user-overridable.
   */
  equipmentSpecific: boolean
  /** One side at a time; a set covers both sides and logs the weaker side's reps. */
  unilateral: boolean
  /** Load is per hand (dumbbells); shown as "per hand". */
  perHand: boolean
  /** Load added once every set reaches the top of the range. Per-gym override in GymExerciseSetting. */
  stepLb: number
  /** Regime used when the exercise is added ad hoc or to a new slot. Slots carry their own. */
  defaultRegime: Regime
  muscleWeights: MuscleWeights
  isMainLift: boolean
  /** Finishers are logged and count toward volume but never get progression. */
  isFinisher: boolean
  notes: string
  archivedAt: EpochMs | null
  createdAt: EpochMs
  updatedAt: EpochMs
}

/** Per-gym equipment differences, e.g. that gym's machine stack jump. */
export interface GymExerciseSetting {
  id: string
  gymId: string
  exerciseId: string
  stepLb: number | null
}

export interface ProgramDay {
  id: string
  name: string
  /** Scheduled weekday, or null for unscheduled. */
  weekday: Weekday | null
  order: number
  note: string
  archivedAt: EpochMs | null
}

/** One line of a program day. The slot owns the regime; any library exercise can fill it. */
export interface ProgramSlot extends Regime {
  id: string
  programDayId: string
  order: number
  label: string
  defaultExerciseId: string
  /** Suggested swaps (e.g. "Deadlift or Romanian deadlift"). Any library exercise is allowed. */
  alternateExerciseIds: string[]
  note: string
  archivedAt: EpochMs | null
}

/** A gym's permanent exercise choice for a slot. */
export interface GymSlotOverride {
  id: string
  gymId: string
  slotId: string
  exerciseId: string
}

/** Where a progression track starts before it has history. Never a fake session. */
export interface TrackStartRow {
  /** `trackKey(programDayId, exerciseId, gymScope)`. */
  trackKey: string
  programDayId: string
  exerciseId: string
  gymScope: GymScope
  /** null = no known load ("Set in week 1"). */
  startLoadLb: number | null
  /** true → the first session is calibration: not evaluated; its last working load becomes the base. */
  calibrate: boolean
  updatedAt: EpochMs
}

// ── Sessions and sets ────────────────────────────────────────────────────────

export type SessionStatus = 'in_progress' | 'finished' | 'abandoned'
export type BodyweightSource = 'weighin' | 'trend' | 'seed' | 'manual'

export interface Session {
  id: string
  /** Local date the session started. */
  date: LocalDate
  startedAt: EpochMs
  finishedAt: EpochMs | null
  tzOffsetMin: number
  status: SessionStatus
  /** null = ad hoc session (no progression evaluation). */
  programDayId: string | null
  gymId: string
  isDeload: boolean
  jointPain: boolean
  /** Used for bodyweight-plus e1RM (chin-ups). */
  bodyweightLb: number | null
  bodyweightSource: BodyweightSource
  note: string
  /** Soft delete: excluded from every calculation, restorable. */
  voidedAt: EpochMs | null
  editedAt: EpochMs | null
  createdAt: EpochMs
}

export type SwapKind = 'none' | 'one_off' | 'gym_override'

/** The prescription a session actually used, snapshotted at session start. Never edited. */
export interface SessionPrescription extends Regime {
  /** Sets before a deload cut (equals `sets` outside deloads). */
  setsBeforeDeload: number
  stepLb: number
}

export interface SessionSuggestion {
  /** Suggested load, or null when the lifter must pick one (calibration without a start load). */
  loadLb: number | null
  /** Per-set rep targets, length = prescription.sets. */
  repTargets: number[]
  branch: Branch
  missStreakBefore: number
  isCalibration: boolean
  notices: Notice[]
}

export interface SessionExercise {
  id: string
  sessionId: string
  order: number
  /** null for exercises added ad hoc. */
  slotId: string | null
  adHoc: boolean
  exerciseId: string
  exerciseName: string
  loadType: LoadType
  perHand: boolean
  unilateral: boolean
  equipmentSpecific: boolean
  gymScope: GymScope
  isMainLift: boolean
  isFinisher: boolean
  swappedFromExerciseId: string | null
  swapKind: SwapKind
  prescription: SessionPrescription
  muscleWeights: MuscleWeights
  suggestion: SessionSuggestion
  createdAt: EpochMs
}

export interface SetLog {
  id: string
  sessionId: string
  sessionExerciseId: string
  /** Denormalized from the session exercise for querying. */
  exerciseId: string
  setIndex: number
  /** Per hand/limb as written. For bodyweight_plus: the ADDED load (may be 0 or negative for assisted). */
  loadLb: number
  /** For unilateral work: the weaker side's reps. */
  reps: number
  /** Reps in reserve, 0–5, or null if not recorded. */
  rir: number | null
  isWarmup: boolean
  note: string
  loggedAt: EpochMs
  editedAt: EpochMs | null
  voidedAt: EpochMs | null
}

// ── Body and nutrition ───────────────────────────────────────────────────────

export interface BodyEntry {
  /** One entry per date (primary key). */
  date: LocalDate
  weightLb: number | null
  bodyFatPct: number | null
  muscleMassLb: number | null
  skeletalMusclePct: number | null
  subcutFatPct: number | null
  visceralRating: number | null
  /** 'seed' entries come from the spec baseline and are excluded from the trend. */
  source: 'seed' | 'user'
  note: string
  createdAt: EpochMs
  updatedAt: EpochMs
  voidedAt: EpochMs | null
}

export interface NutritionEntry {
  /** One entry per date (primary key). A day counts as logged when kcal is present. */
  date: LocalDate
  kcal: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  steps: number | null
  updatedAt: EpochMs
}

// ── Phases, targets, check-ins ───────────────────────────────────────────────

export type PhaseType = 'bulk' | 'maintenance' | 'cut'
export type PhaseStatus = 'active' | 'ended'
export type MaintenanceSource = 'formula' | 'measured' | 'manual'
export type BodyFatQuality = 'smoothed' | 'single' | 'none'
export type ProteinBasis = 'bodyweight' | 'leanMass' | 'bodyweight_fallback'

export interface Phase {
  id: string
  type: PhaseType
  startDate: LocalDate
  endDate: LocalDate | null
  status: PhaseStatus
  prevPhaseId: string | null
  /** Reserved for diet breaks (a break is a child of a cut). Always null in v1. */
  parentPhaseId: string | null
  /** Band in %BW/week with rateMinPct < rateMaxPct numerically (cut: -0.75, -0.5). */
  rateMinPct: number
  rateMaxPct: number
  targetRatePct: number
  /** Unrounded maintenance used to set the starting target. */
  maintenanceKcalAtStart: number
  maintenanceSource: MaintenanceSource
  trendWeightLbAtStart: number
  bodyFatPctAtStart: number | null
  bfQuality: BodyFatQuality
  leanMassLbAtStart: number | null
  proteinBasis: ProteinBasis
  proteinGPerKg: number
  fatPct: number
  bfCeilingPct: number | null
  bfTargetPct: number | null
  plannedWeeks: number
  maxWeeks: number
  endReason: string | null
  createdAt: EpochMs
}

export type TargetSource = 'phase_start' | 'checkin' | 'manual'

/** Append-only history of daily targets. The active target is the latest effective on a date. */
export interface TargetRevision {
  id: string
  phaseId: string
  effectiveDate: LocalDate
  kcal: number
  proteinG: number
  fatPct: number
  source: TargetSource
  checkInId: string | null
  note: string
  createdAt: EpochMs
}

export type CheckInStatus = 'pending' | 'accepted' | 'accepted_steps' | 'skipped' | 'backfilled'
export type TdeeSource = 'formula' | 'measured' | 'insufficient_data'
export type MissDirection = 'low' | 'high'
export type CheckInSuggestionType =
  | 'none_first_week'
  | 'none_insufficient'
  | 'none_in_band'
  | 'none_streak'
  | 'kcal_change'

export type SwitchPromptKind = 'end_bulk' | 'end_cut' | 'end_maintenance'
export type SwitchReason =
  | 'planned_length'
  | 'max_length'
  | 'bf_ceiling'
  | 'bf_target'
  | 'strength_slide'
  | 'maintenance_length'

export interface SwitchPrompt {
  kind: SwitchPromptKind
  severity: 'soft' | 'firm'
  reasons: SwitchReason[]
  suggestedNext: PhaseType
}

export type SwitchResponse = 'plan_next' | 'dismissed'

export interface CheckIn {
  id: string
  phaseId: string
  dueDate: LocalDate
  /** 1-based week of the phase that just ended on dueDate. */
  phaseWeekIndex: number
  status: CheckInStatus
  evaluatedAt: EpochMs
  trendWeightLb: number | null
  trendRatePct: number | null
  bandMinPct: number
  bandMaxPct: number
  intakeLoggedPct: number
  weighInLoggedPct: number
  tdeeEstimate: number | null
  tdeeSource: TdeeSource
  tdeeCapped: boolean
  missDirection: MissDirection | null
  missStreak: number
  suggestionType: CheckInSuggestionType
  /** Signed kcal/day change (0 when no change is suggested). */
  suggestedKcalChange: number
  /** Extra daily steps offered instead (cut losing too slowly), else null. */
  stepsAlternative: number | null
  appliedKcalChange: number | null
  switchPrompt: SwitchPrompt | null
  switchResponse: SwitchResponse | null
  respondedAt: EpochMs | null
}

export type SuggestionKind = 'stall' | 'deload' | 'deload_end' | 'volume_ramp' | 'strength_slide'
export type SuggestionStatus = 'shown' | 'accepted' | 'dismissed'

/** Log of advisory suggestions and the user's response. */
export interface Suggestion {
  id: string
  kind: SuggestionKind
  /** Deterministic fingerprint so the same situation isn't re-suggested. */
  key: string
  status: SuggestionStatus
  payload: Readonly<Record<string, unknown>>
  firstShownAt: EpochMs
  respondedAt: EpochMs | null
}

// ── Progression engine ───────────────────────────────────────────────────────

/**
 * Outcome of the flowchart for one session, which also names how the next load was chosen.
 * - start: no history; the next load is the track's start load
 * - calibration: this session was calibration (not evaluated)
 * - calibrated: next load = the calibration session's last working load
 * - step: every set at the top of the range → add one step
 * - same_plus_rep: no set below the range → same load, aim for +1 rep
 * - same_after_miss: a set below the range, first time → same load
 * - drop: below the range for `missesBeforeDrop` sessions in a row → drop load
 */
export type Branch =
  | 'start'
  | 'calibration'
  | 'calibrated'
  | 'step'
  | 'same_plus_rep'
  | 'same_after_miss'
  | 'drop'

export type NoticeCode =
  | 'mixed_loads'
  | 'calibration_needed'
  | 'recalibrate'
  | 'deload'
  | 'missing_sets'
  | 'no_bodyweight'

export interface Notice {
  code: NoticeCode
  /** Optional structured detail (e.g. { loads: [200, 210] }). */
  detail?: Readonly<Record<string, unknown>>
}

/** A working (non-warm-up, non-voided) set as the engine sees it. */
export interface WorkingSet {
  setIndex: number
  loadLb: number
  reps: number
}

/** One finished session of a single progression track, as input to replay. */
export interface TrackSession {
  sessionId: string
  date: LocalDate
  startedAt: EpochMs
  isDeload: boolean
  /** From the snapshot suggestion: this session was the track's calibration session. */
  isCalibration: boolean
  prescribed: { sets: number; repMin: number; repMax: number }
  /** Working sets only, any order; the engine sorts by setIndex. */
  sets: WorkingSet[]
}

export interface TrackStart {
  startLoadLb: number | null
  calibrate: boolean
}

/** Folded state of a track after replaying its history. */
export interface TrackState {
  /** Load the next suggestion is based on (null until known). */
  lastBaseLb: number | null
  /** Branch chosen by the most recent evaluated/calibration session ('start' if none). */
  lastBranch: Branch
  /** Consecutive evaluated sessions with a set below the range. */
  missStreak: number
  /** Reps per setIndex from the last evaluated session (null = not logged). */
  lastReps: (number | null)[]
  calibrated: boolean
  evaluatedCount: number
}

export interface SessionResult {
  sessionId: string
  /** 'calibration' when the session was calibration; otherwise the flowchart branch. */
  branch: Branch
  evaluated: boolean
  baseLb: number | null
  allTop: boolean
  anyBelow: boolean
  missStreakAfter: number
  notices: Notice[]
}

export interface NextPrescription {
  loadLb: number | null
  repTargets: number[]
  sets: number
  branch: Branch
  isCalibration: boolean
  missStreakBefore: number
  notices: Notice[]
}
