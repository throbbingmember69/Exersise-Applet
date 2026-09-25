import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDate } from '@/domain/types'
import { insertSession } from '../testFixtures'
import { getExerciseProgress, getProgressOverview } from './progress'
import { sets, testCtxPool, type TestCtx } from './testHelpers'

const pool = testCtxPool()
afterEach(() => pool.cleanup())

const d = (s: string) => s as LocalDate
const e1rm = (load: number, reps: number) => load * (1 + reps / 30)

/**
 * Four weeks of history:
 * - chin-ups stall (no gain in the last 3 sessions), the last at a lighter bodyweight, plus a
 *   deload session that doesn't count;
 * - Smith squat (e1RM) and leg extension (reps-at-load, 10–15) keep improving on Lower A;
 * - machine fly at two gyms, starting with a calibration session at Gym 1.
 */
async function fourWeeks(c: TestCtx) {
  await c.db.gyms.add({ id: 'gym-2', name: 'Home', sortOrder: 1, archivedAt: null, createdAt: 0 })
  const chin = (date: string, reps: number, extra: { bodyweightLb?: number } = {}) =>
    insertSession(c, {
      programDayId: 'day-pull',
      date,
      ...extra,
      exercises: [
        { slotId: 'slot-pull-1', exerciseId: 'ex-weighted-chin-up', sets: sets(3, 50, reps) },
      ],
    })
  await chin('2026-09-02', 6)
  await chin('2026-09-09', 6)
  await chin('2026-09-16', 5)
  await chin('2026-09-23', 6, { bodyweightLb: 160 })
  await insertSession(c, {
    programDayId: 'day-pull',
    date: '2026-09-26',
    isDeload: true,
    exercises: [{ slotId: 'slot-pull-1', exerciseId: 'ex-weighted-chin-up', sets: sets(2, 45, 8) }],
  })
  const lowerA: [date: string, squat: [number, number], legExt: [number, number]][] = [
    ['2026-09-01', [220, 8], [170, 12]],
    ['2026-09-08', [220, 9], [170, 13]],
    ['2026-09-15', [220, 10], [170, 15]],
    ['2026-09-22', [230, 8], [175, 10]],
  ]
  for (const [date, squat, legExt] of lowerA) {
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date,
      exercises: [
        { slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat', sets: sets(4, ...squat) },
        { slotId: 'slot-lower-a-2', exerciseId: 'ex-leg-extension', sets: sets(3, ...legExt) },
      ],
    })
  }
  const fly = (date: string, gymId: string, load: number, reps: number, isCalibration = false) =>
    insertSession(c, {
      programDayId: 'day-push',
      gymId,
      date,
      exercises: [
        {
          slotId: 'slot-push-3',
          exerciseId: 'ex-machine-fly',
          sets: sets(2, load, reps),
          isCalibration,
        },
      ],
    })
  await fly('2026-09-03', 'gym-1', 205, 15, true)
  await fly('2026-09-10', 'gym-1', 205, 12)
  await fly('2026-09-24', 'gym-2', 150, 12)
}

describe('getProgressOverview', () => {
  it('lists each series with latest, best and 4-week change, stalled first', async () => {
    const c = pool.make()
    await fourWeeks(c)
    const items = await getProgressOverview(c, { asOf: d('2026-09-30') })
    expect(items.map((i) => [i.name, i.gymName, i.kind, i.stalled, i.sessions])).toEqual([
      ['Weighted chin-up', null, 'e1rm', true, 4],
      ['Smith machine squat', 'Gym 1', 'e1rm', false, 4],
      ['Leg extension', 'Gym 1', 'repsAtLoad', false, 4],
      ['Machine fly', 'Gym 1', 'repsAtLoad', false, 1],
      ['Machine fly', 'Home', 'repsAtLoad', false, 1],
    ])

    const [chin, squat, legExt, flyGym1] = items
    // Chin-up e1RM uses bodyweight + added load: (160 + 50) × 1.2 = 252 on the latest session,
    // shown as the added-load equivalent 252 − 160 = 92.
    expect(chin!.latest.date).toBe('2026-09-23')
    expect(chin!.latest.value).toMatchObject({ kind: 'e1rm' })
    expect(chin!.latest.value.kind === 'e1rm' && chin!.latest.value.totalLb).toBeCloseTo(252, 9)
    expect(chin!.latest.value.kind === 'e1rm' && chin!.latest.value.displayLb).toBeCloseTo(92, 9)
    expect(chin!.best.date).toBe('2026-09-02')
    // Bodyweight loss alone: −1.4%, well under the 5% strength-slide trigger.
    expect(chin!.changeVs4WeeksAgo).toMatchObject({
      kind: 'e1rm',
      since: '2026-09-02',
      direction: 'down',
    })
    const chinChange = chin!.changeVs4WeeksAgo!
    expect(chinChange.kind === 'e1rm' && chinChange.pct).toBeCloseTo((252 / 255.6 - 1) * 100, 9)
    expect(chinChange.kind === 'e1rm' && chinChange.deltaLb).toBeCloseTo(92 - 92.6, 9)

    expect(squat).toMatchObject({ isMainLift: true, scope: 'gym-1' })
    expect(squat!.best.date).toBe('2026-09-15')
    expect(squat!.best.value.kind === 'e1rm' && squat!.best.value.totalLb).toBeCloseTo(
      e1rm(220, 10),
      9,
    )
    const squatChange = squat!.changeVs4WeeksAgo!
    expect(squatChange).toMatchObject({ kind: 'e1rm', since: '2026-09-01', direction: 'up' })
    expect(squatChange.kind === 'e1rm' && squatChange.pct).toBeCloseTo((230 / 220 - 1) * 100, 9)

    // Reps-at-load: a heavier load beats more reps at a lighter one.
    expect(legExt).toMatchObject({
      latest: { date: '2026-09-22', value: { kind: 'repsAtLoad', loadLb: 175, reps: 10 } },
      best: { date: '2026-09-22', value: { kind: 'repsAtLoad', loadLb: 175, reps: 10 } },
      changeVs4WeeksAgo: {
        kind: 'repsAtLoad',
        since: '2026-09-01',
        direction: 'up',
        loadDeltaLb: 5,
        repsDelta: -2,
      },
    })
    // The calibration session doesn't count; nothing is 4 weeks old yet.
    expect(flyGym1).toMatchObject({
      latest: { date: '2026-09-10', value: { loadLb: 205, reps: 12 } },
      changeVs4WeeksAgo: null,
    })
  })

  it('only uses history up to asOf', async () => {
    const c = pool.make()
    await fourWeeks(c)
    const items = await getProgressOverview(c, { asOf: d('2026-09-10') })
    expect(items.map((i) => [i.name, i.gymName, i.stalled, i.sessions])).toEqual([
      ['Smith machine squat', 'Gym 1', false, 2],
      ['Weighted chin-up', null, false, 2],
      ['Leg extension', 'Gym 1', false, 2],
      ['Machine fly', 'Gym 1', false, 1],
    ])
    expect(items.every((i) => i.changeVs4WeeksAgo === null)).toBe(true)
  })

  it('is empty without history', async () => {
    expect(await getProgressOverview(pool.make(), { asOf: d('2026-09-30') })).toEqual([])
  })
})

describe('getExerciseProgress', () => {
  it('charts chin-ups as the added-load equivalent with the total alongside', async () => {
    const c = pool.make()
    await fourWeeks(c)
    const progress = await getExerciseProgress(c, 'ex-weighted-chin-up')
    expect(progress).toMatchObject({
      exerciseId: 'ex-weighted-chin-up',
      name: 'Weighted chin-up',
      kind: 'e1rm',
      loadType: 'bodyweight_plus',
      perHand: false,
      isMainLift: true,
      isBodyweightPlus: true,
    })
    expect(progress!.series).toHaveLength(1)
    const [series] = progress!.series
    expect(series).toMatchObject({
      scope: '*',
      gymName: null,
      stall: { stalled: true, since: '2026-09-09' },
    })
    // The deload session is left out.
    expect(series!.points.map((p) => p.date)).toEqual([
      '2026-09-02',
      '2026-09-09',
      '2026-09-16',
      '2026-09-23',
    ])
    const expected = [
      [163, 6],
      [163, 6],
      [163, 5],
      [160, 6],
    ] as const
    series!.points.forEach((p, i) => {
      const [bw, reps] = expected[i]!
      expect(p.totalLb).toBeCloseTo(e1rm(bw + 50, reps), 9)
      expect(p.value as number).toBeCloseTo(e1rm(bw + 50, reps) - bw, 9)
    })
  })

  it('splits machine series by gym and shows reps at load', async () => {
    const c = pool.make()
    await fourWeeks(c)
    const progress = await getExerciseProgress(c, 'ex-machine-fly')
    expect(progress).toMatchObject({ kind: 'repsAtLoad', isBodyweightPlus: false })
    expect(progress!.series).toEqual([
      {
        scope: 'gym-1',
        gymName: 'Gym 1',
        points: [
          {
            sessionId: expect.any(String),
            date: '2026-09-10',
            value: { loadLb: 205, reps: 12 },
            totalLb: null,
          },
        ],
        stall: { stalled: false, since: null },
      },
      {
        scope: 'gym-2',
        gymName: 'Home',
        points: [
          {
            sessionId: expect.any(String),
            date: '2026-09-24',
            value: { loadLb: 150, reps: 12 },
            totalLb: null,
          },
        ],
        stall: { stalled: false, since: null },
      },
    ])
  })

  it('shows e1RM points for a regular lift and handles no history or a missing exercise', async () => {
    const c = pool.make()
    await fourWeeks(c)
    const squat = await getExerciseProgress(c, 'ex-smith-squat')
    expect(squat!.series[0]!.points.map((p) => p.value)).toEqual([
      e1rm(220, 8),
      e1rm(220, 9),
      e1rm(220, 10),
      e1rm(230, 8),
    ])
    expect(await getExerciseProgress(c, 'ex-deadlift')).toMatchObject({ series: [] })
    expect(await getExerciseProgress(c, 'missing')).toBeNull()
  })
})
