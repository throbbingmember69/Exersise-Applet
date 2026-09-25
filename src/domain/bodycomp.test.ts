import { describe, expect, it } from 'vitest'
import { parseLocalDate } from '@/domain/dates'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { BodyEntry, Settings } from '@/domain/types'
import { SEED_BODY_ENTRY, SEED_DATE } from '@/seed/profile'
import {
  bmi,
  bodyComposition,
  ffmi,
  katchMcArdle,
  leanMassLb,
  mifflinStJeor,
  smoothedBodyFat,
} from './bodycomp'

const d = parseLocalDate
const s = DEFAULT_SETTINGS
const asOf = d('2026-10-29')

function bf(date: string, bodyFatPct: number | null, extra: Partial<BodyEntry> = {}): BodyEntry {
  return {
    date: d(date),
    weightLb: 170,
    bodyFatPct,
    muscleMassLb: null,
    skeletalMusclePct: null,
    subcutFatPct: null,
    visceralRating: null,
    source: 'user',
    note: '',
    createdAt: 0,
    updatedAt: 0,
    voidedAt: null,
    ...extra,
  }
}

describe('smoothedBodyFat', () => {
  it('averages the last 3 readings within 28 days', () => {
    const readings = [
      bf('2026-10-08', 18),
      bf('2026-10-15', 17),
      bf('2026-10-22', 16),
      bf('2026-10-29', 15),
    ]
    expect(smoothedBodyFat(readings, asOf, s)).toEqual({ pct: 16, n: 3, quality: 'smoothed' })
  })

  it('uses the 28 calendar days ending on the as-of date', () => {
    // 2026-10-02 is 27 days before 2026-10-29 (inside); 2026-10-01 is 28 days before (outside).
    expect(smoothedBodyFat([bf('2026-10-29', 15), bf('2026-10-02', 17)], asOf, s)).toEqual({
      pct: 16,
      n: 2,
      quality: 'smoothed',
    })
    expect(smoothedBodyFat([bf('2026-10-29', 15), bf('2026-10-01', 17)], asOf, s)).toEqual({
      pct: 15,
      n: 1,
      quality: 'single',
    })
  })

  it('falls back to the latest single reading within 90 days, else null', () => {
    expect(smoothedBodyFat([bf('2026-08-01', 16)], asOf, s)).toEqual({
      pct: 16,
      n: 1,
      quality: 'single',
    })
    expect(smoothedBodyFat([bf('2026-07-31', 16)], asOf, s)).toBeNull()
    expect(smoothedBodyFat([], asOf, s)).toBeNull()
  })

  it('ignores voided, empty and future readings', () => {
    const readings = [
      bf('2026-10-29', 15),
      bf('2026-10-28', 30, { voidedAt: 1 }),
      bf('2026-10-27', null),
      bf('2026-10-30', 30),
    ]
    expect(smoothedBodyFat(readings, asOf, s)).toEqual({ pct: 15, n: 1, quality: 'single' })
  })

  it('keeps one reading per date: user over seed, then the latest update', () => {
    const readings = [
      bf('2026-10-29', 20, { source: 'seed', updatedAt: 99 }),
      bf('2026-10-29', 15, { updatedAt: 1 }),
      bf('2026-10-22', 18, { updatedAt: 1 }),
      bf('2026-10-22', 17, { updatedAt: 2 }),
    ]
    expect(smoothedBodyFat(readings, asOf, s)).toEqual({ pct: 16, n: 2, quality: 'smoothed' })
    expect(smoothedBodyFat([...readings].reverse(), asOf, s)).toEqual({
      pct: 16,
      n: 2,
      quality: 'smoothed',
    })
  })

  it('counts the seed reading', () => {
    expect(smoothedBodyFat([SEED_BODY_ENTRY], SEED_DATE, s)).toEqual({
      pct: 14.3,
      n: 1,
      quality: 'single',
    })
    const withUser = [SEED_BODY_ENTRY, bf('2026-10-01', 14)]
    const v = smoothedBodyFat(withUser, d('2026-10-01'), s)
    expect(v?.quality).toBe('smoothed')
    expect(v?.n).toBe(2)
    expect(v?.pct).toBeCloseTo(14.15, 10)
  })

  it('follows the smoothing settings', () => {
    const one: Settings = { ...s, bfSmoothMin: 1 }
    expect(smoothedBodyFat([bf('2026-10-29', 15)], asOf, one)?.quality).toBe('smoothed')
    const two: Settings = { ...s, bfSmoothN: 2 }
    const readings = [bf('2026-10-15', 20), bf('2026-10-22', 16), bf('2026-10-29', 15)]
    expect(smoothedBodyFat(readings, asOf, two)).toEqual({ pct: 15.5, n: 2, quality: 'smoothed' })
  })
})

describe('body composition formulas (seed profile)', () => {
  it('derives lean mass, BMI and FFMI as in the spec', () => {
    expect(leanMassLb(163, 14.3)).toBeCloseTo(139.691, 9)
    expect(bmi(163, 71)).toBeCloseTo(22.7314, 4)
    expect(ffmi(139.691, 71)).toBeCloseTo(19.4827, 4)
  })

  it('computes Mifflin-St Jeor with both sex constants', () => {
    const seed = { weightKg: 73.93555631, heightCm: 180.34, age: 22 }
    expect(mifflinStJeor({ ...seed, sex: 'male' })).toBeCloseTo(1761.4806, 4)
    expect(mifflinStJeor({ weightKg: 60, heightCm: 165, age: 30, sex: 'female' })).toBe(1320.25)
  })

  it('computes Katch-McArdle from lean kg', () => {
    expect(katchMcArdle(63.36277175767)).toBeCloseTo(1738.6359, 4)
    expect(katchMcArdle(0)).toBe(370)
  })

  it('builds the body-composition card with and without body fat', () => {
    const card = bodyComposition(163, 14.3, 71)
    expect(card.leanLb).toBeCloseTo(139.691, 9)
    expect(card.fatLb).toBeCloseTo(23.309, 9)
    expect(card.bmi).toBeCloseTo(22.7314, 4)
    expect(card.ffmi).toBeCloseTo(19.4827, 4)
    expect(bodyComposition(163, null, 71)).toEqual({
      leanLb: null,
      fatLb: null,
      bmi: expect.closeTo(22.7314, 4),
      ffmi: null,
    })
  })
})
