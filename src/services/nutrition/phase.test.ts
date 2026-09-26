import { afterEach, describe, expect, it } from 'vitest'
import { addDays, parseLocalDate } from '@/domain/dates'
import { roundToStep } from '@/domain/rounding'
import type { BodyEntry, LocalDate, NutritionEntry, PhaseType } from '@/domain/types'
import { SEED_DATE } from '@/seed'
import { createTestCtx } from '../context'

import { isServiceError } from '../errors'
import { syncCheckIns } from './checkin'
import { endPhase, proposePhase, setManualTarget, startPhase } from './phase'
import { getTodayNutrition } from './queries'

/** 2027-01-01 noon UTC: later than any date these tests write. */
const LATER_THAN_TEST_DATES = Date.UTC(2027, 0, 1, 12)

const ctxs: ReturnType<typeof createTestCtx>[] = []
function ctx() {
  // Clock after every test date: entries dated after today are refused.
  const c = createTestCtx({ startMs: LATER_THAN_TEST_DATES })
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})
type Ctx = ReturnType<typeof ctx>

const D = (s: string) => parseLocalDate(s)
const noonOf = (date: LocalDate) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 12).getTime()
}
const setToday = (c: Ctx, date: LocalDate) => c.setNow(noonOf(date))

async function expectServiceError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(isServiceError(err, code), `expected ServiceError ${code}, got ${String(err)}`).toBe(true)
}

function weighIn(date: LocalDate, weightLb: number): BodyEntry {
  return {
    date,
    weightLb,
    bodyFatPct: null,
    muscleMassLb: null,
    skeletalMusclePct: null,
    subcutFatPct: null,
    visceralRating: null,
    source: 'user',
    note: '',
    createdAt: 0,
    updatedAt: 0,
    voidedAt: null,
  }
}

function intake(date: LocalDate, kcal: number): NutritionEntry {
  return { date, kcal, proteinG: null, carbsG: null, fatG: null, steps: null, updatedAt: 0 }
}

/** Log `days` consecutive days of weigh-ins and intake starting on `from`. */
async function logDays(c: Ctx, from: LocalDate, days: number, weightLb: number, kcal: number) {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i))
  await c.db.bodyEntries.bulkPut(dates.map((d) => weighIn(d, weightLb)))
  await c.db.nutritionEntries.bulkPut(dates.map((d) => intake(d, kcal)))
}

async function start(c: Ctx, type: PhaseType, startDate: LocalDate, extra = {}) {
  // A phase is started on (or after) its start date: never a future-dated start.
  if (c.now() < noonOf(startDate)) setToday(c, startDate)
  const view = await proposePhase(c, { type, startDate })
  const { kcal, proteinG, fatPct } = view.proposal
  const id = await startPhase(c, {
    type,
    startDate,
    kcal,
    proteinG,
    fatPct,
    proposal: view.proposal,
    ...extra,
  })
  return { id, view }
}

describe('proposePhase on the seed database (spec acceptance)', () => {
  it('seed targets: maintenance ≈ 2,700, bulk 3,000, cut 2,200 kcal (±50); protein 150 / 150 / 170 g (±5), exact with default rounding', async () => {
    const c = ctx()
    const bulk = await proposePhase(c, { type: 'bulk', startDate: SEED_DATE })
    const maint = await proposePhase(c, { type: 'maintenance', startDate: SEED_DATE })
    const cut = await proposePhase(c, { type: 'cut', startDate: SEED_DATE })

    expect(Math.abs(bulk.maintenance.kcal - 2700)).toBeLessThanOrEqual(50)
    expect(roundToStep(bulk.maintenance.kcal, 50)).toBe(2700)
    expect(bulk.maintenance.source).toBe('formula')

    const kcal = [bulk.proposal.kcal, maint.proposal.kcal, cut.proposal.kcal]
    const protein = [bulk.proposal.proteinG, maint.proposal.proteinG, cut.proposal.proteinG]
    for (const [actual, expected] of [
      [kcal[0], 3000],
      [kcal[1], 2700],
      [kcal[2], 2200],
    ] as const) {
      expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(50)
    }
    for (const [actual, expected] of [
      [protein[0], 150],
      [protein[1], 150],
      [protein[2], 170],
    ] as const) {
      expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(5)
    }
    expect(kcal).toEqual([3000, 2700, 2200])
    expect(protein).toEqual([150, 150, 170])
  })

  it('uses the seed baseline weight, its single body-fat reading and age 22', async () => {
    const c = ctx()
    const view = await proposePhase(c, { type: 'bulk', startDate: SEED_DATE })
    expect(view).toMatchObject({
      startDate: SEED_DATE,
      trendLb: 163,
      weightSource: 'seed',
      bodyFat: { pct: 14.3, n: 1, quality: 'single' },
      age: 22,
      previousPhase: null,
      suggestedType: 'bulk',
    })
    expect(view.leanLb).toBeCloseTo(163 * (1 - 0.143), 9)
    expect(view.maintenance.kcal).toBeCloseTo(2712.6, 1)
    expect(view.proposal).toMatchObject({
      type: 'bulk',
      band: { minPct: 0.25, maxPct: 0.5 },
      targetRatePct: 0.375,
      proteinBasis: 'bodyweight',
      plannedWeeks: 20,
      maxWeeks: 26,
      bfCeilingPct: 18,
      bfTargetPct: null,
      warnings: [],
    })
    expect(view.proposal.fatG).toBeCloseTo((3000 * 0.25) / 9, 9)
    expect(view.proposal.carbsG).toBeCloseTo(412.5, 9)
  })

  it('uses trend weight once real weigh-ins exist', async () => {
    const c = ctx()
    await logDays(c, D('2026-09-25'), 3, 170, 2500)
    const view = await proposePhase(c, { type: 'maintenance', startDate: D('2026-09-27') })
    expect(view.trendLb).toBe(170)
    expect(view.weightSource).toBe('trend')
    expect(view.maintenance.source).toBe('formula')
  })

  it('rejects an unknown type or a bad date', async () => {
    const c = ctx()
    await expectServiceError(
      proposePhase(c, { type: 'recomp' as PhaseType, startDate: SEED_DATE }),
      'invalid_type',
    )
    await expectServiceError(proposePhase(c, { type: 'bulk', startDate: 'soon' }), 'invalid_date')
  })

  it('needs some bodyweight', async () => {
    const c = ctx()
    await c.db.bodyEntries.clear()
    await expectServiceError(
      proposePhase(c, { type: 'bulk', startDate: SEED_DATE }),
      'no_bodyweight',
    )
  })
})

describe('measured maintenance', () => {
  it('replaces the formula once enough days are logged (≥14-day window with ≥80% of days logged)', async () => {
    const c = ctx()
    const first = D('2026-09-25')
    await logDays(c, first, 14, 163, 2500)

    // After 11 logged days no 14-day window reaches 80%: formula (the seed numbers).
    const early = await proposePhase(c, { type: 'bulk', startDate: addDays(first, 10) })
    expect(early.maintenance.source).toBe('formula')
    expect(early.maintenance.kcal).toBeCloseTo(2712.6, 1)
    expect(early.proposal.kcal).toBe(3000)

    // After 14 logged days: mean intake 2,500 with a flat trend → measured 2,500.
    const later = await proposePhase(c, { type: 'bulk', startDate: addDays(first, 14) })
    expect(later.maintenance).toEqual({ kcal: 2500, source: 'measured' })
    expect(later.proposal.maintenanceSource).toBe('measured')
    expect(later.proposal.kcal).toBe(2800) // 2,500 + 305.6 → 2,805.6 → 2,800
    const cut = await proposePhase(c, { type: 'cut', startDate: addDays(first, 14) })
    expect(cut.proposal.kcal).toBe(2000) // 2,500 − 509.4 → 1,990.6 → 2,000
  })
})

describe('startPhase', () => {
  it('writes the Phase and a phase_start target revision effective on the start date', async () => {
    const c = ctx()
    const { id, view } = await start(c, 'bulk', SEED_DATE)
    const phase = await c.db.phases.get(id)
    expect(phase).toEqual({
      id,
      type: 'bulk',
      startDate: SEED_DATE,
      endDate: null,
      status: 'active',
      prevPhaseId: null,
      parentPhaseId: null,
      rateMinPct: 0.25,
      rateMaxPct: 0.5,
      targetRatePct: 0.375,
      maintenanceKcalAtStart: view.maintenance.kcal,
      maintenanceSource: 'formula',
      trendWeightLbAtStart: 163,
      bodyFatPctAtStart: 14.3,
      bfQuality: 'single',
      leanMassLbAtStart: view.leanLb,
      proteinBasis: 'bodyweight',
      proteinGPerKg: 2,
      fatPct: 25,
      bfCeilingPct: 18,
      bfTargetPct: null,
      plannedWeeks: 20,
      maxWeeks: 26,
      endReason: null,
      createdAt: c.now(),
    })
    const revisions = await c.db.targetRevisions.toArray()
    expect(revisions).toEqual([
      {
        id: expect.any(String),
        phaseId: id,
        effectiveDate: SEED_DATE,
        kcal: 3000,
        proteinG: 150,
        fatPct: 25,
        source: 'phase_start',
        checkInId: null,
        note: '',
        createdAt: c.now(),
      },
    ])
  })

  it('stores a cut band in numeric order (−0.75 < −0.5) and the cut’s thresholds', async () => {
    const c = ctx()
    const { id } = await start(c, 'cut', SEED_DATE, { rateMinPct: -0.5, rateMaxPct: -0.75 })
    expect(await c.db.phases.get(id)).toMatchObject({
      rateMinPct: -0.75,
      rateMaxPct: -0.5,
      targetRatePct: -0.625,
      proteinBasis: 'leanMass',
      proteinGPerKg: 2.7,
      bfCeilingPct: null,
      bfTargetPct: 12,
      plannedWeeks: 14,
      maxWeeks: 16,
    })
  })

  it('accepts edited targets, band, lengths and thresholds', async () => {
    const c = ctx()
    const id = await startPhase(c, {
      type: 'bulk',
      startDate: SEED_DATE,
      kcal: 3100,
      proteinG: 160,
      fatPct: 30,
      rateMinPct: 0.2,
      rateMaxPct: 0.4,
      plannedWeeks: 16,
      maxWeeks: 20,
      bfCeilingPct: 17,
    })
    expect(await c.db.phases.get(id)).toMatchObject({
      rateMinPct: 0.2,
      rateMaxPct: 0.4,
      fatPct: 30,
      plannedWeeks: 16,
      maxWeeks: 20,
      bfCeilingPct: 17,
      maintenanceSource: 'formula',
      trendWeightLbAtStart: 163,
    })
    expect((await c.db.phases.get(id))?.targetRatePct).toBeCloseTo(0.3, 12)
    expect(await c.db.targetRevisions.toArray()).toMatchObject([
      { kcal: 3100, proteinG: 160, fatPct: 30 },
    ])
  })

  it('ends the active phase the day before, atomically, and links the new one to it', async () => {
    const c = ctx()
    const { id: bulkId } = await start(c, 'bulk', SEED_DATE)
    const next = addDays(SEED_DATE, 140)
    const { id: maintId, view } = await start(c, 'maintenance', next, { endReason: 'bf_ceiling' })
    expect(view.previousPhase?.id).toBe(bulkId)
    expect(view.suggestedType).toBe('maintenance')
    expect(await c.db.phases.get(bulkId)).toMatchObject({
      status: 'ended',
      endDate: addDays(next, -1),
      endReason: 'bf_ceiling',
    })
    expect(await c.db.phases.get(maintId)).toMatchObject({
      status: 'active',
      prevPhaseId: bulkId,
      startDate: next,
    })
    const active = (await c.db.phases.toArray()).filter((p) => p.status === 'active')
    expect(active.map((p) => p.id)).toEqual([maintId])
    expect(await c.db.targetRevisions.count()).toBe(2)
  })

  it('turns the ended phase’s pending check-in into history', async () => {
    const c = ctx()
    await logDays(c, SEED_DATE, 10, 163, 3000)
    const { id: bulkId } = await start(c, 'bulk', SEED_DATE)
    setToday(c, addDays(SEED_DATE, 7))
    const { pending } = await syncCheckIns(c, { asOf: addDays(SEED_DATE, 7) })
    expect(pending?.phaseId).toBe(bulkId)
    await start(c, 'maintenance', addDays(SEED_DATE, 9))
    expect((await c.db.checkIns.get(pending!.id))?.status).toBe('backfilled')
  })

  it('suggests the next phase from the flowchart: bulk → maintenance → cut → maintenance → bulk', async () => {
    const c = ctx()
    const s0 = SEED_DATE
    await start(c, 'bulk', s0)
    await start(c, 'maintenance', addDays(s0, 140))
    expect(
      (await proposePhase(c, { type: 'cut', startDate: addDays(s0, 168) })).suggestedType,
    ).toBe('cut')
    await start(c, 'cut', addDays(s0, 168))
    expect(
      (await proposePhase(c, { type: 'maintenance', startDate: addDays(s0, 266) })).suggestedType,
    ).toBe('maintenance')
    await start(c, 'maintenance', addDays(s0, 266))
    expect(
      (await proposePhase(c, { type: 'bulk', startDate: addDays(s0, 294) })).suggestedType,
    ).toBe('bulk')
  })

  it('refuses overlapping phases', async () => {
    const c = ctx()
    await start(c, 'bulk', D('2026-10-01'))
    const input = { type: 'maintenance', kcal: 2700, proteinG: 150, fatPct: 25 } as const
    // The bulk's own start revision (10-01) bounds the next start: 10-02 at the earliest.
    await expectServiceError(
      startPhase(c, { ...input, startDate: '2026-10-01' }),
      'invalid_start_date',
    )
    await expectServiceError(
      startPhase(c, { ...input, startDate: '2026-09-30' }),
      'invalid_start_date',
    )
    await endPhase(c, { date: '2026-10-20', reason: 'done' })
    await expectServiceError(startPhase(c, { ...input, startDate: '2026-10-20' }), 'phase_overlap')
    await startPhase(c, { ...input, startDate: '2026-10-21' })
    expect(await c.db.phases.count()).toBe(2)
  })

  it('validates targets before writing anything', async () => {
    const c = ctx()
    const base = {
      type: 'bulk',
      startDate: SEED_DATE,
      kcal: 3000,
      proteinG: 150,
      fatPct: 25,
    } as const
    await expectServiceError(startPhase(c, { ...base, kcal: 100 }), 'invalid_kcal')
    await expectServiceError(startPhase(c, { ...base, proteinG: -1 }), 'invalid_proteinG')
    await expectServiceError(startPhase(c, { ...base, fatPct: 101 }), 'invalid_fatPct')
    await expectServiceError(
      startPhase(c, { ...base, kcal: 1000, proteinG: 200, fatPct: 40 }),
      'macros_exceed_kcal',
    )
    await expectServiceError(
      startPhase(c, { ...base, plannedWeeks: 30, maxWeeks: 26 }),
      'invalid_length',
    )
    await expectServiceError(startPhase(c, { ...base, plannedWeeks: 2.5 }), 'invalid_plannedWeeks')
    await expectServiceError(startPhase(c, { ...base, bfCeilingPct: 90 }), 'invalid_bfCeilingPct')
    await expectServiceError(startPhase(c, { ...base, type: 'lean' as PhaseType }), 'invalid_type')
    expect(await c.db.phases.count()).toBe(0)
    expect(await c.db.targetRevisions.count()).toBe(0)
  })
})

describe('endPhase', () => {
  it('ends the active phase on the given day', async () => {
    const c = ctx()
    const { id } = await start(c, 'bulk', SEED_DATE)
    await endPhase(c, { date: addDays(SEED_DATE, 30), reason: 'illness' })
    expect(await c.db.phases.get(id)).toMatchObject({
      status: 'ended',
      endDate: addDays(SEED_DATE, 30),
      endReason: 'illness',
    })
    await expectServiceError(
      endPhase(c, { date: addDays(SEED_DATE, 31), reason: 'x' }),
      'no_active_phase',
    )
  })

  it('validates the date and reason', async () => {
    const c = ctx()
    await start(c, 'bulk', SEED_DATE)
    await expectServiceError(
      endPhase(c, { date: addDays(SEED_DATE, -1), reason: 'oops' }),
      'end_before_start',
    )
    await expectServiceError(endPhase(c, { date: SEED_DATE, reason: '  ' }), 'invalid_reason')
    await expectServiceError(endPhase(c, { date: 'never', reason: 'x' }), 'invalid_date')
  })
})

describe('setManualTarget', () => {
  it('appends a manual revision that applies from its effective date; omitted fields carry over', async () => {
    const c = ctx()
    const { id: phaseId } = await start(c, 'bulk', SEED_DATE)
    setToday(c, addDays(SEED_DATE, 10))
    const revId = await setManualTarget(c, {
      effectiveDate: addDays(SEED_DATE, 11),
      kcal: 3200,
      note: ' more carbs ',
    })
    expect(await c.db.targetRevisions.get(revId)).toMatchObject({
      phaseId,
      effectiveDate: addDays(SEED_DATE, 11),
      kcal: 3200,
      proteinG: 150,
      fatPct: 25,
      source: 'manual',
      checkInId: null,
      note: 'more carbs',
      createdAt: c.now(),
    })
    const before = await getTodayNutrition(c, { date: addDays(SEED_DATE, 10) })
    const after = await getTodayNutrition(c, { date: addDays(SEED_DATE, 11) })
    expect(before.target?.kcal).toBe(3000)
    expect(after.target).toMatchObject({ kcal: 3200, proteinG: 150, source: 'manual' })
    expect(await c.db.phases.count()).toBe(1)
  })

  it('refuses past dates, missing phases, empty and impossible changes', async () => {
    const c = ctx()
    setToday(c, SEED_DATE)
    await expectServiceError(
      setManualTarget(c, { effectiveDate: SEED_DATE, kcal: 2800 }),
      'no_active_phase',
    )
    // Phases start on their start date (never future-dated), so today is the phase start here
    // and any earlier effective date is in the past.
    await start(c, 'bulk', addDays(SEED_DATE, 2))
    await expectServiceError(
      setManualTarget(c, { effectiveDate: addDays(SEED_DATE, -1), kcal: 2800 }),
      'effective_in_past',
    )
    await expectServiceError(
      setManualTarget(c, { effectiveDate: addDays(SEED_DATE, 1), kcal: 2800 }),
      'effective_in_past',
    )
    await expectServiceError(
      setManualTarget(c, { effectiveDate: addDays(SEED_DATE, 3) }),
      'empty_patch',
    )
    await expectServiceError(
      setManualTarget(c, { effectiveDate: addDays(SEED_DATE, 3), proteinG: 900 }),
      'macros_exceed_kcal',
    )
    expect(await c.db.targetRevisions.count()).toBe(1)
  })
})
