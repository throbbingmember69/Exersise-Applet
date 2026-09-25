// Trend weight: the Hacker's Diet EMA, T_t = T_{t−1} + α(W_t − T_{t−1}), over calendar days
// (finding #31). Only real weigh-ins feed it: non-voided `source: 'user'` entries with a weight,
// one per date (the latest update wins). T0 is the first real weigh-in. Interior gaps are
// linearly interpolated and flagged; nothing is extrapolated past the last reading, so a date
// after it only gets the last trend value marked stale. Seed entries are a fallback bodyweight
// until the first real weigh-in and never enter the trend.
import { addDays, compareLocalDate, daysBetween } from '@/domain/dates'
import { mean } from '@/domain/rounding'
import type { BodyEntry, LocalDate, Settings } from '@/domain/types'

const DAYS_PER_WEEK = 7

export interface DailyWeight {
  date: LocalDate
  weightLb: number
  /** true when the date had no weigh-in and the weight is interpolated between its neighbours. */
  interpolated: boolean
}

export interface TrendPoint extends DailyWeight {
  trendLb: number
}

export interface TrendValue {
  trendLb: number
  /** true after the last reading: the last trend value carried forward, not a fresh one. */
  stale: boolean
}

export interface Bodyweight {
  weightLb: number
  /** 'trend' once a real weigh-in exists on or before the date, else the seed baseline. */
  source: 'trend' | 'seed'
  stale: boolean
}

interface Reading {
  date: LocalDate
  weightLb: number
  updatedAt: number
}

function readingsOf(entries: readonly BodyEntry[], source: BodyEntry['source']): Reading[] {
  const byDate = new Map<LocalDate, Reading>()
  for (const e of entries) {
    if (e.source !== source || e.voidedAt !== null) continue
    const w = e.weightLb
    if (w === null || !Number.isFinite(w) || w <= 0) continue
    const prev = byDate.get(e.date)
    if (!prev || e.updatedAt >= prev.updatedAt) {
      byDate.set(e.date, { date: e.date, weightLb: w, updatedAt: e.updatedAt })
    }
  }
  return [...byDate.values()].sort((a, b) => compareLocalDate(a.date, b.date))
}

/** Dates with a real (non-voided, user) weigh-in, ascending. */
export function weighInDates(entries: readonly BodyEntry[]): LocalDate[] {
  return readingsOf(entries, 'user').map((r) => r.date)
}

/** One weight per calendar day from the first to the last real weigh-in; gaps interpolated. */
export function dailyWeights(entries: readonly BodyEntry[]): DailyWeight[] {
  const readings = readingsOf(entries, 'user')
  const out: DailyWeight[] = []
  readings.forEach((r, i) => {
    out.push({ date: r.date, weightLb: r.weightLb, interpolated: false })
    const next = readings[i + 1]
    if (!next) return
    const gap = daysBetween(r.date, next.date)
    for (let k = 1; k < gap; k++) {
      const weightLb = r.weightLb + ((next.weightLb - r.weightLb) * k) / gap
      out.push({ date: addDays(r.date, k), weightLb, interpolated: true })
    }
  })
  return out
}

/** EMA over consecutive calendar days, seeded with T0 = W0. Throws if a day is missing. */
export function emaTrend(daily: readonly DailyWeight[], alpha: number): TrendPoint[] {
  if (!(alpha > 0 && alpha <= 1)) throw new RangeError(`alpha must be in (0, 1], got ${alpha}`)
  const out: TrendPoint[] = []
  let prev: TrendPoint | undefined
  for (const d of daily) {
    if (prev && daysBetween(prev.date, d.date) !== 1) {
      throw new RangeError(`Daily weights must be consecutive: ${prev.date} → ${d.date}`)
    }
    const trendLb = prev ? prev.trendLb + alpha * (d.weightLb - prev.trendLb) : d.weightLb
    prev = { ...d, trendLb }
    out.push(prev)
  }
  return out
}

/** The trend series for a set of body entries with the configured α. */
export function buildTrend(entries: readonly BodyEntry[], s: Settings): TrendPoint[] {
  return emaTrend(dailyWeights(entries), s.trendAlpha)
}

function pointAt(trend: readonly TrendPoint[], date: LocalDate): TrendPoint | null {
  const first = trend[0]
  if (!first) return null
  const i = daysBetween(first.date, date)
  return i >= 0 ? (trend[i] ?? null) : null
}

/** Trend on a date: null before T0; after the last reading, the last value marked stale. */
export function trendOn(trend: readonly TrendPoint[], date: LocalDate): TrendValue | null {
  const p = pointAt(trend, date)
  if (p) return { trendLb: p.trendLb, stale: false }
  const first = trend[0]
  const last = trend[trend.length - 1]
  if (!first || !last || compareLocalDate(date, first.date) < 0) return null
  return { trendLb: last.trendLb, stale: true }
}

/** (T_d − T_{d−7}) / T_{d−7} × 100, or null unless both points are in the series. */
export function weeklyRatePct(trend: readonly TrendPoint[], date: LocalDate): number | null {
  const end = pointAt(trend, date)
  const start = pointAt(trend, addDays(date, -DAYS_PER_WEEK))
  if (!end || !start) return null
  return ((end.trendLb - start.trendLb) / start.trendLb) * 100
}

/** Mean of real weigh-ins in [date − 6, date], or null with fewer than `minReadings`. */
export function sevenDayAvg(
  entries: readonly BodyEntry[],
  date: LocalDate,
  minReadings: number,
): number | null {
  const from = addDays(date, -(DAYS_PER_WEEK - 1))
  const weights = readingsOf(entries, 'user')
    .filter((r) => compareLocalDate(r.date, from) >= 0 && compareLocalDate(r.date, date) <= 0)
    .map((r) => r.weightLb)
  if (weights.length < Math.max(1, minReadings)) return null
  return mean(weights)
}

/** Weight of the latest non-voided seed entry: the fallback before any real weigh-in. */
export function seedFallbackWeightLb(entries: readonly BodyEntry[]): number | null {
  return readingsOf(entries, 'seed').at(-1)?.weightLb ?? null
}

/** Bodyweight to use on a date: the trend when one exists, else the seed baseline, else null. */
export function bodyweightOn(
  trend: readonly TrendPoint[],
  entries: readonly BodyEntry[],
  date: LocalDate,
): Bodyweight | null {
  const t = trendOn(trend, date)
  if (t) return { weightLb: t.trendLb, source: 'trend', stale: t.stale }
  const seed = seedFallbackWeightLb(entries)
  return seed === null ? null : { weightLb: seed, source: 'seed', stale: false }
}
