// Acceptance: "With the seed profile, starting targets match Nutrition targets (about 2,700 kcal
// maintenance, 3,000 kcal bulk, 150 g protein)", plus the rest of the spec's "Targets by phase"
// table. Tolerance ±50 kcal and ±5 g (finding #43); with default rounding the values are exact.
import { describe, expect, it } from 'vitest'
import { smoothedBodyFat } from '@/domain/bodycomp'
import { ageOn } from '@/domain/dates'
import { roundHalfAway, roundToStep } from '@/domain/rounding'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import { formulaTdee, phaseStartMaintenance } from '@/domain/tdee'
import { bodyweightOn, buildTrend } from '@/domain/trend'
import type { PhaseType } from '@/domain/types'
import { SEED_BODY_ENTRY, SEED_DATE, SEED_PROFILE } from '@/seed/profile'
import { proposePhaseTargets } from './nutritionTargets'

const s = DEFAULT_SETTINGS
const entries = [SEED_BODY_ENTRY]
const trend = buildTrend(entries, s)
const weight = bodyweightOn(trend, entries, SEED_DATE)
const bf = smoothedBodyFat(entries, SEED_DATE, s)
const age = ageOn(SEED_PROFILE, SEED_DATE)

const weightLb = weight?.weightLb ?? Number.NaN
const formula = formulaTdee(
  {
    trendLb: weightLb,
    bodyFatPct: bf?.pct ?? null,
    heightIn: SEED_PROFILE.heightIn,
    age,
    sex: SEED_PROFILE.sex,
  },
  s,
)
const maintenance = phaseStartMaintenance(null, formula.kcal)

function propose(type: PhaseType) {
  return proposePhaseTargets(
    {
      type,
      maintenanceKcal: maintenance.kcal,
      maintenanceSource: maintenance.source,
      trendLb: weightLb,
      bodyFatPct: bf?.pct ?? null,
      bfQuality: bf?.quality ?? 'none',
    },
    s,
  )
}

function expectWithin(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

describe('seed profile inputs', () => {
  it('uses the seed weight (no real weigh-in yet), the seed body-fat reading and age 22', () => {
    expect(trend).toEqual([])
    expect(weight).toEqual({ weightLb: 163, source: 'seed', stale: false })
    expect(bf).toEqual({ pct: 14.3, n: 1, quality: 'single' })
    expect(age).toBe(22)
    expect(SEED_PROFILE).toMatchObject({ heightIn: 71, sex: 'male' })
    expect(s.activityFactor).toBe(1.55)
  })
})

describe('seed maintenance estimate', () => {
  it('reproduces Katch-McArdle ≈ 1,739 and Mifflin-St Jeor ≈ 1,762', () => {
    expect(formula.method).toBe('avg')
    expect(formula.katchMcArdle).toBeCloseTo(1738.6, 1)
    expect(formula.mifflinStJeor).toBeCloseTo(1761.5, 1)
  })

  it('gives about 2,700 kcal maintenance: 1,750 × 1.55 ≈ 2,712.6, rounded to 2,700', () => {
    expect(maintenance.source).toBe('formula')
    expectWithin(maintenance.kcal, 2712.6, 1)
    expect(roundToStep(maintenance.kcal, s.kcalRoundTo)).toBe(2700)
  })
})

describe('seed starting targets by phase', () => {
  const bulk = propose('bulk')
  const maint = propose('maintenance')
  const cut = propose('cut')

  it('matches the calorie targets: bulk 3,000, maintenance 2,700, cut 2,200', () => {
    expectWithin(bulk.kcal, 3000, 50)
    expectWithin(maint.kcal, 2700, 50)
    expectWithin(cut.kcal, 2200, 50)
    expect([bulk.kcal, maint.kcal, cut.kcal]).toEqual([3000, 2700, 2200])
  })

  it('matches protein: bulk 150 g, maintenance 150 g, cut 170 g', () => {
    expectWithin(bulk.proteinG, 150, 5)
    expectWithin(maint.proteinG, 150, 5)
    expectWithin(cut.proteinG, 170, 5)
    expect([bulk.proteinG, maint.proteinG, cut.proteinG]).toEqual([150, 150, 170])
    expect(cut.proteinBasis).toBe('leanMass')
  })

  it('matches fat (25% of kcal) and carbs', () => {
    expect(roundHalfAway(bulk.fatG)).toBe(83)
    expect(bulk.carbsG).toBeCloseTo(412.5, 9)
    expectWithin(bulk.carbsG, 413, 1)
    expect(roundHalfAway(maint.fatG)).toBe(75)
    expectWithin(maint.carbsG, 355, 5)
    expect(roundHalfAway(cut.fatG)).toBe(61)
    expect(cut.carbsG).toBeCloseTo(242.5, 9)
    expectWithin(cut.carbsG, 245, 5)
    expectWithin(cut.carbsG, 240, 5) // the spec table's "~240"
  })

  it('lands inside the spec’s change vs. maintenance (+10–15% bulk, about −500 cut)', () => {
    expect(bulk.impliedSurplusPct).toBeGreaterThanOrEqual(10)
    expect(bulk.impliedSurplusPct).toBeLessThanOrEqual(15)
    expect(bulk.warnings).toEqual([])
    expectWithin(bulk.kcalOffset, 300, 10)
    expectWithin(cut.kcalOffset, -500, 10)
    expect(bulk.targetRatePct).toBe(0.375)
    expect(cut.targetRatePct).toBe(-0.625)
  })
})
