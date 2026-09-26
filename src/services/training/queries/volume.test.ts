import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDate } from '@/domain/types'
import { updateSettings } from '../../settings'
import { getVolumeDashboard } from './volume'
import { logDay, sets, testCtxPool, type TestCtx } from './testHelpers'

const pool = testCtxPool()
afterEach(() => pool.cleanup())

const d = (s: string) => s as LocalDate

/** The spec's "Weekly totals for the revised plan", in seed muscle order (plus traps). */
const SPEC_WEEKLY_TOTALS: [string, number][] = [
  ['quads', 13.5],
  ['hamstrings', 9],
  ['glutes', 10],
  ['calves', 6],
  ['abs', 5],
  ['chest', 14],
  ['front_delts', 8.5],
  ['side_delts', 8.5],
  ['rear_delts', 8],
  ['back', 11],
  ['biceps', 13.5],
  ['triceps', 16],
  ['traps', 0],
]

/** Flags against a complete week: hamstrings, side and rear delts are "just under"; front
 *  delts, calves, abs and traps are exempt from "low". */
const SPEC_FLAGS = ['ok', 'low', 'ok', null, null, 'ok', null, 'low', 'low', 'ok', 'ok', 'ok', null]

/** One full seed week, Mon 2026-09-28 to Sat 10-03, with warm-ups before every exercise. */
async function logSeedWeek(c: TestCtx) {
  const ids: string[] = []
  for (const [programDayId, date] of [
    ['day-lower-a', '2026-09-28'],
    ['day-push', '2026-09-29'],
    ['day-pull', '2026-09-30'],
    ['day-lower-b', '2026-10-02'],
    ['day-upper', '2026-10-03'],
  ] as const) {
    ids.push(await logDay(c, { programDayId, date, warmups: true }))
  }
  return ids
}

describe('getVolumeDashboard: planned', () => {
  it('matches the spec’s weekly totals for the seed program (94 sets)', async () => {
    const c = pool.make()
    const dash = await getVolumeDashboard(c, { weekOf: d('2026-09-30'), today: d('2026-09-30') })
    expect(dash.muscles.map((m) => [m.muscleId, m.planned])).toEqual(SPEC_WEEKLY_TOTALS)
    expect(dash.muscles.map((m) => m.plannedFlag)).toEqual(SPEC_FLAGS)
    expect(dash.planned).toEqual({ totalSets: 94, capWarnings: [] })
    expect(dash).toMatchObject({ gymId: 'gym-1', gymName: 'Gym 1', sessionCap: 11 })
    expect(dash.muscles[0]).toEqual({
      muscleId: 'quads',
      name: 'Quads',
      bandMin: 10,
      bandMax: 20,
      exemptLow: false,
      planned: 13.5,
      plannedFlag: 'ok',
      logged: 0,
      loggedFlag: null,
    })
    expect(dash.muscles.filter((m) => m.exemptLow).map((m) => m.muscleId)).toEqual([
      'calves',
      'abs',
      'front_delts',
      'traps',
    ])
  })

  it('resolves the plan at the chosen gym, defaulting to the last gym used', async () => {
    const c = pool.make()
    await c.db.gyms.add({ id: 'gym-2', name: 'Home', sortOrder: 1, archivedAt: null, createdAt: 0 })
    // Home has no flat press machine: the slot uses the machine fly (chest only) there.
    await c.db.gymSlotOverrides.add({
      id: 'o1',
      gymId: 'gym-2',
      slotId: 'slot-push-2',
      exerciseId: 'ex-machine-fly',
    })
    const planned = (dash: Awaited<ReturnType<typeof getVolumeDashboard>>) =>
      Object.fromEntries(dash.muscles.map((m) => [m.muscleId, m.planned]))

    const home = await getVolumeDashboard(c, {
      weekOf: d('2026-09-30'),
      today: d('2026-09-30'),
      gymId: 'gym-2',
    })
    expect(home.gymName).toBe('Home')
    expect(planned(home)).toMatchObject({ chest: 14, front_delts: 7, triceps: 14.5 })
    expect(home.planned.totalSets).toBe(94)
    expect(
      planned(await getVolumeDashboard(c, { weekOf: d('2026-09-30'), today: d('2026-09-30') })),
    ).toMatchObject({
      front_delts: 8.5,
      triceps: 16,
    })
    await c.db.appState.put({ key: 'lastGymId', value: 'gym-2' })
    const byDefault = await getVolumeDashboard(c, {
      weekOf: d('2026-09-30'),
      today: d('2026-09-30'),
    })
    expect(byDefault.gymId).toBe('gym-2')
    expect(planned(byDefault)).toMatchObject({ front_delts: 7, triceps: 14.5 })
  })

  it('warns when a program day plans a muscle over the session cap', async () => {
    const c = pool.make()
    // 6 sets of the overhead triceps extension: Push triceps 9.5 → 12.5.
    await c.db.programSlots.update('slot-push-6', { sets: 6 })
    const dash = await getVolumeDashboard(c, { weekOf: d('2026-09-30'), today: d('2026-09-30') })
    expect(dash.planned).toEqual({
      totalSets: 97,
      capWarnings: [
        {
          programDayId: 'day-push',
          dayName: 'Push',
          muscles: [{ muscleId: 'triceps', name: 'Triceps', sets: 12.5 }],
        },
      ],
    })
    expect(dash.muscles.find((m) => m.muscleId === 'triceps')).toMatchObject({
      planned: 19,
      plannedFlag: 'ok',
    })
  })
})

describe('getVolumeDashboard: logged', () => {
  it('counts a fully logged week like the plan, ignoring warm-ups, voided and abandoned sessions', async () => {
    const c = pool.make()
    // The week before doesn't count.
    await logDay(c, { programDayId: 'day-upper', date: '2026-09-26' })
    const ids = await logSeedWeek(c)
    await logDay(c, { programDayId: 'day-push', date: '2026-10-01', voided: true })
    await logDay(c, { programDayId: 'day-lower-a', date: '2026-10-01', status: 'abandoned' })

    const dash = await getVolumeDashboard(c, { weekOf: d('2026-10-04'), today: d('2026-10-05') })
    expect(dash.week).toEqual({
      start: '2026-09-28',
      end: '2026-10-04',
      complete: true,
      isDeloadWeek: false,
      sessionIds: ids,
    })
    expect(dash.muscles.map((m) => [m.muscleId, m.logged])).toEqual(SPEC_WEEKLY_TOTALS)
    expect(dash.muscles.map((m) => m.loggedFlag)).toEqual(SPEC_FLAGS)
    expect(dash.logged).toEqual({ totalSets: 94, capWarnings: [] })
  })

  it('shows no "low" flags before the week is over', async () => {
    const c = pool.make()
    await logSeedWeek(c)
    // Wednesday: only Lower A, Push and Pull have happened. Nothing has reached the band yet, and
    // 'low' waits for the week to end, so no muscle is flagged.
    const dash = await getVolumeDashboard(c, { weekOf: d('2026-10-01'), today: d('2026-10-01') })
    expect(dash.week).toMatchObject({ start: '2026-09-28', complete: false })
    expect(dash.muscles.every((m) => m.loggedFlag === null)).toBe(true)
    // Sunday, the week's last day, with everything logged: still no 'low' (Upper may slide to
    // Sunday) until the week is over.
    const lastDay = await getVolumeDashboard(c, { weekOf: d('2026-10-04'), today: d('2026-10-04') })
    expect(lastDay.week.complete).toBe(false)
    expect(lastDay.muscles.map((m) => m.loggedFlag)).toEqual(
      SPEC_FLAGS.map((f) => (f === 'low' ? null : f)),
    )
    // A finished past week viewed from any of its days is complete.
    const past = await getVolumeDashboard(c, { weekOf: d('2026-09-28'), today: d('2026-10-12') })
    expect(past.week.complete).toBe(true)
    expect(past.muscles.map((m) => m.loggedFlag)).toEqual(SPEC_FLAGS)
  })

  it('never counts sessions dated after today', async () => {
    const c = pool.make()
    await logSeedWeek(c)
    // Viewed on Wednesday: only Mon–Wed sessions (Lower A, Push, Pull) have happened.
    const dash = await getVolumeDashboard(c, { weekOf: d('2026-09-30'), today: d('2026-09-30') })
    expect(dash.week.sessionIds).toHaveLength(3)
    expect(dash.logged.totalSets).toBe(18 + 19 + 18)
  })

  it('counts an in-progress session and never flags a deload week as low', async () => {
    const c = pool.make()
    await logDay(c, { programDayId: 'day-lower-a', date: '2026-09-28', isDeload: true })
    await logDay(c, { programDayId: 'day-push', date: '2026-09-29', status: 'in_progress' })
    const dash = await getVolumeDashboard(c, { weekOf: d('2026-10-04'), today: d('2026-10-05') })
    expect(dash.week).toMatchObject({ complete: true, isDeloadWeek: true })
    expect(dash.week.sessionIds).toHaveLength(2)
    // Deload Lower A: squat 2 + leg extension 2 = 4 quad sets; nothing flags low.
    expect(dash.muscles.find((m) => m.muscleId === 'quads')).toMatchObject({
      logged: 4,
      loggedFlag: null,
    })
    expect(dash.muscles.some((m) => m.loggedFlag === 'low')).toBe(false)
    // Push (19 sets) + deload Lower A (11 sets).
    expect(dash.logged.totalSets).toBe(30)
  })

  it('warns about a logged session over the cap', async () => {
    const c = pool.make()
    const id = await logDay(c, {
      programDayId: 'day-push',
      date: '2026-09-29',
      extra: [{ exerciseId: 'ex-straight-bar-pushdown', sets: sets(3, 130, 12) }],
    })
    const dash = await getVolumeDashboard(c, { weekOf: d('2026-09-30'), today: d('2026-09-30') })
    expect(dash.logged.capWarnings).toEqual([
      {
        sessionId: id,
        date: '2026-09-29',
        dayName: 'Push',
        muscles: [{ muscleId: 'triceps', name: 'Triceps', sets: 12.5 }],
      },
    ])
  })

  it('uses the training-week start day setting', async () => {
    const c = pool.make()
    await logSeedWeek(c)
    await updateSettings(c, { trainingWeekStartDay: 0 })
    // Sunday-start weeks: Sun 10-04 begins a new, empty week.
    const dash = await getVolumeDashboard(c, { weekOf: d('2026-10-04'), today: d('2026-10-04') })
    expect(dash.week).toMatchObject({ start: '2026-10-04', end: '2026-10-10', sessionIds: [] })
    expect(dash.logged.totalSets).toBe(0)
    // Sat 10-03 falls in the Sun 09-27 week, which holds all five sessions.
    const prev = await getVolumeDashboard(c, { weekOf: d('2026-10-03'), today: d('2026-10-04') })
    expect(prev.week).toMatchObject({ start: '2026-09-27', complete: true })
    expect(prev.logged.totalSets).toBe(94)
  })
})
