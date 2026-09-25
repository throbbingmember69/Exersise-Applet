import { describe, expect, it } from 'vitest'
import { parseLocalDate } from '@/domain/dates'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { Settings, TargetRevision } from '@/domain/types'
import {
  activeTargetOn,
  applyKcalChange,
  bandMidpoint,
  editProposal,
  kcalOffset,
  macroSplit,
  phaseLength,
  proposePhaseTargets,
  proteinG,
  proteinRule,
  rateBand,
  targetMacros,
} from './nutritionTargets'

const d = parseLocalDate
const s = DEFAULT_SETTINGS

describe('rate bands', () => {
  it('reads each band from settings with min < max numerically', () => {
    expect(rateBand('bulk', s)).toEqual({ minPct: 0.25, maxPct: 0.5 })
    expect(rateBand('cut', s)).toEqual({ minPct: -0.75, maxPct: -0.5 })
    expect(rateBand('maintenance', s)).toEqual({ minPct: -0.25, maxPct: 0.25 })
  })

  it('orders a band entered the other way round', () => {
    const swapped: Settings = { ...s, cutRateMinPct: -0.5, cutRateMaxPct: -1 }
    expect(rateBand('cut', swapped)).toEqual({ minPct: -1, maxPct: -0.5 })
  })

  it('takes the midpoint', () => {
    expect(bandMidpoint(rateBand('bulk', s))).toBe(0.375)
    expect(bandMidpoint(rateBand('cut', s))).toBe(-0.625)
    expect(bandMidpoint(rateBand('maintenance', s))).toBe(0)
  })
})

describe('kcalOffset', () => {
  it('is rate% × trend weight × kcalPerLb / 7', () => {
    expect(kcalOffset(0.375, 163, s)).toBeCloseTo(305.625, 9)
    expect(kcalOffset(-0.625, 163, s)).toBeCloseTo(-509.375, 9)
    expect(kcalOffset(0, 163, s)).toBe(0)
    expect(kcalOffset(0.375, 163, { ...s, kcalPerLb: 3000 })).toBeCloseTo(261.964, 3)
  })
})

describe('protein', () => {
  const mass = { trendLb: 163, leanLb: 139.691 }

  it('uses g/kg bodyweight on a bulk or maintenance and g/kg lean mass on a cut', () => {
    expect(proteinRule('bulk', mass.leanLb, s)).toEqual({ basis: 'bodyweight', gPerKg: 2 })
    expect(proteinRule('maintenance', mass.leanLb, s)).toEqual({ basis: 'bodyweight', gPerKg: 2 })
    expect(proteinRule('cut', mass.leanLb, s)).toEqual({ basis: 'leanMass', gPerKg: 2.7 })
    expect(proteinG('bulk', mass, s)).toBe(150) // 147.9 g
    expect(proteinG('maintenance', mass, s)).toBe(150)
    expect(proteinG('cut', mass, s)).toBe(170) // 171.1 g
  })

  it('falls back to g/kg bodyweight on a cut without body fat', () => {
    expect(proteinRule('cut', null, s)).toEqual({ basis: 'bodyweight_fallback', gPerKg: 2.2 })
    expect(proteinG('cut', { trendLb: 163, leanLb: null }, s)).toBe(165) // 162.7 g
  })

  it('follows the multiplier and rounding settings', () => {
    expect(proteinG('bulk', mass, { ...s, proteinRoundTo: 1 })).toBe(148)
    expect(proteinG('maintenance', mass, { ...s, maintProteinGPerKgBw: 1.6 })).toBe(120)
  })
})

describe('macros', () => {
  it('splits fat from its share of kcal and fills the rest with carbs', () => {
    const bulk = macroSplit(3000, 150, 25)
    expect(bulk.fatG).toBeCloseTo(83.333, 3)
    expect(bulk.carbsG).toBeCloseTo(412.5, 9)
    const cut = macroSplit(2200, 170, 25)
    expect(cut.fatG).toBeCloseTo(61.111, 3)
    expect(cut.carbsG).toBeCloseTo(242.5, 9)
  })

  it('keeps protein grams fixed on a kcal change; fat stays its share of the new kcal', () => {
    const target = { kcal: 3000, proteinG: 150, fatPct: 25 }
    expect(targetMacros(target)).toMatchObject({ kcal: 3000, proteinG: 150, fatPct: 25 })
    const up = applyKcalChange(target, 150)
    expect(up).toMatchObject({ kcal: 3150, proteinG: 150, fatPct: 25 })
    expect(up.fatG).toBeCloseTo(87.5, 9)
    expect(up.carbsG).toBeCloseTo(440.625, 9)
    const down = applyKcalChange(target, -150)
    expect(down.kcal).toBe(2850)
    expect(down.proteinG).toBe(150)
    expect(down.fatG).toBeCloseTo(79.1667, 4)
    expect(down.carbsG).toBeCloseTo(384.375, 9)
  })
})

describe('activeTargetOn', () => {
  const rev = (
    id: string,
    effectiveDate: string,
    createdAt: number,
    kcal: number,
  ): TargetRevision => ({
    id,
    phaseId: 'p1',
    effectiveDate: d(effectiveDate),
    kcal,
    proteinG: 150,
    fatPct: 25,
    source: id === 'start' ? 'phase_start' : 'checkin',
    checkInId: null,
    note: '',
    createdAt,
  })
  const revisions = [
    rev('later', '2026-10-30', 9, 3300),
    rev('start', '2026-10-01', 1, 3000),
    rev('accepted', '2026-10-15', 5, 3150),
    rev('stale-tie', '2026-10-15', 3, 2999),
  ]

  it('returns the latest revision effective on or before the date', () => {
    expect(activeTargetOn(revisions, d('2026-09-30'))).toBeNull()
    expect(activeTargetOn(revisions, d('2026-10-01'))?.id).toBe('start')
    expect(activeTargetOn(revisions, d('2026-10-14'))?.id).toBe('start')
    expect(activeTargetOn(revisions, d('2026-10-29'))?.kcal).toBe(3150)
    expect(activeTargetOn(revisions, d('2026-10-30'))?.id).toBe('later')
    expect(activeTargetOn([], d('2026-10-30'))).toBeNull()
  })

  it('breaks same-day ties by createdAt, then by the last given', () => {
    expect(activeTargetOn(revisions, d('2026-10-15'))?.id).toBe('accepted')
    const tie = [rev('a', '2026-10-15', 5, 1), rev('b', '2026-10-15', 5, 2)]
    expect(activeTargetOn(tie, d('2026-10-15'))?.id).toBe('b')
  })
})

describe('proposePhaseTargets', () => {
  // 200 lb at 20% body fat (160 lb lean), maintenance 2,500.
  const input = {
    maintenanceKcal: 2500,
    maintenanceSource: 'measured' as const,
    trendLb: 200,
    bodyFatPct: 20,
    bfQuality: 'smoothed' as const,
  }

  it('offsets maintenance by the band midpoint and rounds to 50', () => {
    const p = proposePhaseTargets({ ...input, type: 'bulk' }, s)
    expect(p.kcalOffset).toBeCloseTo(375, 9) // 0.375% × 200 × 500
    expect(p.kcal).toBe(2900) // 2,875 rounds half away from zero
    expect(p.proteinG).toBe(180) // 2.0 × 90.7 kg = 181.4
    expect(p).toMatchObject({
      type: 'bulk',
      band: { minPct: 0.25, maxPct: 0.5 },
      targetRatePct: 0.375,
      leanLb: 160,
      proteinBasis: 'bodyweight',
      proteinGPerKg: 2,
      fatPct: 25,
      plannedWeeks: 20,
      maxWeeks: 26,
      bfCeilingPct: 18,
      bfTargetPct: null,
      bfQuality: 'smoothed',
      maintenanceSource: 'measured',
    })
    expect(p.fatG).toBeCloseTo(80.556, 3)
    expect(p.carbsG).toBeCloseTo(363.75, 9)
  })

  it('warns when the implied surplus is above 15%', () => {
    const p = proposePhaseTargets({ ...input, type: 'bulk' }, s)
    expect(p.impliedSurplusPct).toBeCloseTo(16, 9)
    expect(p.warnings).toEqual(['surplus_high'])
    expect(
      proposePhaseTargets({ ...input, type: 'bulk' }, { ...s, surplusWarnPct: 16 }).warnings,
    ).toEqual([])
  })

  it('bases cut protein on lean mass, or bodyweight without body fat', () => {
    const cut = proposePhaseTargets({ ...input, type: 'cut' }, s)
    expect(cut.kcal).toBe(1900) // 2500 − 625 = 1875 → 1900
    expect(cut.impliedSurplusPct).toBeCloseTo(-24, 9)
    expect(cut.warnings).toEqual([])
    expect(cut).toMatchObject({
      proteinBasis: 'leanMass',
      proteinG: 195, // 2.7 × 72.6 kg = 195.9
      plannedWeeks: 14,
      maxWeeks: 16,
      bfCeilingPct: null,
      bfTargetPct: 12,
    })
    const noBf = proposePhaseTargets({ ...input, type: 'cut', bodyFatPct: null }, s)
    expect(noBf).toMatchObject({
      proteinBasis: 'bodyweight_fallback',
      proteinGPerKg: 2.2,
      proteinG: 200, // 2.2 × 90.7 kg = 199.6
      leanLb: null,
      bfQuality: 'none',
    })
  })

  it('keeps maintenance at maintenance, with its own length', () => {
    const p = proposePhaseTargets({ ...input, type: 'maintenance', maintenanceKcal: 2712.6 }, s)
    expect(p).toMatchObject({
      kcal: 2700,
      kcalOffset: 0,
      plannedWeeks: 4,
      maxWeeks: 4,
      bfCeilingPct: null,
      bfTargetPct: null,
    })
  })

  it('accepts a chosen band and target rate', () => {
    const p = proposePhaseTargets(
      { ...input, type: 'bulk', band: { minPct: 0.1, maxPct: 0.3 }, targetRatePct: 0.25 },
      s,
    )
    expect(p.band).toEqual({ minPct: 0.1, maxPct: 0.3 })
    expect(p.targetRatePct).toBe(0.25)
    expect(p.kcal).toBe(2750) // 2500 + 250
  })

  it('flags negative carbs when protein and fat exceed the calories', () => {
    const p = proposePhaseTargets(
      { ...input, type: 'cut', maintenanceKcal: 1200, trendLb: 300, bodyFatPct: null },
      s,
    )
    expect(p.kcal).toBe(250)
    expect(p.carbsG).toBeLessThan(0)
    expect(p.warnings).toEqual(['carbs_negative'])
  })

  it('recomputes macros, surplus and warnings after an edit', () => {
    const p = proposePhaseTargets({ ...input, type: 'bulk' }, s)
    const edited = editProposal(p, { kcal: 2750 }, s)
    expect(edited.kcal).toBe(2750)
    expect(edited.proteinG).toBe(180)
    expect(edited.impliedSurplusPct).toBeCloseTo(10, 9)
    expect(edited.warnings).toEqual([])
    expect(edited.carbsG).toBeCloseTo((2750 - 720 - 687.5) / 4, 9)
    const moreProtein = editProposal(p, { proteinG: 200, fatPct: 20 }, s)
    expect(moreProtein).toMatchObject({ kcal: 2900, proteinG: 200, fatPct: 20 })
    expect(moreProtein.fatG).toBeCloseTo(64.444, 3)
  })
})

describe('phaseLength', () => {
  it('reads the planned and maximum weeks for each phase', () => {
    expect(phaseLength('bulk', s)).toEqual({ plannedWeeks: 20, maxWeeks: 26 })
    expect(phaseLength('cut', s)).toEqual({ plannedWeeks: 14, maxWeeks: 16 })
    expect(phaseLength('maintenance', { ...s, maintWeeks: 3 })).toEqual({
      plannedWeeks: 3,
      maxWeeks: 3,
    })
  })
})
