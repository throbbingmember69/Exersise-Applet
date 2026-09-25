// The JSON backup file: every table dumped as an array of rows, plus a format marker and a schema
// version. Restore validates the whole file before anything is written: the format marker first,
// then the version (a newer one is refused), then every row against its types.ts entity. Row
// schemas are checked against types.ts at compile time (RowSchemasMatchEntities), so a contract
// change that isn't mirrored here fails `npm run typecheck`.
//
// Unknown object keys are dropped rather than rejected, and so are unknown settings keys (the
// registry ignores them anyway), so a backup stays restorable after a setting is retired.
import * as z from 'zod/mini'
import { isLocalDate } from '@/domain/dates'
import { isSettingKey } from '@/domain/settings/registry'
import type {
  AppStateRow,
  BodyEntry,
  CheckIn,
  EpochMs,
  Exercise,
  Gym,
  GymExerciseSetting,
  GymSlotOverride,
  LocalDate,
  Muscle,
  NutritionEntry,
  Phase,
  ProgramDay,
  ProgramSlot,
  Session,
  SessionExercise,
  SetLog,
  SettingKey,
  SettingsRow,
  Suggestion,
  TargetRevision,
  TrackStartRow,
  UserProfile,
} from '@/domain/types'

export const BACKUP_FORMAT = 'exersise-applet-backup'
export const BACKUP_SCHEMA_VERSION = 1

/** Every persisted table. This list is the Dexie table-name contract. */
export const TABLE_NAMES = [
  'profile',
  'settings',
  'appState',
  'muscles',
  'gyms',
  'exercises',
  'gymExerciseSettings',
  'programDays',
  'programSlots',
  'gymSlotOverrides',
  'trackStarts',
  'sessions',
  'sessionExercises',
  'setLogs',
  'bodyEntries',
  'nutritionEntries',
  'phases',
  'targetRevisions',
  'checkIns',
  'suggestions',
] as const

export type TableName = (typeof TABLE_NAMES)[number]

/** The row type each table stores. */
export interface TableRows {
  profile: UserProfile
  settings: SettingsRow
  appState: AppStateRow
  muscles: Muscle
  gyms: Gym
  exercises: Exercise
  gymExerciseSettings: GymExerciseSetting
  programDays: ProgramDay
  programSlots: ProgramSlot
  gymSlotOverrides: GymSlotOverride
  trackStarts: TrackStartRow
  sessions: Session
  sessionExercises: SessionExercise
  setLogs: SetLog
  bodyEntries: BodyEntry
  nutritionEntries: NutritionEntry
  phases: Phase
  targetRevisions: TargetRevision
  checkIns: CheckIn
  suggestions: Suggestion
}

export type BackupTables = { [K in TableName]: TableRows[K][] }

export interface Backup {
  format: typeof BACKUP_FORMAT
  schemaVersion: typeof BACKUP_SCHEMA_VERSION
  appVersion: string
  exportedAt: EpochMs
  tables: BackupTables
}

export type ParseBackupResult = { ok: true; backup: Backup } | { ok: false; errors: string[] }

// ── Field schemas ────────────────────────────────────────────────────────────
// z.number() already rejects NaN and ±Infinity.

const id = z.string().check(z.minLength(1))
const text = z.string()
const bool = z.boolean()
const num = z.number()
const nonNegative = z.number().check(z.nonnegative())
const positive = z.number().check(z.positive())
const pct = z.number().check(z.gte(0), z.lte(100))
const count = z.int().check(z.nonnegative())
const epochMs = z.int().check(z.nonnegative())
const rir = z.int().check(z.gte(0), z.lte(5))
const localDate = z.custom<LocalDate>((v) => typeof v === 'string' && isLocalDate(v), {
  error: (issue) => expectation('a real YYYY-MM-DD date', issue.input),
})
const weekday = z.literal([0, 1, 2, 3, 4, 5, 6])
const muscleWeights = z.record(z.string(), z.literal([0.5, 1]))
const loadType = z.enum(['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight_plus'])
const phaseType = z.enum(['bulk', 'maintenance', 'cut'])
const branch = z.enum([
  'start',
  'calibration',
  'calibrated',
  'step',
  'same_plus_rep',
  'same_after_miss',
  'drop',
])

const regimeShape = {
  sets: count,
  repMin: count,
  repMax: count,
  rirMin: rir,
  rirMax: rir,
  restMinSec: count,
  restMaxSec: count,
}

// ── Row schemas (one per types.ts entity) ────────────────────────────────────

const profileRow = z.object({
  id: z.literal('me'),
  name: text,
  sex: z.enum(['male', 'female']),
  ageYears: count,
  ageAsOf: localDate,
  birthDate: z.nullable(localDate),
  heightIn: positive,
  units: z.enum(['lb', 'kg']),
  updatedAt: epochMs,
})

const settingsRow = z.object({
  id: z.literal('singleton'),
  values: z.pipe(z.record(z.string(), num), z.transform(knownSettings)),
  updatedAt: epochMs,
})

function knownSettings(values: Record<string, number>): Partial<Record<SettingKey, number>> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => isSettingKey(key)))
}

// JSON drops `value: undefined`, so a missing value is accepted and restored as undefined.
const appStateRow = z.pipe(
  z.object({ key: id, value: z.optional(z.unknown()) }),
  z.transform(({ key, value }): AppStateRow => ({ key, value })),
)

const muscleRow = z.object({
  id,
  name: text,
  sortOrder: num,
  bandMin: z.nullable(nonNegative),
  bandMax: z.nullable(nonNegative),
  exemptLow: bool,
  lagging: bool,
  archivedAt: z.nullable(epochMs),
})

const gymRow = z.object({
  id,
  name: text,
  sortOrder: num,
  archivedAt: z.nullable(epochMs),
  createdAt: epochMs,
})

const exerciseRow = z.object({
  id,
  name: text,
  loadType,
  equipmentSpecific: bool,
  unilateral: bool,
  perHand: bool,
  stepLb: positive,
  defaultRegime: z.object(regimeShape),
  muscleWeights,
  isMainLift: bool,
  isFinisher: bool,
  notes: text,
  archivedAt: z.nullable(epochMs),
  createdAt: epochMs,
  updatedAt: epochMs,
})

const gymExerciseSettingRow = z.object({
  id,
  gymId: id,
  exerciseId: id,
  stepLb: z.nullable(positive),
})

const programDayRow = z.object({
  id,
  name: text,
  weekday: z.nullable(weekday),
  order: num,
  note: text,
  archivedAt: z.nullable(epochMs),
})

const programSlotRow = z.object({
  ...regimeShape,
  id,
  programDayId: id,
  order: num,
  label: text,
  defaultExerciseId: id,
  alternateExerciseIds: z.array(id),
  note: text,
  archivedAt: z.nullable(epochMs),
})

const gymSlotOverrideRow = z.object({
  id,
  gymId: id,
  slotId: id,
  exerciseId: id,
})

const trackStartRow = z.object({
  trackKey: id,
  programDayId: id,
  exerciseId: id,
  gymScope: id,
  // May be zero or negative for an assisted bodyweight-plus exercise.
  startLoadLb: z.nullable(num),
  calibrate: bool,
  updatedAt: epochMs,
})

const sessionRow = z.object({
  id,
  date: localDate,
  startedAt: epochMs,
  finishedAt: z.nullable(epochMs),
  tzOffsetMin: num,
  status: z.enum(['in_progress', 'finished', 'abandoned']),
  programDayId: z.nullable(id),
  gymId: id,
  isDeload: bool,
  jointPain: bool,
  bodyweightLb: z.nullable(positive),
  bodyweightSource: z.enum(['weighin', 'trend', 'seed', 'manual']),
  note: text,
  voidedAt: z.nullable(epochMs),
  editedAt: z.nullable(epochMs),
  createdAt: epochMs,
})

const notice = z.object({
  code: z.enum([
    'mixed_loads',
    'calibration_needed',
    'recalibrate',
    'deload',
    'missing_sets',
    'no_bodyweight',
  ]),
  detail: z.optional(z.record(z.string(), z.unknown())),
})

const sessionExerciseRow = z.object({
  id,
  sessionId: id,
  order: num,
  slotId: z.nullable(id),
  adHoc: bool,
  exerciseId: id,
  exerciseName: text,
  loadType,
  perHand: bool,
  unilateral: bool,
  equipmentSpecific: bool,
  gymScope: id,
  isMainLift: bool,
  isFinisher: bool,
  swappedFromExerciseId: z.nullable(id),
  swapKind: z.enum(['none', 'one_off', 'gym_override']),
  prescription: z.object({ ...regimeShape, setsBeforeDeload: count, stepLb: positive }),
  muscleWeights,
  suggestion: z.object({
    loadLb: z.nullable(num),
    repTargets: z.array(count),
    branch,
    missStreakBefore: count,
    isCalibration: bool,
    notices: z.array(notice),
  }),
  createdAt: epochMs,
})

const setLogRow = z.object({
  id,
  sessionId: id,
  sessionExerciseId: id,
  exerciseId: id,
  setIndex: count,
  // Added load for bodyweight-plus, so zero and negative (assisted) are valid.
  loadLb: num,
  reps: count,
  rir: z.nullable(rir),
  isWarmup: bool,
  note: text,
  loggedAt: epochMs,
  editedAt: z.nullable(epochMs),
  voidedAt: z.nullable(epochMs),
})

const bodyEntryRow = z.object({
  date: localDate,
  weightLb: z.nullable(positive),
  bodyFatPct: z.nullable(pct),
  muscleMassLb: z.nullable(nonNegative),
  skeletalMusclePct: z.nullable(pct),
  subcutFatPct: z.nullable(pct),
  visceralRating: z.nullable(nonNegative),
  source: z.enum(['seed', 'user']),
  note: text,
  createdAt: epochMs,
  updatedAt: epochMs,
  voidedAt: z.nullable(epochMs),
})

const nutritionEntryRow = z.object({
  date: localDate,
  kcal: z.nullable(nonNegative),
  proteinG: z.nullable(nonNegative),
  carbsG: z.nullable(nonNegative),
  fatG: z.nullable(nonNegative),
  steps: z.nullable(count),
  updatedAt: epochMs,
})

const phaseRow = z.object({
  id,
  type: phaseType,
  startDate: localDate,
  endDate: z.nullable(localDate),
  status: z.enum(['active', 'ended']),
  prevPhaseId: z.nullable(id),
  parentPhaseId: z.nullable(id),
  rateMinPct: num,
  rateMaxPct: num,
  targetRatePct: num,
  maintenanceKcalAtStart: positive,
  maintenanceSource: z.enum(['formula', 'measured', 'manual']),
  trendWeightLbAtStart: positive,
  bodyFatPctAtStart: z.nullable(pct),
  bfQuality: z.enum(['smoothed', 'single', 'none']),
  leanMassLbAtStart: z.nullable(positive),
  proteinBasis: z.enum(['bodyweight', 'leanMass', 'bodyweight_fallback']),
  proteinGPerKg: nonNegative,
  fatPct: pct,
  bfCeilingPct: z.nullable(pct),
  bfTargetPct: z.nullable(pct),
  plannedWeeks: count,
  maxWeeks: count,
  endReason: z.nullable(text),
  createdAt: epochMs,
})

const targetRevisionRow = z.object({
  id,
  phaseId: id,
  effectiveDate: localDate,
  kcal: nonNegative,
  proteinG: nonNegative,
  fatPct: pct,
  source: z.enum(['phase_start', 'checkin', 'manual']),
  checkInId: z.nullable(id),
  note: text,
  createdAt: epochMs,
})

const checkInRow = z.object({
  id,
  phaseId: id,
  dueDate: localDate,
  phaseWeekIndex: count,
  status: z.enum(['pending', 'accepted', 'accepted_steps', 'skipped', 'backfilled']),
  evaluatedAt: epochMs,
  trendWeightLb: z.nullable(positive),
  trendRatePct: z.nullable(num),
  bandMinPct: num,
  bandMaxPct: num,
  intakeLoggedPct: pct,
  weighInLoggedPct: pct,
  tdeeEstimate: z.nullable(num),
  tdeeSource: z.enum(['formula', 'measured', 'insufficient_data']),
  tdeeCapped: bool,
  missDirection: z.nullable(z.enum(['low', 'high'])),
  missStreak: count,
  suggestionType: z.enum([
    'none_first_week',
    'none_insufficient',
    'none_in_band',
    'none_streak',
    'kcal_change',
  ]),
  suggestedKcalChange: num,
  stepsAlternative: z.nullable(count),
  appliedKcalChange: z.nullable(num),
  switchPrompt: z.nullable(
    z.object({
      kind: z.enum(['end_bulk', 'end_cut', 'end_maintenance']),
      severity: z.enum(['soft', 'firm']),
      reasons: z.array(
        z.enum([
          'planned_length',
          'max_length',
          'bf_ceiling',
          'bf_target',
          'strength_slide',
          'maintenance_length',
        ]),
      ),
      suggestedNext: phaseType,
    }),
  ),
  switchResponse: z.nullable(z.enum(['plan_next', 'dismissed'])),
  respondedAt: z.nullable(epochMs),
})

const suggestionRow = z.object({
  id,
  kind: z.enum(['stall', 'deload', 'deload_end', 'volume_ramp', 'strength_slide']),
  key: id,
  status: z.enum(['shown', 'accepted', 'dismissed']),
  payload: z.record(z.string(), z.unknown()),
  firstShownAt: epochMs,
  respondedAt: z.nullable(epochMs),
})

/** Row schema per table (e.g. for migrations that need to validate one table). */
export const rowSchemas = {
  profile: profileRow,
  settings: settingsRow,
  appState: appStateRow,
  muscles: muscleRow,
  gyms: gymRow,
  exercises: exerciseRow,
  gymExerciseSettings: gymExerciseSettingRow,
  programDays: programDayRow,
  programSlots: programSlotRow,
  gymSlotOverrides: gymSlotOverrideRow,
  trackStarts: trackStartRow,
  sessions: sessionRow,
  sessionExercises: sessionExerciseRow,
  setLogs: setLogRow,
  bodyEntries: bodyEntryRow,
  nutritionEntries: nutritionEntryRow,
  phases: phaseRow,
  targetRevisions: targetRevisionRow,
  checkIns: checkInRow,
  suggestions: suggestionRow,
} as const

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type AssertAllTrue<T extends Record<string, true>> = T

/**
 * Makes every nested property required, so mutual assignability also notices an optional field
 * that exists on one side only (plain assignability ignores a missing optional property).
 */
type DeepRequired<T> = T extends readonly (infer U)[]
  ? DeepRequired<U>[]
  : T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends object
      ? { [K in keyof T]-?: DeepRequired<T[K]> }
      : T

type SameShape<A, B> =
  MutuallyAssignable<A, B> extends true
    ? MutuallyAssignable<DeepRequired<A>, DeepRequired<B>>
    : false

/**
 * Compile-time guard, never used at runtime: fails typecheck when a row schema and its types.ts
 * entity drift apart in either direction (a field, optional field, enum member or nullability
 * added or removed, at any depth), or when TABLE_NAMES, TableRows and rowSchemas list different
 * tables.
 */
export type RowSchemasMatchEntities = AssertAllTrue<
  { [K in TableName]: SameShape<z.output<(typeof rowSchemas)[K]>, TableRows[K]> } & {
    tableNames: MutuallyAssignable<TableName, keyof TableRows>
    rowSchemaNames: MutuallyAssignable<TableName, keyof typeof rowSchemas>
  }
>

/** Primary key of each table (a duplicate would abort the restore). */
export const PRIMARY_KEYS = {
  profile: 'id',
  settings: 'id',
  appState: 'key',
  muscles: 'id',
  gyms: 'id',
  exercises: 'id',
  gymExerciseSettings: 'id',
  programDays: 'id',
  programSlots: 'id',
  gymSlotOverrides: 'id',
  trackStarts: 'trackKey',
  sessions: 'id',
  sessionExercises: 'id',
  setLogs: 'id',
  bodyEntries: 'date',
  nutritionEntries: 'date',
  phases: 'id',
  targetRevisions: 'id',
  checkIns: 'id',
  suggestions: 'id',
} as const satisfies { [K in TableName]: keyof TableRows[K] & string }

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  appVersion: z.string(),
  exportedAt: epochMs,
  tables: z.object({
    profile: z.array(profileRow),
    settings: z.array(settingsRow),
    appState: z.array(appStateRow),
    muscles: z.array(muscleRow),
    gyms: z.array(gymRow),
    exercises: z.array(exerciseRow),
    gymExerciseSettings: z.array(gymExerciseSettingRow),
    programDays: z.array(programDayRow),
    programSlots: z.array(programSlotRow),
    gymSlotOverrides: z.array(gymSlotOverrideRow),
    trackStarts: z.array(trackStartRow),
    sessions: z.array(sessionRow),
    sessionExercises: z.array(sessionExerciseRow),
    setLogs: z.array(setLogRow),
    bodyEntries: z.array(bodyEntryRow),
    nutritionEntries: z.array(nutritionEntryRow),
    phases: z.array(phaseRow),
    targetRevisions: z.array(targetRevisionRow),
    checkIns: z.array(checkInRow),
    suggestions: z.array(suggestionRow),
  }),
})

/**
 * Validate an already-parsed backup file. Errors name the path and the problem, one per issue,
 * e.g. "tables.setLogs[3].reps: expected integer, got 2.5". A file that isn't a backup, or that
 * comes from a newer schema version, gets a single explanatory error.
 */
export function parseBackup(json: unknown): ParseBackupResult {
  const headerError = checkHeader(json)
  if (headerError) return { ok: false, errors: [headerError] }
  const result = backupSchema.safeParse(json, { reportInput: true })
  // Scanned on the raw input, so duplicates are reported in the same pass as invalid rows.
  const duplicates = duplicateKeyErrors(json)
  if (!result.success || duplicates.length > 0) {
    const issues = result.success ? [] : result.error.issues.map(formatIssue)
    return { ok: false, errors: [...issues, ...duplicates] }
  }
  return { ok: true, backup: result.data }
}

function duplicateKeyErrors(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) return []
  const tables = (json as Record<string, unknown>).tables
  if (typeof tables !== 'object' || tables === null) return []
  const errors: string[] = []
  for (const name of TABLE_NAMES) {
    const rows = (tables as Record<string, unknown>)[name]
    if (!Array.isArray(rows)) continue
    const primaryKey = PRIMARY_KEYS[name]
    const firstIndex = new Map<unknown, number>()
    rows.forEach((row: unknown, i) => {
      if (typeof row !== 'object' || row === null) return
      const key = (row as Record<string, unknown>)[primaryKey]
      if (key === undefined) return
      const first = firstIndex.get(key)
      if (first === undefined) firstIndex.set(key, i)
      else {
        errors.push(
          `${formatPath(['tables', name, i, primaryKey])}: duplicate ${primaryKey} ${describeValue(key)} (also at [${first}])`,
        )
      }
    })
  }
  return errors
}

function checkHeader(json: unknown): string | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const { format, schemaVersion } = json as Record<string, unknown>
  if (format !== BACKUP_FORMAT) {
    return `format: not an Exersise Applet backup; ${expectation(describeValue(BACKUP_FORMAT), format)}`
  }
  if (typeof schemaVersion === 'number' && schemaVersion > BACKUP_SCHEMA_VERSION) {
    return (
      `schemaVersion: this backup was made by a newer version of the app (schema ${schemaVersion}; ` +
      `this app reads schema ${BACKUP_SCHEMA_VERSION}). Update the app, then restore.`
    )
  }
  return null
}

// ── Error messages ───────────────────────────────────────────────────────────

const TYPE_LABELS: Readonly<Record<string, string>> = { int: 'integer', record: 'object' }

function formatIssue(issue: z.core.$ZodIssue): string {
  return `${formatPath(issue.path)}: ${describeIssue(issue)}`
}

function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return expectation(TYPE_LABELS[issue.expected] ?? issue.expected, issue.input)
    case 'invalid_value': {
      const values = issue.values.map(describeValue)
      return expectation(
        values.length === 1 ? values[0]! : `one of ${values.join(', ')}`,
        issue.input,
      )
    }
    case 'too_small':
      if (issue.origin === 'string') return 'must not be empty'
      return expectation(`a value ${issue.inclusive ? '>=' : '>'} ${issue.minimum}`, issue.input)
    case 'too_big':
      return expectation(`a value ${issue.inclusive ? '<=' : '<'} ${issue.maximum}`, issue.input)
    default:
      return issue.message
  }
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const MAX_SHOWN_CHARS = 40

/** ['tables', 'setLogs', 3, 'reps'] → "tables.setLogs[3].reps"; the root is "backup". */
function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'backup'
  return path
    .map((seg, i) => {
      if (typeof seg === 'number') return `[${seg}]`
      if (typeof seg === 'symbol') return `[${String(seg)}]`
      if (!IDENTIFIER.test(seg)) return `[${JSON.stringify(seg)}]`
      return i === 0 ? seg : `.${seg}`
    })
    .join('')
}

function expectation(expected: string, input: unknown): string {
  return input === undefined
    ? `expected ${expected} (missing)`
    : `expected ${expected}, got ${describeValue(input)}`
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  switch (typeof value) {
    case 'string': {
      const shown = value.length > MAX_SHOWN_CHARS ? `${value.slice(0, MAX_SHOWN_CHARS)}…` : value
      return JSON.stringify(shown)
    }
    case 'object':
      return 'an object'
    case 'number':
    case 'boolean':
      return String(value)
    default:
      return typeof value
  }
}
