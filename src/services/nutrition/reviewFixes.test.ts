// Regression tests for the M2 review findings on the nutrition services (nutrition #1–#13; see
// docs/DESIGN.md lead notes). Each reproduces the reviewer's failing scenario.
import { afterEach, describe, expect, it } from 'vitest'
import { addDays, parseLocalDate } from '@/domain/dates'
import type { BodyEntry, CheckIn, LocalDate, PhaseType } from '@/domain/types'
import { createTestCtx } from '../context'
import { isServiceError } from '../errors'
import { saveWeighIn } from './body'
import { respondCheckIn, respondSwitchPrompt, syncCheckIns } from './checkin'
import { saveIntake } from './intake'
import { endPhase, proposePhase, setManualTarget, startPhase } from './phase'

type Ctx = ReturnType<typeof createTestCtx>
const ctxs: Ctx[] = []
function ctx(): Ctx {
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

const S = parseLocalDate('2026-10-05') // phase start (a Monday)
const day = (n: number) => addDays(S, n)
const noonOf = (date: LocalDate) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 12).getTime()
}
const setToday = (c: Ctx, date: LocalDate) => c.setNow(noonOf(date))

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(isServiceError(err, code), `expected ServiceError ${code}, got ${String(err)}`).toBe(true)
}

function entry(
  date: LocalDate,
  weightLb: number | null,
  bodyFatPct: number | null = null,
): BodyEntry {
  return {
    date,
    weightLb,
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
  }
}

async function logWeights(c: Ctx, from: LocalDate, days: number, weight: (i: number) => number) {
  await c.db.bodyEntries.bulkPut(
    Array.from({ length: days }, (_, i) => entry(addDays(from, i), weight(i))),
  )
}

const TARGETS: Record<PhaseType, { kcal: number; proteinG: number; fatPct: number }> = {
  bulk: { kcal: 3000, proteinG: 150, fatPct: 25 },
  maintenance: { kcal: 2700, proteinG: 150, fatPct: 25 },
  cut: { kcal: 2200, proteinG: 170, fatPct: 25 },
}

/** Start a phase on its start date (the clock is moved there). */
async function start(c: Ctx, type: PhaseType, startDate = S, extra: Record<string, unknown> = {}) {
  setToday(c, startDate)
  return startPhase(c, { type, startDate, ...TARGETS[type], ...extra })
}

/** A bulk gaining far too fast (≈ +1.1 %/week): weeks 2 and 3 both miss high. */
async function fastBulk(c: Ctx, extra: Record<string, unknown> = {}) {
  await logWeights(c, day(-14), 14 + 7 * 7 + 1, (i) => 160 + 0.3 * i)
  return start(c, 'bulk', S, extra)
}

async function sync(c: Ctx, asOf: LocalDate) {
  setToday(c, asOf)
  return syncCheckIns(c, { asOf })
}

async function rows(c: Ctx): Promise<CheckIn[]> {
  return (await c.db.checkIns.toArray()).sort((a, b) => a.phaseWeekIndex - b.phaseWeekIndex)
}

describe('phase dates', () => {
  it('#1: a new phase cannot start before the current phase’s answered history', async () => {
    const c = ctx()
    await start(c, 'bulk')
    setToday(c, day(10))
    await setManualTarget(c, { effectiveDate: day(10), kcal: 3100 })
    setToday(c, day(30))
    await expectCode(
      startPhase(c, { type: 'maintenance', startDate: day(5), ...TARGETS.maintenance }),
      'invalid_start_date',
    )
    await expectCode(endPhase(c, { date: day(5), reason: 'oops' }), 'invalid_end_date')
    // After the latest target change it's allowed, and past days keep their targets.
    await startPhase(c, { type: 'maintenance', startDate: day(11), ...TARGETS.maintenance })
    expect((await c.db.phases.toArray()).map((p) => p.status).sort()).toEqual(['active', 'ended'])
  })

  it('#5: no future-dated phase starts or ends', async () => {
    const c = ctx()
    await start(c, 'bulk')
    setToday(c, day(18))
    await expectCode(
      startPhase(c, { type: 'maintenance', startDate: day(30), ...TARGETS.maintenance }),
      'future_date',
    )
    await expectCode(endPhase(c, { date: day(40), reason: 'later' }), 'future_date')
    expect((await c.db.phases.toArray()).map((p) => p.status)).toEqual(['active'])
  })
})

describe('check-ins', () => {
  it('#2: a weigh-in dated after the due date doesn’t change that week’s evaluation', async () => {
    const c = ctx()
    // Weigh-ins through day 18 only; none on days 19–21.
    await logWeights(c, day(-14), 14 + 19, (i) => 160 + 0.3 * i)
    await start(c, 'bulk')
    await sync(c, day(21))
    const before = (await rows(c)).find((r) => r.phaseWeekIndex === 3)!
    await c.db.bodyEntries.put(entry(day(22), 172))
    await sync(c, day(22))
    const after = (await rows(c)).find((r) => r.phaseWeekIndex === 3)!
    expect(after.status).toBe('pending')
    for (const k of ['trendRatePct', 'trendWeightLb', 'suggestionType', 'missDirection'] as const) {
      expect(after[k], k).toEqual(before[k])
    }
  })

  it('#3: accepting a suggestion made stale by a manual target change is refused', async () => {
    const c = ctx()
    await fastBulk(c)
    const { pending } = await sync(c, day(21))
    expect(pending).toMatchObject({ suggestionType: 'kcal_change', suggestedKcalChange: -150 })
    await setManualTarget(c, { effectiveDate: day(21), kcal: 2800 })
    await expectCode(respondCheckIn(c, pending!.id, { action: 'accept' }), 'stale_checkin')
    const revisions = await c.db.targetRevisions.toArray()
    expect(revisions.map((r) => r.kcal)).toEqual([3000, 2800])
  })

  it('#4: a target change can’t be undercut by an earlier-dated one', async () => {
    const c = ctx()
    await fastBulk(c)
    const { pending } = await sync(c, day(21))
    await respondCheckIn(c, pending!.id, { action: 'accept' }) // effective day 22
    await expectCode(
      setManualTarget(c, { effectiveDate: day(21), kcal: 3200 }),
      'later_target_exists',
    )
    await expect(setManualTarget(c, { effectiveDate: day(22), kcal: 3200 })).resolves.toBeTypeOf(
      'string',
    )
  })

  it('#8: a dismissed soft prompt doesn’t hide a later firm prompt on the same week', async () => {
    const c = ctx()
    await logWeights(c, day(-14), 40, () => 163)
    await start(c, 'bulk', S, { plannedWeeks: 2 })
    const { pending } = await sync(c, day(14))
    expect(pending?.switchPrompt).toMatchObject({ severity: 'soft', reasons: ['planned_length'] })
    await respondSwitchPrompt(c, pending!.id, 'dismissed')
    await c.db.bodyEntries.update(day(7), { bodyFatPct: 19 })
    await c.db.bodyEntries.update(day(14), { bodyFatPct: 19.2 })
    const again = await sync(c, day(14))
    expect(again.pending?.switchPrompt).toMatchObject({ severity: 'firm' })
    expect(again.pending?.switchPrompt?.reasons).toContain('bf_ceiling')
    expect(again.pending?.switchResponse).toBeNull()
  })

  it('#11: syncing with a future as-of date is treated as today', async () => {
    const c = ctx()
    await fastBulk(c)
    setToday(c, day(21))
    const { pending } = await syncCheckIns(c, { asOf: day(28) })
    expect(pending?.phaseWeekIndex).toBe(3)
    expect((await rows(c)).map((r) => r.phaseWeekIndex)).toEqual([1, 2, 3])
  })
})

describe('entries', () => {
  it('#12: refuses future-dated entries and implausible kcal', async () => {
    const c = ctx()
    setToday(c, S)
    await expectCode(saveWeighIn(c, { date: '2027-10-05', weightLb: 163.2 }), 'future_date')
    await expectCode(saveIntake(c, { date: day(1), kcal: 3000 }), 'future_date')
    await expectCode(saveIntake(c, { date: S, kcal: 30000 }), 'implausible_kcal')
    await expect(saveIntake(c, { date: S, kcal: 3000 })).resolves.not.toThrow()
  })
})

describe('phase proposals', () => {
  it('#13: an edited rate band and target rate flow into the proposal and the stored phase', async () => {
    const c = ctx()
    setToday(c, S)
    const view = await proposePhase(c, {
      type: 'bulk',
      startDate: S,
      rateMinPct: 0.2,
      rateMaxPct: 0.4,
      targetRatePct: 0.3,
    })
    expect(view.proposal.targetRatePct).toBeCloseTo(0.3, 12)
    const midpoint = await proposePhase(c, { type: 'bulk', startDate: S })
    expect(view.proposal.kcal).toBeLessThanOrEqual(midpoint.proposal.kcal)
    const { kcal, proteinG, fatPct } = view.proposal
    const id = await startPhase(c, {
      type: 'bulk',
      startDate: S,
      kcal,
      proteinG,
      fatPct,
      rateMinPct: 0.2,
      rateMaxPct: 0.4,
      proposal: view.proposal,
    })
    expect(await c.db.phases.get(id)).toMatchObject({ rateMinPct: 0.2, rateMaxPct: 0.4 })
    expect((await c.db.phases.get(id))?.targetRatePct).toBeCloseTo(0.3, 12)
  })
})
