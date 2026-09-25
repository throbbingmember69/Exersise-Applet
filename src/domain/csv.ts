// CSV export: the spec's three flat files (sets, body entries, nutrition entries).
//
// Format is RFC 4180 with CRLF line endings. Masses are lb and dates are ISO `YYYY-MM-DD`; voided
// rows are left out. Numbers print as plain decimals (no locale, float noise rounded away at 6
// decimals). Text cells a spreadsheet would run as a formula get a leading apostrophe; numbers are
// never guarded, so a negative load stays a number.
import { compareLocalDate } from './dates'
import { roundHalfAway } from './rounding'
import type {
  BodyEntry,
  EpochMs,
  Gym,
  LocalDate,
  NutritionEntry,
  ProgramDay,
  Session,
  SessionExercise,
  SetLog,
} from './types'

export type CsvCell = string | number | boolean | null
export type CsvKind = 'sets' | 'body' | 'nutrition'

export interface CsvOptions {
  /** Prefix a UTF-8 byte-order mark (helps Excel detect the encoding). Default false. */
  bom?: boolean
}

export const SETS_CSV_HEADER = [
  'date',
  'session_id',
  'session_status',
  'program_day',
  'gym',
  'exercise',
  'exercise_id',
  'load_type',
  'per_hand',
  'set_index',
  'is_warmup',
  'load_lb',
  'reps',
  'rir',
  'set_note',
  'session_bodyweight_lb',
  'is_deload',
] as const

export const BODY_CSV_HEADER = [
  'date',
  'weight_lb',
  'body_fat_pct',
  'muscle_mass_lb',
  'skeletal_muscle_pct',
  'subcut_fat_pct',
  'visceral_rating',
  'source',
  'note',
] as const

export const NUTRITION_CSV_HEADER = [
  'date',
  'kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'steps',
] as const

const EOL = '\r\n'
const BOM = '\uFEFF'
/** Enough for kg-entered loads stored in lb, and it hides binary noise such as 0.1 + 0.2. */
const NUMBER_DECIMALS = 6
const NEEDS_QUOTES = /[",\r\n]/
const FORMULA_START = /^[=+\-@\t\r]/

/** Serialize a header and rows as RFC 4180 CSV; every record, the last included, ends in CRLF. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  options: CsvOptions = {},
): string {
  const lines = [header.map(formatCell).join(',')]
  rows.forEach((row, i) => {
    if (row.length !== header.length) {
      throw new RangeError(
        `CSV row ${i} has ${row.length} cells but the header has ${header.length}`,
      )
    }
    lines.push(row.map(formatCell).join(','))
  })
  return (options.bom ? BOM : '') + lines.join(EOL) + EOL
}

export interface SetsCsvInput {
  sessions: readonly Session[]
  sessionExercises: readonly SessionExercise[]
  setLogs: readonly SetLog[]
  programDays: readonly ProgramDay[]
  gyms: readonly Gym[]
}

/**
 * One row per logged set, in session order. Voided sets and every set of a voided session are
 * excluded; in-progress and abandoned sessions are included (see session_status). A set whose
 * parent rows are missing is still exported, with those columns blank.
 */
export function setsCsv(input: SetsCsvInput, options?: CsvOptions): string {
  const sessions = indexById(input.sessions)
  const sessionExercises = indexById(input.sessionExercises)
  const dayNames = new Map(input.programDays.map((d) => [d.id, d.name]))
  const gymNames = new Map(input.gyms.map((g) => [g.id, g.name]))

  const rows = input.setLogs
    .filter(isLive)
    .map((set) => ({
      set,
      session: sessions.get(set.sessionId),
      exercise: sessionExercises.get(set.sessionExerciseId),
    }))
    .filter(({ session }) => session === undefined || isLive(session))
    .map((r) => ({ ...r, key: setSortKey(r.set, r.session, r.exercise) }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ set, session, exercise }): CsvCell[] => [
      session?.date ?? null,
      set.sessionId,
      session?.status ?? null,
      session?.programDayId ? (dayNames.get(session.programDayId) ?? session.programDayId) : null,
      session ? (gymNames.get(session.gymId) ?? session.gymId) : null,
      exercise?.exerciseName ?? null,
      set.exerciseId,
      exercise?.loadType ?? null,
      exercise?.perHand ?? null,
      set.setIndex,
      set.isWarmup,
      set.loadLb,
      set.reps,
      set.rir,
      set.note,
      session?.bodyweightLb ?? null,
      session?.isDeload ?? null,
    ])

  return toCsv(SETS_CSV_HEADER, rows, options)
}

/** Body entries by date, voided entries excluded. */
export function bodyCsv(entries: readonly BodyEntry[], options?: CsvOptions): string {
  const rows = entries
    .filter(isLive)
    .sort(byDate)
    .map((e): CsvCell[] => [
      e.date,
      e.weightLb,
      e.bodyFatPct,
      e.muscleMassLb,
      e.skeletalMusclePct,
      e.subcutFatPct,
      e.visceralRating,
      e.source,
      e.note,
    ])
  return toCsv(BODY_CSV_HEADER, rows, options)
}

/** Daily nutrition totals by date. */
export function nutritionCsv(entries: readonly NutritionEntry[], options?: CsvOptions): string {
  const rows = [...entries]
    .sort(byDate)
    .map((e): CsvCell[] => [e.date, e.kcal, e.proteinG, e.carbsG, e.fatG, e.steps])
  return toCsv(NUTRITION_CSV_HEADER, rows, options)
}

/** Download name for an export, e.g. `exersise-sets-2026-09-24.csv`. */
export function csvFileName(kind: CsvKind, date: LocalDate): string {
  return `exersise-${kind}-${date}.csv`
}

function formatCell(cell: CsvCell): string {
  if (cell === null) return ''
  if (typeof cell === 'boolean') return cell ? 'true' : 'false'
  if (typeof cell === 'number') return formatNumber(cell)
  const text = FORMULA_START.test(cell) ? `'${cell}` : cell
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function formatNumber(x: number): string {
  // Non-finite values can't come from valid data; a blank cell beats failing the whole export.
  if (!Number.isFinite(x)) return ''
  // String() never uses locale grouping and prints -0 as "0".
  return String(roundHalfAway(x, NUMBER_DECIMALS))
}

function isLive(row: { voidedAt: EpochMs | null }): boolean {
  return row.voidedAt == null
}

function indexById<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]))
}

function byDate(a: { date: LocalDate }, b: { date: LocalDate }): number {
  return compareLocalDate(a.date, b.date)
}

type SortKey = readonly (string | number)[]

/** Date, session start, session-exercise order, set index; ids break ties. Orphans sort last. */
function setSortKey(
  set: SetLog,
  session: Session | undefined,
  exercise: SessionExercise | undefined,
): SortKey {
  return [
    session ? 0 : 1,
    session?.date ?? '',
    session?.startedAt ?? 0,
    set.sessionId,
    exercise?.order ?? Number.MAX_SAFE_INTEGER,
    set.sessionExerciseId,
    set.setIndex,
    set.loggedAt,
    set.id,
  ]
}

function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}
