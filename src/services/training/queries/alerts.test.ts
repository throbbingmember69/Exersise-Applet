import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDate } from '@/domain/types'
import { insertSession } from '../testFixtures'
import { getTrainingAlerts } from './alerts'
import { logDay, sets, testCtxPool, type TestCtx } from './testHelpers'

const pool = testCtxPool()
afterEach(() => pool.cleanup())

const d = (s: string) => s as LocalDate

const STALLS_FINGERPRINT =
  'deload;stalls=ex-incline-db-bench|*,ex-smith-squat|gym-1,ex-weighted-chin-up|*'

/** Four weeks without a gain on the squat, the incline bench and chin-ups: three stalls. */
async function threeStalls(c: TestCtx) {
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'] as const
  for (const [w, monday] of weeks.entries()) {
    const day = (offset: number) => `2026-09-${String(7 + w * 7 + offset).padStart(2, '0')}`
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: monday,
      exercises: [
        { slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat', sets: sets(4, 220, 8) },
      ],
    })
    await insertSession(c, {
      programDayId: 'day-push',
      date: day(1),
      exercises: [
        { slotId: 'slot-push-1', exerciseId: 'ex-incline-db-bench', sets: sets(3, 70, 8) },
      ],
    })
    await insertSession(c, {
      programDayId: 'day-pull',
      date: day(2),
      exercises: [
        { slotId: 'slot-pull-1', exerciseId: 'ex-weighted-chin-up', sets: sets(3, 50, 6) },
      ],
    })
  }
}

describe('getTrainingAlerts', () => {
  it('has nothing to report on first launch', async () => {
    expect(await getTrainingAlerts(pool.make(), { asOf: d('2026-09-28') })).toEqual({
      inProgressSessionId: null,
      stalls: [],
      deload: {
        active: false,
        remaining: 0,
        total: 5,
        suggested: false,
        reasons: [],
        fingerprint: null,
      },
    })
  })

  it('lists stalled lifts, oldest first, and suggests a deload at three', async () => {
    const c = pool.make()
    await threeStalls(c)
    const alerts = await getTrainingAlerts(c, { asOf: d('2026-10-01') })
    for (const stall of alerts.stalls) {
      expect(stall.key.startsWith(`stall;${stall.exerciseId}|${stall.scope};since=`)).toBe(true)
      expect(stall.status).toBeNull()
    }
    expect(alerts.stalls).toMatchObject([
      {
        exerciseId: 'ex-smith-squat',
        name: 'Smith machine squat',
        scope: 'gym-1',
        gymName: 'Gym 1',
        since: '2026-09-14',
      },
      {
        exerciseId: 'ex-incline-db-bench',
        name: 'Incline DB bench press',
        scope: '*',
        gymName: null,
        since: '2026-09-15',
      },
      {
        exerciseId: 'ex-weighted-chin-up',
        name: 'Weighted chin-up',
        scope: '*',
        gymName: null,
        since: '2026-09-16',
      },
    ])
    expect(alerts.deload).toEqual({
      active: false,
      remaining: 0,
      total: 5,
      suggested: true,
      reasons: ['stalls'],
      fingerprint: STALLS_FINGERPRINT,
    })
  })

  it('only uses history up to asOf', async () => {
    const c = pool.make()
    await threeStalls(c)
    // On Tuesday 09-29 the fourth chin-up session hasn't happened: two stalls, no deload.
    const alerts = await getTrainingAlerts(c, { asOf: d('2026-09-29') })
    expect(alerts.stalls.map((s) => s.exerciseId)).toEqual([
      'ex-smith-squat',
      'ex-incline-db-bench',
    ])
    expect(alerts.deload).toMatchObject({ suggested: false, reasons: [], fingerprint: null })
  })

  it('stops suggesting a deload once it is answered, and tracks an accepted one', async () => {
    const c = pool.make()
    await threeStalls(c)
    const respondedAt = Date.UTC(2026, 9, 1, 8)
    await c.db.suggestions.add({
      id: 's1',
      kind: 'deload',
      key: STALLS_FINGERPRINT,
      status: 'dismissed',
      payload: {},
      firstShownAt: respondedAt - 1000,
      respondedAt,
    })
    expect((await getTrainingAlerts(c, { asOf: d('2026-10-01') })).deload).toMatchObject({
      active: false,
      suggested: false,
      fingerprint: STALLS_FINGERPRINT,
    })

    await c.db.suggestions.update('s1', { status: 'accepted' })
    await logDay(c, { programDayId: 'day-lower-b', date: '2026-10-02', isDeload: true })
    const alerts = await getTrainingAlerts(c, { asOf: d('2026-10-02') })
    expect(alerts.deload).toMatchObject({ active: true, remaining: 4, suggested: false })
    // Stalls stay listed; deload sessions don't count toward them.
    expect(alerts.stalls).toHaveLength(3)
  })

  it('points at the session to resume', async () => {
    const c = pool.make()
    const id = await logDay(c, {
      programDayId: 'day-push',
      date: '2026-09-29',
      status: 'in_progress',
    })
    expect((await getTrainingAlerts(c, { asOf: d('2026-09-29') })).inProgressSessionId).toBe(id)
  })
})
