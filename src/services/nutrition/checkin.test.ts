import { afterEach, describe, expect, it } from 'vitest'
import { addDays, parseLocalDate } from '@/domain/dates'
import type { BodyEntry, CheckIn, LocalDate, NutritionEntry, PhaseType } from '@/domain/types'
import { createTestCtx } from '../context'
import { isServiceError } from '../errors'
import { insertSession } from '../training/testFixtures'
import { respondCheckIn, respondSwitchPrompt, syncCheckIns } from './checkin'
import { proposePhase, setManualTarget, startPhase } from './phase'
import { getCheckInView, getPhaseView, getTodayNutrition } from './queries'

const ctxs: ReturnType<typeof createTestCtx>[] = []
function ctx() {
  const c = createTestCtx()
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
/** Phase start used throughout: a Monday after the seed date. */
const S = D('2026-10-05')
const day = (n: number) => addDays(S, n)
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

/** Daily weigh-ins from `from` for `days` days: `weight(i)` on day i. */
async function logWeights(c: Ctx, from: LocalDate, days: number, weight: (i: number) => number) {
  await c.db.bodyEntries.bulkPut(
    Array.from({ length: days }, (_, i) => weighIn(addDays(from, i), weight(i))),
  )
}

async function logIntake(
  c: Ctx,
  from: LocalDate,
  days: number,
  kcal: number,
  steps: number | null = null,
) {
  const rows: NutritionEntry[] = Array.from({ length: days }, (_, i) => ({
    date: addDays(from, i),
    kcal,
    proteinG: null,
    carbsG: null,
    fatG: null,
    steps,
    updatedAt: 0,
  }))
  await c.db.nutritionEntries.bulkPut(rows)
}

const TARGETS: Record<PhaseType, { kcal: number; proteinG: number; fatPct: number }> = {
  bulk: { kcal: 3000, proteinG: 150, fatPct: 25 },
  maintenance: { kcal: 2700, proteinG: 150, fatPct: 25 },
  cut: { kcal: 2200, proteinG: 170, fatPct: 25 },
}

async function start(c: Ctx, type: PhaseType, extra: Record<string, unknown> = {}) {
  return startPhase(c, { type, startDate: S, ...TARGETS[type], ...extra })
}

/**
 * A bulk gaining far too fast: weigh-ins rise 0.3 lb/day from two weeks before the start (about
 * +1.1%/week on the trend by week 1, well above the +0.5% ceiling), for `weeks` weeks.
 */
async function fastBulk(c: Ctx, weeks = 7, extra: Record<string, unknown> = {}) {
  await logWeights(c, day(-14), 14 + 7 * weeks + 1, (i) => 160 + 0.3 * i)
  return start(c, 'bulk', extra)
}

async function sync(c: Ctx, asOf: LocalDate) {
  setToday(c, asOf)
  return syncCheckIns(c, { asOf })
}

async function rows(c: Ctx): Promise<CheckIn[]> {
  return (await c.db.checkIns.toArray()).sort((a, b) => a.phaseWeekIndex - b.phaseWeekIndex)
}

describe('first week of a phase (spec acceptance)', () => {
  it('suggests no calorie change in week 1 even when the trend is outside the band', async () => {
    const c = ctx()
    const phaseId = await fastBulk(c)
    const { pending, created } = await sync(c, day(7))
    expect(created).toBe(1)
    expect(pending).toMatchObject({
      phaseId,
      phaseWeekIndex: 1,
      dueDate: day(7),
      status: 'pending',
      bandMinPct: 0.25,
      bandMaxPct: 0.5,
      missDirection: 'high',
      missStreak: 0,
      suggestionType: 'none_first_week',
      suggestedKcalChange: 0,
      stepsAlternative: null,
      appliedKcalChange: null,
      switchPrompt: null,
    })
    expect(pending?.trendRatePct).toBeGreaterThan(0.5)
  })

  it('also holds for a cut losing far too fast', async () => {
    const c = ctx()
    await logWeights(c, day(-14), 30, (i) => 170 - 0.4 * i)
    await start(c, 'cut')
    const { pending } = await sync(c, day(7))
    expect(pending?.trendRatePct).toBeLessThan(-0.75)
    expect(pending).toMatchObject({
      missDirection: 'low',
      suggestionType: 'none_first_week',
      suggestedKcalChange: 0,
    })
  })
})

describe('miss streak and suggestions', () => {
  it('two same-direction misses → a calorie change, accepted as a TargetRevision effective tomorrow', async () => {
    const c = ctx()
    const phaseId = await fastBulk(c)
    const { pending } = await sync(c, day(21))
    const all = await rows(c)
    expect(all.map((r) => [r.phaseWeekIndex, r.status, r.missStreak, r.suggestionType])).toEqual([
      [1, 'backfilled', 0, 'none_first_week'],
      [2, 'backfilled', 1, 'none_streak'],
      [3, 'pending', 2, 'kcal_change'],
    ])
    expect(pending).toMatchObject({
      phaseWeekIndex: 3,
      missDirection: 'high',
      suggestedKcalChange: -150,
      stepsAlternative: null,
    })

    const view = await getCheckInView(c, { asOf: day(21) })
    expect(view.pending?.currentTarget?.kcal).toBe(3000)
    expect(view.pending?.proposedTarget).toMatchObject({ kcal: 2850, proteinG: 150, fatPct: 25 })

    c.advance(60_000)
    const result = await respondCheckIn(c, pending!.id, { action: 'accept' })
    expect(result.status).toBe('accepted')
    const revision = await c.db.targetRevisions.get(result.revisionId!)
    expect(revision).toEqual({
      id: result.revisionId,
      phaseId,
      effectiveDate: day(22),
      kcal: 2850,
      proteinG: 150,
      fatPct: 25,
      source: 'checkin',
      checkInId: pending!.id,
      note: '',
      createdAt: c.now(),
    })
    expect(await c.db.checkIns.get(pending!.id)).toMatchObject({
      status: 'accepted',
      appliedKcalChange: -150,
      respondedAt: c.now(),
    })

    // Protein grams stay fixed; fat stays 25% of the new kcal; carbs fill the rest.
    expect((await getTodayNutrition(c, { date: day(21) })).target?.kcal).toBe(3000)
    const tomorrow = (await getTodayNutrition(c, { date: day(22) })).target
    expect(tomorrow).toMatchObject({ kcal: 2850, proteinG: 150, source: 'checkin' })
    expect(tomorrow?.fatG).toBeCloseTo((2850 * 0.25) / 9, 9)
    expect(tomorrow?.carbsG).toBeCloseTo((2850 - 600 - 712.5) / 4, 9)
  })

  it('skip keeps the streak: the next week suggests a change again', async () => {
    const c = ctx()
    await fastBulk(c)
    const { pending } = await sync(c, day(21))
    expect(await respondCheckIn(c, pending!.id, { action: 'skip' })).toEqual({
      status: 'skipped',
      revisionId: null,
    })
    expect(await c.db.targetRevisions.count()).toBe(1)
    const next = (await sync(c, day(28))).pending
    expect(next).toMatchObject({
      phaseWeekIndex: 4,
      missStreak: 3,
      suggestionType: 'kcal_change',
      suggestedKcalChange: -150,
    })
  })

  it('accept resets the streak: two fresh misses are needed before the next change', async () => {
    const c = ctx()
    await fastBulk(c)
    const week3 = (await sync(c, day(21))).pending!
    await respondCheckIn(c, week3.id, { action: 'accept' })

    const week4 = (await sync(c, day(28))).pending!
    expect(week4).toMatchObject({
      phaseWeekIndex: 4,
      missDirection: 'high',
      missStreak: 1,
      suggestionType: 'none_streak',
      suggestedKcalChange: 0,
    })
    await expectServiceError(respondCheckIn(c, week4.id, { action: 'accept' }), 'no_suggestion')
    await respondCheckIn(c, week4.id, { action: 'skip' })

    const week5 = (await sync(c, day(35))).pending!
    expect(week5).toMatchObject({ missStreak: 2, suggestionType: 'kcal_change' })
    const { revisionId } = await respondCheckIn(c, week5.id, { action: 'accept' })
    expect(await c.db.targetRevisions.get(revisionId!)).toMatchObject({
      kcal: 2700, // 2,850 − 150: changes stack on the target in effect
      effectiveDate: day(36),
    })
  })

  it('a manual target change also resets the streak', async () => {
    const c = ctx()
    await fastBulk(c)
    const week3 = (await sync(c, day(21))).pending!
    await respondCheckIn(c, week3.id, { action: 'skip' })
    setToday(c, day(22))
    await setManualTarget(c, { effectiveDate: day(22), kcal: 2900 })
    expect((await sync(c, day(28))).pending).toMatchObject({
      missStreak: 1,
      suggestionType: 'none_streak',
    })
  })

  it('custom amounts are applied as given; invalid answers are refused', async () => {
    const c = ctx()
    await fastBulk(c)
    const pending = (await sync(c, day(21))).pending!
    await expectServiceError(
      respondCheckIn(c, pending.id, { action: 'custom' }),
      'invalid_kcalChange',
    )
    await expectServiceError(
      respondCheckIn(c, pending.id, { action: 'custom', kcalChange: 0 }),
      'invalid_kcalChange',
    )
    await expectServiceError(
      respondCheckIn(c, pending.id, { action: 'shrug' as 'skip' }),
      'invalid_action',
    )
    await expectServiceError(
      respondCheckIn(c, pending.id, { action: 'accept_steps' }),
      'no_steps_alternative',
    )
    await expectServiceError(respondCheckIn(c, 'nope', { action: 'skip' }), 'not_found')

    const { revisionId } = await respondCheckIn(c, pending.id, {
      action: 'custom',
      kcalChange: -100,
    })
    expect(await c.db.targetRevisions.get(revisionId!)).toMatchObject({ kcal: 2900 })
    expect(await c.db.checkIns.get(pending.id)).toMatchObject({
      status: 'accepted',
      appliedKcalChange: -100,
    })
    await expectServiceError(respondCheckIn(c, pending.id, { action: 'skip' }), 'not_pending')
  })
})

describe('a cut losing too slowly', () => {
  it('offers extra steps instead of calories; choosing them resets the streak without a target change', async () => {
    const c = ctx()
    await logWeights(c, day(-14), 50, () => 163)
    await logIntake(c, day(8), 14, 2200, 8000)
    await start(c, 'cut')
    const pending = (await sync(c, day(21))).pending!
    expect(pending).toMatchObject({
      missDirection: 'high',
      missStreak: 2,
      suggestionType: 'kcal_change',
      suggestedKcalChange: -150,
      stepsAlternative: 2000,
    })
    expect((await getCheckInView(c, { asOf: day(21) })).pending?.stepsTarget).toBe(10000)

    expect(await respondCheckIn(c, pending.id, { action: 'accept_steps' })).toEqual({
      status: 'accepted_steps',
      revisionId: null,
    })
    expect(await c.db.checkIns.get(pending.id)).toMatchObject({
      status: 'accepted_steps',
      appliedKcalChange: null,
    })
    expect(await c.db.targetRevisions.count()).toBe(1)
    expect((await sync(c, day(28))).pending).toMatchObject({
      missStreak: 1,
      suggestionType: 'none_streak',
    })
  })
})

describe('backfilled vs pending', () => {
  it('only the latest due week is pending; missed weeks are backfilled history', async () => {
    const c = ctx()
    await fastBulk(c)
    await sync(c, day(21))
    const [w1, w2, w3] = await rows(c)
    expect([w1?.status, w2?.status, w3?.status]).toEqual(['backfilled', 'backfilled', 'pending'])
    await expectServiceError(respondCheckIn(c, w1!.id, { action: 'skip' }), 'not_pending')

    const view = await getCheckInView(c, { asOf: day(21) })
    expect(view.pending?.checkIn.id).toBe(w3!.id)
    expect(view.pending?.trend.at(-1)?.date).toBe(day(21))
    expect(view.pending?.trend[0]?.date).toBe(day(1))
    expect(view.history.map((r) => r.phaseWeekIndex)).toEqual([2, 1])

    // Unanswered: a week later it becomes history and the new week is pending.
    const { pending, created, updated } = await sync(c, day(28))
    expect([created, updated]).toEqual([1, 1])
    expect(pending?.phaseWeekIndex).toBe(4)
    expect((await c.db.checkIns.get(w3!.id))?.status).toBe('backfilled')
    await expectServiceError(respondCheckIn(c, w3!.id, { action: 'skip' }), 'not_pending')

    // Answering without a refresh after another week has come due is refused.
    setToday(c, day(35))
    await expectServiceError(respondCheckIn(c, pending!.id, { action: 'skip' }), 'checkin_outdated')
  })

  it('re-evaluates the pending row when data changes and freezes answered rows', async () => {
    const c = ctx()
    await fastBulk(c)
    const first = await sync(c, day(7))
    expect(first.pending?.intakeLoggedPct).toBe(0)
    expect((await sync(c, day(7))).updated).toBe(0) // nothing changed → no write

    await logIntake(c, day(1), 7, 3000)
    c.advance(1000)
    const again = await sync(c, day(7))
    expect(again.updated).toBe(1)
    expect(again.pending?.id).toBe(first.pending?.id)
    expect(again.pending).toMatchObject({ intakeLoggedPct: 100, evaluatedAt: c.now() })

    await respondCheckIn(c, again.pending!.id, { action: 'skip' })
    await c.db.nutritionEntries.clear()
    expect((await sync(c, day(7))).updated).toBe(0)
    expect((await c.db.checkIns.get(again.pending!.id))?.intakeLoggedPct).toBe(100)
  })

  it('does nothing without an active phase or before the first due date', async () => {
    const c = ctx()
    expect(await sync(c, day(7))).toEqual({ phaseId: null, pending: null, created: 0, updated: 0 })
    const phaseId = await fastBulk(c)
    expect(await sync(c, day(6))).toEqual({ phaseId, pending: null, created: 0, updated: 0 })
    expect(await c.db.checkIns.count()).toBe(0)
  })
})

describe('maintenance estimate at check-ins', () => {
  it('uses the formula until a measured window exists, then the measured value (capped week over week)', async () => {
    const c = ctx()
    await logWeights(c, day(-7), 50, () => 163)
    await logIntake(c, day(0), 22, 3000)
    await logIntake(c, day(22), 7, 3500)
    await start(c, 'bulk')
    await sync(c, day(28))
    const [w1, w2, w3, w4] = await rows(c)
    expect(w1).toMatchObject({ tdeeSource: 'formula', tdeeCapped: false })
    expect(w1?.tdeeEstimate).toBeCloseTo(2712.6, 1)
    expect(w2).toMatchObject({ tdeeSource: 'formula' })
    // Week 3: the first window starting a week after the phase start: measured 3,000, uncapped.
    expect(w3).toMatchObject({ tdeeSource: 'measured', tdeeEstimate: 3000, tdeeCapped: false })
    expect(w3).toMatchObject({ intakeLoggedPct: 100, weighInLoggedPct: 100 })
    // Week 4: 21-day mean 3,166.7 → capped at +150 over the previous estimate.
    expect(w4).toMatchObject({ tdeeSource: 'measured', tdeeEstimate: 3150, tdeeCapped: true })

    // The next phase starts from the measured estimate instead of the formula.
    const next = await proposePhase(c, { type: 'maintenance', startDate: day(29) })
    expect(next.maintenance.source).toBe('measured')
    expect(next.maintenance.kcal).toBeCloseTo(3175, 9) // 20 logged days: (13×3,000 + 7×3,500) / 20
    expect(next.proposal.kcal).toBe(3200)
  })
})

describe('phase-switch prompts', () => {
  it('raises a soft prompt at the planned length and a firm one at the maximum', async () => {
    const c = ctx()
    await fastBulk(c, 4, { plannedWeeks: 2, maxWeeks: 3 })
    const week2 = (await sync(c, day(14))).pending!
    expect(week2.switchPrompt).toEqual({
      kind: 'end_bulk',
      severity: 'soft',
      reasons: ['planned_length'],
      suggestedNext: 'maintenance',
    })
    expect((await getPhaseView(c, { asOf: day(14) })).prompt).toMatchObject({
      checkInId: week2.id,
      severity: 'soft',
      response: null,
    })
    await respondSwitchPrompt(c, week2.id, 'dismissed')
    expect((await getPhaseView(c, { asOf: day(14) })).prompt).toBeNull()
    await expectServiceError(respondSwitchPrompt(c, week2.id, 'plan_next'), 'already_responded')

    const week3 = (await sync(c, day(21))).pending!
    expect(week3.switchPrompt).toMatchObject({ severity: 'firm', reasons: ['max_length'] })
    await respondSwitchPrompt(c, week3.id, 'plan_next')
    expect((await getPhaseView(c, { asOf: day(21) })).prompt).toMatchObject({
      checkInId: week3.id,
      severity: 'firm',
      response: 'plan_next',
    })

    const week1 = (await rows(c))[0]!
    await expectServiceError(respondSwitchPrompt(c, week1.id, 'dismissed'), 'no_prompt')
    await expectServiceError(
      respondSwitchPrompt(c, week3.id, 'maybe' as 'dismissed'),
      'invalid_response',
    )
  })

  it('prompts to end a cut when main-lift e1RMs slide more than 5% over 3 weeks', async () => {
    const c = ctx()
    await logWeights(c, day(-14), 50, (i) => 170 - 0.2 * i)
    await start(c, 'cut')
    const deadlift = (load: number) =>
      [
        [load, 8],
        [load, 8],
      ] as [number, number][]
    await insertSession(c, {
      programDayId: null,
      date: day(2),
      exercises: [{ exerciseId: 'ex-deadlift', sets: deadlift(315) }],
    })
    await insertSession(c, {
      programDayId: null,
      date: day(26),
      exercises: [{ exerciseId: 'ex-deadlift', sets: deadlift(250) }],
    })
    await sync(c, day(28))
    const [, , w3, w4] = await rows(c)
    expect(w3?.switchPrompt).toBeNull()
    expect(w4?.switchPrompt).toEqual({
      kind: 'end_cut',
      severity: 'firm',
      reasons: ['strength_slide'],
      suggestedNext: 'maintenance',
    })
  })
})
