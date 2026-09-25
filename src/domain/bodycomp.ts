// Body composition. Smoothed body fat (finding #35, G8): the mean of the last `bfSmoothN`
// readings within `bfSmoothWindowDays` when at least `bfSmoothMin` exist, else the latest single
// reading within `bfSingleFallbackDays`, else nothing. "Within N days" means the N calendar days
// ending on the as-of date, like the 7-day weight average. Seed readings count; a user entry
// wins over a seed entry on the same date. Also lean mass, BMI, FFMI and the two RMR formulas
// behind the maintenance estimate (Mifflin-St Jeor with both sex constants, Katch-McArdle).
import { compareLocalDate, daysBetween } from '@/domain/dates'
import { mean } from '@/domain/rounding'
import type { BodyEntry, LocalDate, Settings, Sex } from '@/domain/types'
import { inToCm, lbToKg } from '@/domain/units'

const BMI_FACTOR = 703
const CM_PER_M = 100

export interface SmoothedBodyFat {
  pct: number
  /** Readings averaged (1 for a single fallback reading). */
  n: number
  quality: 'smoothed' | 'single'
}

export interface BodyComposition {
  leanLb: number | null
  fatLb: number | null
  bmi: number
  ffmi: number | null
}

export interface MifflinInput {
  weightKg: number
  heightCm: number
  age: number
  sex: Sex
}

interface BfReading {
  date: LocalDate
  pct: number
  entry: BodyEntry
}

function bodyFatReadings(entries: readonly BodyEntry[], asOf: LocalDate): BfReading[] {
  const byDate = new Map<LocalDate, BfReading>()
  for (const e of entries) {
    const pct = e.bodyFatPct
    if (e.voidedAt !== null || pct === null || !Number.isFinite(pct)) continue
    if (compareLocalDate(e.date, asOf) > 0) continue
    const prev = byDate.get(e.date)
    if (!prev || outranks(e, prev.entry)) byDate.set(e.date, { date: e.date, pct, entry: e })
  }
  return [...byDate.values()].sort((a, b) => compareLocalDate(b.date, a.date))
}

function outranks(a: BodyEntry, b: BodyEntry): boolean {
  if (a.source !== b.source) return a.source === 'user'
  return a.updatedAt >= b.updatedAt
}

/** Smoothed body fat on `asOf`, falling back to one recent reading; null when none is usable. */
export function smoothedBodyFat(
  readings: readonly BodyEntry[],
  asOf: LocalDate,
  s: Settings,
): SmoothedBodyFat | null {
  const all = bodyFatReadings(readings, asOf)
  const recent = all
    .filter((r) => daysBetween(r.date, asOf) < s.bfSmoothWindowDays)
    .slice(0, Math.max(1, s.bfSmoothN))
  const avg = mean(recent.map((r) => r.pct))
  if (avg !== null && recent.length >= s.bfSmoothMin) {
    return { pct: avg, n: recent.length, quality: 'smoothed' }
  }
  const latest = all[0]
  if (latest && daysBetween(latest.date, asOf) < s.bfSingleFallbackDays) {
    return { pct: latest.pct, n: 1, quality: 'single' }
  }
  return null
}

/** Lean mass = weight × (1 − body fat / 100). */
export function leanMassLb(weightLb: number, bodyFatPct: number): number {
  return weightLb * (1 - bodyFatPct / 100)
}

/** BMI = 703 × lb / in². */
export function bmi(weightLb: number, heightIn: number): number {
  return (BMI_FACTOR * weightLb) / (heightIn * heightIn)
}

/** FFMI = lean mass (kg) / height (m)². */
export function ffmi(leanLb: number, heightIn: number): number {
  const m = inToCm(heightIn) / CM_PER_M
  return lbToKg(leanLb) / (m * m)
}

/** Mifflin-St Jeor RMR = 10W + 6.25H − 5A + 5 (male) or − 161 (female). */
export function mifflinStJeor({ weightKg, heightCm, age, sex }: MifflinInput): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161)
}

/** Katch-McArdle RMR = 370 + 21.6 × lean mass (kg). */
export function katchMcArdle(leanKg: number): number {
  return 370 + 21.6 * leanKg
}

/** The derived body-composition card: lean and fat mass (when body fat is known), BMI, FFMI. */
export function bodyComposition(
  weightLb: number,
  bodyFatPct: number | null,
  heightIn: number,
): BodyComposition {
  const leanLb = bodyFatPct === null ? null : leanMassLb(weightLb, bodyFatPct)
  return {
    leanLb,
    fatLb: leanLb === null ? null : weightLb - leanLb,
    bmi: bmi(weightLb, heightIn),
    ffmi: leanLb === null ? null : ffmi(leanLb, heightIn),
  }
}
