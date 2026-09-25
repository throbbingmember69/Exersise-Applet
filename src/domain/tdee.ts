// Maintenance (TDEE).
// Formula: the mean of Katch-McArdle and Mifflin-St Jeor × activity factor, Mifflin alone when
// body fat is unknown. Measured (finding #30): the longest window of tdeeWindowMaxDays down to
// tdeeWindowMinDays calendar days ending on the as-of date where at least tdeeMinLoggedPct% of
// days have kcal and a weigh-in, starting at least tdeeExcludeDaysAfterStart days after every
// disruption (phase start). TDEE = mean kcal over logged days − kcalPerLb × ΔT / L, where ΔT runs
// from the trend at the close of the day before the window to the trend on its last day, so it
// spans exactly the window's L days. Timeline (finding #29): the first measured estimate replaces
// the formula uncapped; later ones move at most ±tdeeMaxWeeklyChangeKcal from the previous
// estimate; without a measurement the previous estimate is kept as 'insufficient_data'.
import { katchMcArdle, leanMassLb, mifflinStJeor } from '@/domain/bodycomp'
import { addDays, compareLocalDate, dateRange, daysBetween } from '@/domain/dates'
import { clamp, mean } from '@/domain/rounding'
import { trendOn, type TrendPoint } from '@/domain/trend'
import type {
  LocalDate,
  MaintenanceSource,
  NutritionEntry,
  Settings,
  Sex,
  TdeeSource,
} from '@/domain/types'
import { inToCm, lbToKg } from '@/domain/units'

export interface FormulaTdeeInput {
  trendLb: number
  bodyFatPct: number | null
  heightIn: number
  age: number
  sex: Sex
}

export interface FormulaTdee {
  /** Unrounded maintenance kcal/day. */
  kcal: number
  method: 'avg' | 'mifflin_only'
  mifflinStJeor: number
  katchMcArdle: number | null
}

export interface MeasuredTdeeInput {
  asOf: LocalDate
  intake: readonly NutritionEntry[]
  /** Dates with a real weigh-in (see `weighInDates` in trend.ts). */
  weighInDates: readonly LocalDate[]
  trend: readonly TrendPoint[]
  /** Phase (or diet-break) starts; the window must begin long enough after each. */
  disruptions: readonly LocalDate[]
}

export interface MeasuredTdee {
  kcal: number
  windowDays: number
  startDate: LocalDate
  intakePct: number
  weighInPct: number
  meanIntakeKcal: number
  trendChangeLb: number
}

export interface LoggingCoverage {
  days: number
  intakeDays: number
  weighInDays: number
  intakePct: number
  weighInPct: number
}

export interface TdeeEstimate {
  kcal: number
  source: TdeeSource
  /** true when the week-over-week cap clamped the measured value. */
  capped: boolean
}

export interface TdeeCheckpoint {
  date: LocalDate
  /** `measuredTdee(...)?.kcal`, or null when no window qualified. */
  measuredKcal: number | null
  /** The formula estimate on that date (used until the first measurement). */
  formulaKcal: number
}

export interface TdeePoint extends TdeeEstimate {
  date: LocalDate
  measuredKcal: number | null
}

/** Formula maintenance: mean(Katch-McArdle, Mifflin-St Jeor) × activity factor. */
export function formulaTdee(input: FormulaTdeeInput, s: Settings): FormulaTdee {
  const { trendLb, bodyFatPct, heightIn, age, sex } = input
  const mifflin = mifflinStJeor({ weightKg: lbToKg(trendLb), heightCm: inToCm(heightIn), age, sex })
  if (bodyFatPct === null) {
    return {
      kcal: mifflin * s.activityFactor,
      method: 'mifflin_only',
      mifflinStJeor: mifflin,
      katchMcArdle: null,
    }
  }
  const katch = katchMcArdle(lbToKg(leanMassLb(trendLb, bodyFatPct)))
  return {
    kcal: ((katch + mifflin) / 2) * s.activityFactor,
    method: 'avg',
    mifflinStJeor: mifflin,
    katchMcArdle: katch,
  }
}

function intakeByDate(intake: readonly NutritionEntry[]): Map<LocalDate, NutritionEntry> {
  const byDate = new Map<LocalDate, NutritionEntry>()
  for (const e of intake) {
    if (e.kcal === null || !Number.isFinite(e.kcal)) continue
    const prev = byDate.get(e.date)
    if (!prev || e.updatedAt >= prev.updatedAt) byDate.set(e.date, e)
  }
  return byDate
}

function coverage(
  days: readonly LocalDate[],
  kcal: ReadonlyMap<LocalDate, NutritionEntry>,
  weighIns: ReadonlySet<LocalDate>,
): LoggingCoverage {
  const intakeDays = days.filter((d) => kcal.has(d)).length
  const weighInDays = days.filter((d) => weighIns.has(d)).length
  const n = days.length
  return {
    days: n,
    intakeDays,
    weighInDays,
    intakePct: n === 0 ? 0 : (intakeDays / n) * 100,
    weighInPct: n === 0 ? 0 : (weighInDays / n) * 100,
  }
}

/** Share of days in [from, to] with a kcal entry and with a weigh-in. */
export function loggingCoverage(input: {
  from: LocalDate
  to: LocalDate
  intake: readonly NutritionEntry[]
  weighInDates: readonly LocalDate[]
}): LoggingCoverage {
  return coverage(
    dateRange(input.from, input.to),
    intakeByDate(input.intake),
    new Set(input.weighInDates),
  )
}

/** Measured maintenance over the longest qualifying window ending on `asOf`, or null. */
export function measuredTdee(input: MeasuredTdeeInput, s: Settings): MeasuredTdee | null {
  const { asOf, trend } = input
  const kcal = intakeByDate(input.intake)
  const weighIns = new Set(input.weighInDates)
  const disruptions = input.disruptions.filter((d) => compareLocalDate(d, asOf) <= 0)
  const minLen = Math.min(s.tdeeWindowMinDays, s.tdeeWindowMaxDays)
  const maxLen = Math.max(s.tdeeWindowMinDays, s.tdeeWindowMaxDays)

  for (let len = maxLen; len >= minLen; len--) {
    const start = addDays(asOf, -(len - 1))
    if (disruptions.some((d) => daysBetween(d, start) < s.tdeeExcludeDaysAfterStart)) continue
    const days = dateRange(start, asOf)
    const cov = coverage(days, kcal, weighIns)
    const needed = s.tdeeMinLoggedPct * len
    if (cov.intakeDays * 100 < needed || cov.weighInDays * 100 < needed) continue
    const tStart = trendOn(trend, addDays(start, -1))
    const tEnd = trendOn(trend, asOf)
    const meanKcal = mean(days.flatMap((d) => kcal.get(d)?.kcal ?? []))
    if (!tStart || tStart.stale || !tEnd || meanKcal === null) continue
    const trendChangeLb = tEnd.trendLb - tStart.trendLb
    return {
      kcal: meanKcal - (s.kcalPerLb * trendChangeLb) / len,
      windowDays: len,
      startDate: start,
      intakePct: cov.intakePct,
      weighInPct: cov.weighInPct,
      meanIntakeKcal: meanKcal,
      trendChangeLb,
    }
  }
  return null
}

/** One step of the estimate timeline: formula → first measured (uncapped) → capped updates. */
export function nextTdeeEstimate(
  prev: TdeeEstimate | null,
  measuredKcal: number | null,
  formulaKcal: number,
  s: Settings,
): TdeeEstimate {
  const hasMeasured = prev !== null && prev.source !== 'formula'
  if (measuredKcal === null) {
    return hasMeasured
      ? { kcal: prev.kcal, source: 'insufficient_data', capped: false }
      : { kcal: formulaKcal, source: 'formula', capped: false }
  }
  if (!hasMeasured) return { kcal: measuredKcal, source: 'measured', capped: false }
  const cap = s.tdeeMaxWeeklyChangeKcal
  const kcal = clamp(measuredKcal, prev.kcal - cap, prev.kcal + cap)
  return { kcal, source: 'measured', capped: kcal !== measuredKcal }
}

/** Fold checkpoints (sorted by date here) into the estimate timeline, starting from `initial`. */
export function tdeeTimeline(
  checkpoints: readonly TdeeCheckpoint[],
  s: Settings,
  initial: TdeeEstimate | null = null,
): TdeePoint[] {
  const sorted = [...checkpoints].sort((a, b) => compareLocalDate(a.date, b.date))
  const out: TdeePoint[] = []
  let prev = initial
  for (const c of sorted) {
    prev = nextTdeeEstimate(prev, c.measuredKcal, c.formulaKcal, s)
    out.push({ date: c.date, measuredKcal: c.measuredKcal, ...prev })
  }
  return out
}

/** Maintenance for a new phase: the last valid measured estimate, otherwise the formula. */
export function phaseStartMaintenance(
  estimate: TdeeEstimate | null,
  formulaKcal: number,
): { kcal: number; source: MaintenanceSource } {
  if (estimate && estimate.source !== 'formula') return { kcal: estimate.kcal, source: 'measured' }
  return { kcal: formulaKcal, source: 'formula' }
}
