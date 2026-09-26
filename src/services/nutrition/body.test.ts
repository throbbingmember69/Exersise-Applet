import { afterEach, describe, expect, it } from 'vitest'
import { addDays, parseLocalDate } from '@/domain/dates'
import { buildTrend } from '@/domain/trend'
import type { LocalDate } from '@/domain/types'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import { SEED_BODY_ENTRY, SEED_DATE, SEED_EPOCH_MS } from '@/seed'
import { createTestCtx } from '../context'

import { isServiceError } from '../errors'
import { restoreBodyEntry, saveScaleReading, saveWeighIn, voidBodyEntry } from './body'

/** 2027-01-01 noon UTC: later than any date these tests write. */
const LATER_THAN_TEST_DATES = Date.UTC(2027, 0, 1, 12)

const ctxs: ReturnType<typeof createTestCtx>[] = []
function ctx(opts?: Parameters<typeof createTestCtx>[0]) {
  // Clock after every test date: entries dated after today are refused.
  const c = createTestCtx({ startMs: LATER_THAN_TEST_DATES, ...opts })
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

const D = (s: string) => parseLocalDate(s)
const noonOf = (date: LocalDate) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 12).getTime()
}

async function expectServiceError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(isServiceError(err, code), `expected ServiceError ${code}, got ${String(err)}`).toBe(true)
}

/** Seven daily weigh-ins around 163 lb starting the day after the seed baseline. */
async function logWeek(c: ReturnType<typeof ctx>, start = addDays(SEED_DATE, 1)) {
  const weights = [163.2, 162.8, 163.4, 163.0, 163.6, 162.9, 163.3]
  for (const [i, w] of weights.entries()) {
    expect(await saveWeighIn(c, { date: addDays(start, i), weightLb: w })).toEqual({
      status: 'saved',
    })
  }
  return addDays(start, weights.length)
}

describe('saveWeighIn', () => {
  it('turns the seed baseline row into a user weigh-in on the same date, keeping its scale fields', async () => {
    const c = ctx()
    c.advance(3_600_000)
    expect(await saveWeighIn(c, { date: SEED_DATE, weightLb: 163.4 })).toEqual({
      status: 'saved',
    })
    const rows = await c.db.bodyEntries.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      ...SEED_BODY_ENTRY,
      weightLb: 163.4,
      source: 'user',
      createdAt: SEED_EPOCH_MS,
      updatedAt: c.now(),
    })
  })

  it('creates one row per date and updates it in place on a later save', async () => {
    const c = ctx()
    const date = D('2026-09-25')
    await saveWeighIn(c, { date, weightLb: 163 })
    const created = await c.db.bodyEntries.get(date)
    c.advance(60_000)
    await saveWeighIn(c, { date, weightLb: 163.5 })
    const updated = await c.db.bodyEntries.get(date)
    expect(await c.db.bodyEntries.count()).toBe(2) // + the seed baseline
    expect(updated).toMatchObject({
      weightLb: 163.5,
      source: 'user',
      bodyFatPct: null,
      createdAt: created?.createdAt,
      updatedAt: c.now(),
      voidedAt: null,
    })
  })

  it('checks the first weigh-in against the seed baseline (it becomes the trend’s start)', async () => {
    const c = ctx()
    // 136.3 typed for 163.6: 16% under the 163 lb baseline → confirm first.
    expect(await saveWeighIn(c, { date: D('2026-09-25'), weightLb: 136.3 })).toMatchObject({
      status: 'needs_confirm',
      trendLb: 163,
    })
    expect(await c.db.bodyEntries.get(D('2026-09-25'))).toBeUndefined()
    // Within 3% of the baseline: saved straight away.
    expect(await saveWeighIn(c, { date: D('2026-09-25'), weightLb: 163.6 })).toEqual({
      status: 'saved',
    })
  })

  it('typo guard: asks to confirm a reading more than 3% from the trend, and saves once confirmed', async () => {
    const c = ctx()
    const next = await logWeek(c)
    const before = await c.db.bodyEntries.count()

    const result = await saveWeighIn(c, { date: next, weightLb: 136.3 }) // meant 163.6
    expect(result.status).toBe('needs_confirm')
    if (result.status !== 'needs_confirm') return
    expect(result.trendLb).toBeGreaterThan(163)
    expect(result.trendLb).toBeLessThan(163.3)
    expect(result.deviationPct).toBeCloseTo(((136.3 - result.trendLb) / result.trendLb) * 100, 9)
    expect(result.deviationPct).toBeLessThan(-16)
    expect(await c.db.bodyEntries.count()).toBe(before) // nothing written

    expect(await saveWeighIn(c, { date: next, weightLb: 136.3, confirmed: true })).toEqual({
      status: 'saved',
    })
    expect((await c.db.bodyEntries.get(next))?.weightLb).toBe(136.3)

    // Correcting the typo compares against the other days' trend, so it saves without asking.
    expect(await saveWeighIn(c, { date: next, weightLb: 163.6 })).toEqual({ status: 'saved' })
  })

  it('saves a reading within 3% of the trend without asking (2.9% above)', async () => {
    const c = ctx()
    const next = await logWeek(c)
    const trend = buildTrend(await c.db.bodyEntries.toArray(), DEFAULT_SETTINGS)
    const last = trend.at(-1)?.trendLb ?? 0
    expect(await saveWeighIn(c, { date: next, weightLb: last * 1.029 })).toEqual({
      status: 'saved',
    })
    expect(await saveWeighIn(c, { date: addDays(next, 1), weightLb: last * 1.04 })).toMatchObject({
      status: 'needs_confirm',
    })
  })

  it('uses the configured deviation threshold', async () => {
    const c = ctx()
    const next = await logWeek(c)
    await c.db.settings.update('singleton', { values: { weighInConfirmDeviationPct: 5 } })
    expect(await saveWeighIn(c, { date: next, weightLb: 163.2 * 1.04 })).toEqual({
      status: 'saved',
    })
  })

  it('rejects implausible weights and bad dates', async () => {
    const c = ctx()
    await expectServiceError(
      saveWeighIn(c, { date: '2026-09-25', weightLb: 49 }),
      'invalid_weightLb',
    )
    await expectServiceError(
      saveWeighIn(c, { date: '2026-09-25', weightLb: 1001 }),
      'invalid_weightLb',
    )
    await expectServiceError(
      saveWeighIn(c, { date: '2026-09-25', weightLb: Number.NaN }),
      'invalid_weightLb',
    )
    await expectServiceError(saveWeighIn(c, { date: '2026-02-30', weightLb: 163 }), 'invalid_date')
    await expectServiceError(saveWeighIn(c, { date: '25/09/2026', weightLb: 163 }), 'invalid_date')
    expect(await c.db.bodyEntries.count()).toBe(1)
  })
})

describe('saveScaleReading', () => {
  it('saves scale fields without a weight and patches them later (omitted kept, null clears)', async () => {
    const c = ctx()
    const date = D('2026-10-01')
    await saveScaleReading(c, { date, bodyFatPct: 15.1, visceralRating: 5, subcutFatPct: 13 })
    expect(await c.db.bodyEntries.get(date)).toMatchObject({
      weightLb: null,
      bodyFatPct: 15.1,
      visceralRating: 5,
      subcutFatPct: 13,
      muscleMassLb: null,
      source: 'user',
    })

    await saveScaleReading(c, { date, muscleMassLb: 133, subcutFatPct: null })
    expect(await c.db.bodyEntries.get(date)).toMatchObject({
      bodyFatPct: 15.1,
      visceralRating: 5,
      subcutFatPct: null,
      muscleMassLb: 133,
    })
  })

  it('keeps the seed baseline out of the trend when only its scale fields are edited', async () => {
    const c = ctx()
    await saveScaleReading(c, { date: SEED_DATE, bodyFatPct: 14.5 })
    const row = await c.db.bodyEntries.get(SEED_DATE)
    expect(row).toMatchObject({ source: 'seed', weightLb: 163, bodyFatPct: 14.5 })
    expect(buildTrend([row!], DEFAULT_SETTINGS)).toEqual([])

    await saveScaleReading(c, { date: SEED_DATE, weightLb: 163.2 })
    expect(await c.db.bodyEntries.get(SEED_DATE)).toMatchObject({
      source: 'user',
      weightLb: 163.2,
      bodyFatPct: 14.5,
    })
  })

  it('applies the typo guard to a weight entered with the scale fields', async () => {
    const c = ctx()
    const next = await logWeek(c)
    expect(await saveScaleReading(c, { date: next, weightLb: 190, bodyFatPct: 15 })).toMatchObject({
      status: 'needs_confirm',
    })
    expect(await c.db.bodyEntries.get(next)).toBeUndefined()
    await saveScaleReading(c, { date: next, weightLb: 190, bodyFatPct: 15, confirmed: true })
    expect(await c.db.bodyEntries.get(next)).toMatchObject({ weightLb: 190, bodyFatPct: 15 })
  })

  it('validates plausible ranges and refuses empty entries', async () => {
    const c = ctx()
    const date = '2026-10-01'
    await expectServiceError(saveScaleReading(c, { date, bodyFatPct: 1.9 }), 'invalid_bodyFatPct')
    await expectServiceError(saveScaleReading(c, { date, bodyFatPct: 71 }), 'invalid_bodyFatPct')
    await expectServiceError(
      saveScaleReading(c, { date, visceralRating: 0 }),
      'invalid_visceralRating',
    )
    await expectServiceError(
      saveScaleReading(c, { date, visceralRating: 61 }),
      'invalid_visceralRating',
    )
    await expectServiceError(
      saveScaleReading(c, { date, skeletalMusclePct: 101 }),
      'invalid_skeletalMusclePct',
    )
    await expectServiceError(
      saveScaleReading(c, { date, subcutFatPct: -1 }),
      'invalid_subcutFatPct',
    )
    await expectServiceError(saveScaleReading(c, { date, weightLb: 20 }), 'invalid_weightLb')
    await expectServiceError(saveScaleReading(c, { date }), 'empty_patch')
    await expectServiceError(saveScaleReading(c, { date, bodyFatPct: null }), 'empty_entry')
    expect(await c.db.bodyEntries.count()).toBe(1)
  })
})

describe('voidBodyEntry / restoreBodyEntry', () => {
  it('voids an entry out of the trend and restores it', async () => {
    const c = ctx()
    await logWeek(c)
    const day = D('2026-09-27')
    c.advance(1000)
    await voidBodyEntry(c, day)
    const voided = await c.db.bodyEntries.get(day)
    expect(voided?.voidedAt).toBe(c.now())
    const trendDates = buildTrend(await c.db.bodyEntries.toArray(), DEFAULT_SETTINGS).map(
      (p) => [p.date, p.interpolated] as const,
    )
    expect(trendDates).toContainEqual([day, true]) // interpolated, not a reading

    await restoreBodyEntry(c, day)
    expect((await c.db.bodyEntries.get(day))?.voidedAt).toBeNull()
    expect((await c.db.bodyEntries.get(day))?.weightLb).toBe(163.4)
  })

  it('re-entering a voided date restores that row and patches it (nothing is lost)', async () => {
    const c = ctx()
    await saveScaleReading(c, { date: '2026-09-25', weightLb: 163, bodyFatPct: 15 })
    await voidBodyEntry(c, '2026-09-25')
    await saveWeighIn(c, { date: '2026-09-25', weightLb: 164 })
    expect(await c.db.bodyEntries.get(D('2026-09-25'))).toMatchObject({
      weightLb: 164,
      bodyFatPct: 15,
      voidedAt: null,
    })
  })

  it('keeps the seed baseline’s body fat through a typo, void and re-entry on the seed date', async () => {
    const c = ctx()
    await saveWeighIn(c, { date: SEED_DATE, weightLb: 136.3, confirmed: true })
    await voidBodyEntry(c, SEED_DATE)
    await saveWeighIn(c, { date: SEED_DATE, weightLb: 163.4 })
    expect(await c.db.bodyEntries.get(SEED_DATE)).toMatchObject({
      weightLb: 163.4,
      bodyFatPct: 14.3,
      voidedAt: null,
    })
  })

  it('reports a missing entry', async () => {
    const c = ctx()
    await expectServiceError(voidBodyEntry(c, '2026-12-01'), 'not_found')
    await expectServiceError(restoreBodyEntry(c, '2026-12-01'), 'not_found')
  })

  it('can void the seed baseline (it then stops being the fallback weight)', async () => {
    const c = ctx({ startMs: noonOf(SEED_DATE) })
    await voidBodyEntry(c, SEED_DATE)
    expect((await c.db.bodyEntries.get(SEED_DATE))?.voidedAt).toBe(c.now())
  })
})
