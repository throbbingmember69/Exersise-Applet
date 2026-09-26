import { afterEach, describe, expect, it } from 'vitest'
import { addDays } from '@/domain/dates'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import { buildTrend, weeklyRatePct } from '@/domain/trend'
import type { LocalDate } from '@/domain/types'
import { SEED_BODY_ENTRY, SEED_DATE } from '@/seed'
import { createTestCtx } from '../context'

import { isServiceError } from '../errors'
import { saveWeighIn, voidBodyEntry } from './body'
import { respondCheckIn, syncCheckIns } from './checkin'
import { saveIntake } from './intake'
import { endPhase, setManualTarget, startPhase } from './phase'
import {
  getBodyView,
  getCheckInView,
  getPhaseHistory,
  getPhaseView,
  getTodayNutrition,
  macroMismatch,
} from './queries'

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

const day = (n: number) => addDays(SEED_DATE, n)
const noonOf = (date: LocalDate) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 12).getTime()
}
const setToday = (c: Ctx, date: LocalDate) => c.setNow(noonOf(date))

async function startBulk(c: Ctx, startDate = SEED_DATE) {
  return startPhase(c, { type: 'bulk', startDate, kcal: 3000, proteinG: 150, fatPct: 25 })
}

describe('getTodayNutrition', () => {
  it('has no target before any phase', async () => {
    const c = ctx()
    await saveIntake(c, { date: SEED_DATE, kcal: 1500 })
    expect(await getTodayNutrition(c, { date: SEED_DATE })).toEqual({
      date: SEED_DATE,
      phase: null,
      weekIndex: null,
      target: null,
      intake: expect.objectContaining({ kcal: 1500 }),
      remaining: null,
      perMealProteinG: null,
      macroMismatch: false,
    })
  })

  it('shows the target, the week, what’s left and the per-meal protein tip (target ÷ 4)', async () => {
    const c = ctx()
    const phaseId = await startBulk(c)
    const date = day(9)
    await saveIntake(c, { date, kcal: 1800, proteinG: 90, carbsG: 250, fatG: 40 })
    const view = await getTodayNutrition(c, { date })
    expect(view.phase?.id).toBe(phaseId)
    expect(view.weekIndex).toBe(2)
    expect(view.target).toMatchObject({
      kcal: 3000,
      proteinG: 150,
      fatPct: 25,
      source: 'phase_start',
      effectiveDate: SEED_DATE,
    })
    expect(view.target?.fatG).toBeCloseTo((3000 * 0.25) / 9, 9)
    expect(view.target?.carbsG).toBeCloseTo(412.5, 9)
    expect(view.remaining?.kcal).toBe(1200)
    expect(view.remaining?.proteinG).toBe(60)
    expect(view.remaining?.carbsG).toBeCloseTo(162.5, 9)
    expect(view.remaining?.fatG).toBeCloseTo((3000 * 0.25) / 9 - 40, 9)
    expect(view.perMealProteinG).toBe(37.5)
    expect(view.macroMismatch).toBe(false) // 4·90 + 4·250 + 9·40 = 1,720 vs 1,800 (4%)
  })

  it('flags logged macros more than 10% off the logged kcal', async () => {
    const c = ctx()
    await startBulk(c)
    await saveIntake(c, { date: day(1), kcal: 1800, proteinG: 90, carbsG: 250, fatG: 20 })
    expect((await getTodayNutrition(c, { date: day(1) })).macroMismatch).toBe(true) // 1,540 (14%)
    // 4·150 + 4·200 + 9·80 = 2,120 vs 2,000 (6%); with 90 g fat it would be 2,210 (10.5%).
    expect(macroMismatch({ kcal: 2000, proteinG: 150, carbsG: 200, fatG: 80 })).toBe(false)
    expect(macroMismatch({ kcal: 2000, proteinG: 150, carbsG: 200, fatG: 90 })).toBe(true)
    expect(macroMismatch({ kcal: 2000, proteinG: 150, carbsG: null, fatG: 90 })).toBe(false)
    expect(macroMismatch({ kcal: 2000, proteinG: 150, carbsG: 150, fatG: 60 })).toBe(true)
  })

  it('uses the phase in effect on the date, including an ended one', async () => {
    const c = ctx()
    const first = await startBulk(c)
    setToday(c, day(140)) // phases start on their start date
    await startPhase(c, {
      type: 'maintenance',
      startDate: day(140),
      kcal: 2750,
      proteinG: 155,
      fatPct: 25,
    })
    expect((await getTodayNutrition(c, { date: day(-1) })).phase).toBeNull()
    const bulkDay = await getTodayNutrition(c, { date: day(139) })
    expect(bulkDay).toMatchObject({ phase: { id: first }, weekIndex: 20, target: { kcal: 3000 } })
    const maintDay = await getTodayNutrition(c, { date: day(140) })
    expect(maintDay).toMatchObject({ phase: { type: 'maintenance' }, weekIndex: 1 })
    expect(maintDay.target?.kcal).toBe(2750)
  })
})

describe('getBodyView', () => {
  it('shows the seed baseline and its body composition before any weigh-in', async () => {
    const c = ctx()
    const view = await getBodyView(c, { asOf: SEED_DATE })
    expect(view).toMatchObject({
      entries: [SEED_BODY_ENTRY],
      voidedEntries: [],
      dailyWeights: [],
      trend: [],
      currentTrend: null,
      sevenDayAvg: null,
      weeklyRatePct: null,
      rateDate: null,
      latestWeight: { date: SEED_DATE, weightLb: 163, source: 'seed' },
    })
    const comp = view.bodyComposition
    expect(comp).toMatchObject({
      weightLb: 163,
      weightSource: 'seed',
      smoothedBodyFat: { pct: 14.3, n: 1, quality: 'single' },
    })
    // The spec's profile table: lean 139.7 lb, fat 23.3 lb, BMI 22.7, FFMI 19.5.
    expect(comp?.leanMassLb).toBeCloseTo(139.7, 1)
    expect(comp?.fatMassLb).toBeCloseTo(23.3, 1)
    expect(comp?.bmi).toBeCloseTo(22.7, 1)
    expect(comp?.ffmi).toBeCloseTo(19.5, 1)
  })

  it('shows entries newest first, the trend, the 7-day average and the weekly rate', async () => {
    const c = ctx()
    const weights = [163, 163.4, 163.2, 163.8, 163.6, 164.0, 164.2, 164.4, 164.1, 164.6]
    for (const [i, w] of weights.entries()) {
      await saveWeighIn(c, { date: day(i + 1), weightLb: w, confirmed: true })
    }
    await voidBodyEntry(c, day(3))
    const asOf = day(10)
    const view = await getBodyView(c, { asOf })

    expect(view.entries.map((e) => e.date)).toEqual(
      [10, 9, 8, 7, 6, 5, 4, 2, 1, 0].map((n) => day(n)),
    )
    expect(view.voidedEntries.map((e) => e.date)).toEqual([day(3)])
    expect(view.dailyWeights.find((d) => d.date === day(3))).toMatchObject({ interpolated: true })
    expect(view.trend).toHaveLength(10)
    expect(view.latestWeight).toEqual({ date: day(10), weightLb: 164.6, source: 'user' })

    const recent = [163.6, 164.0, 164.2, 164.4, 164.1, 164.6] // days 4–10 minus the voided day 3
    const last7 = [163.8, ...recent]
    expect(view.sevenDayAvg).toBeCloseTo(last7.reduce((a, b) => a + b) / 7, 9)
    const trend = buildTrend(await c.db.bodyEntries.toArray(), DEFAULT_SETTINGS)
    expect(view.weeklyRatePct).toBeCloseTo(weeklyRatePct(trend, asOf) ?? Number.NaN, 12)
    expect(view.weeklyRatePct).toBeGreaterThan(0)
    expect(view.rateDate).toBe(asOf)
    expect(view.bodyComposition?.weightSource).toBe('trend')
    expect(view.bodyComposition?.weightLb).toBeCloseTo(trend.at(-1)?.trendLb ?? 0, 12)

    // Without today's weigh-in the rate stays at the latest trend day and the trend is stale.
    const tomorrow = await getBodyView(c, { asOf: day(11) })
    expect(tomorrow.rateDate).toBe(day(10))
    expect(tomorrow.currentTrend?.stale).toBe(true)
  })

  it('limits the chart window to the last N days and needs 3 readings for the 7-day average', async () => {
    const c = ctx()
    await saveWeighIn(c, { date: day(1), weightLb: 163 })
    await saveWeighIn(c, { date: day(5), weightLb: 163.5 })
    const view = await getBodyView(c, { asOf: day(5), days: 3 })
    expect(view.from).toBe(day(3))
    expect(view.entries.map((e) => e.date)).toEqual([day(5)])
    expect(view.dailyWeights.map((d) => d.date)).toEqual([day(3), day(4), day(5)])
    expect(view.sevenDayAvg).toBeNull()
    const err = await getBodyView(c, { asOf: day(5), days: 0 }).catch((e: unknown) => e)
    expect(isServiceError(err, 'invalid_days')).toBe(true)
  })
})

describe('getCheckInView', () => {
  it('is empty without a phase', async () => {
    const c = ctx()
    expect(await getCheckInView(c, { asOf: SEED_DATE })).toEqual({
      phase: null,
      pending: null,
      history: [],
    })
  })

  it('shows the pending check-in and answered history', async () => {
    const c = ctx()
    await startBulk(c)
    setToday(c, day(7))
    const { pending } = await syncCheckIns(c, { asOf: day(7) })
    const view = await getCheckInView(c, { asOf: day(7) })
    expect(view.pending?.checkIn.id).toBe(pending?.id)
    expect(view.pending?.currentTarget?.kcal).toBe(3000)
    expect(view.pending?.proposedTarget).toBeNull() // no change in week 1
    expect(view.pending?.stepsTarget).toBeNull()
    expect(view.history).toEqual([])
    await respondCheckIn(c, pending!.id, { action: 'skip' })
    const after = await getCheckInView(c, { asOf: day(7) })
    expect(after.pending).toBeNull()
    expect(after.history.map((r) => [r.phaseWeekIndex, r.status])).toEqual([[1, 'skipped']])
  })
})

describe('getPhaseView', () => {
  it('suggests starting a lean bulk and shows the formula maintenance when no phase exists', async () => {
    const c = ctx()
    const view = await getPhaseView(c, { asOf: SEED_DATE })
    expect(view).toMatchObject({
      phase: null,
      weekIndex: null,
      completedWeeks: null,
      target: null,
      targets: [],
      prompt: null,
      suggestedNextType: 'bulk',
    })
    expect(view.maintenance.atStart).toBeNull()
    expect(view.maintenance.measured).toBeNull()
    expect(view.maintenance.formula?.kcal).toBeCloseTo(2712.6, 1)
    expect(view.maintenance.current).toMatchObject({ source: 'formula', capped: false })
    expect(view.maintenance.current?.kcal).toBeCloseTo(2712.6, 1)
  })

  it('shows progress, the target history and the next phase for the active phase', async () => {
    const c = ctx()
    const phaseId = await startBulk(c)
    setToday(c, day(16))
    await setManualTarget(c, { effectiveDate: day(17), kcal: 3100 })
    const view = await getPhaseView(c, { asOf: day(17) })
    expect(view).toMatchObject({
      phase: { id: phaseId, type: 'bulk' },
      weekIndex: 3,
      completedWeeks: 2,
      plannedWeeks: 20,
      maxWeeks: 26,
      target: { kcal: 3100, source: 'manual' },
      suggestedNextType: 'maintenance',
      maintenance: { atStart: { source: 'formula' } },
    })
    expect(view.targets.map((t) => [t.effectiveDate, t.kcal, t.source])).toEqual([
      [SEED_DATE, 3000, 'phase_start'],
      [day(17), 3100, 'manual'],
    ])
  })
})

describe('getPhaseHistory', () => {
  it('lists phases newest first with their first and latest targets', async () => {
    const c = ctx()
    const bulk = await startBulk(c)
    setToday(c, day(30))
    await setManualTarget(c, { effectiveDate: day(30), kcal: 3150 })
    setToday(c, day(140)) // phases start on their start date
    const maint = await startPhase(c, {
      type: 'maintenance',
      startDate: day(140),
      kcal: 2700,
      proteinG: 150,
      fatPct: 25,
    })
    setToday(c, day(167)) // a phase is ended on (or after) its end date
    await endPhase(c, { date: day(167), reason: 'done' })
    const history = await getPhaseHistory(c)
    expect(history.map((h) => h.phase.id)).toEqual([maint, bulk])
    expect(history[0]).toMatchObject({
      lengthWeeks: 4,
      startTarget: { kcal: 2700 },
      latestTarget: { kcal: 2700 },
      checkIns: 0,
    })
    expect(history[1]).toMatchObject({
      lengthWeeks: 20,
      startTarget: { kcal: 3000, source: 'phase_start' },
      latestTarget: { kcal: 3150, source: 'manual' },
      acceptedChanges: 0,
    })
  })
})
