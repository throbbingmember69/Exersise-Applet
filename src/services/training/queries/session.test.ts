import { afterEach, describe, expect, it } from 'vitest'
import { insertSession, type SessionSpec } from '../testFixtures'
import { getLoggerView, getSessionDetail, getSessionSummary, listSessions } from './session'
import { logDay, sets, testCtxPool, type TestCtx } from './testHelpers'

const pool = testCtxPool()
afterEach(() => pool.cleanup())

const SQUAT = { slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat' }
const LEG_EXT = { slotId: 'slot-lower-a-2', exerciseId: 'ex-leg-extension' }
const LEG_CURL = { slotId: 'slot-lower-a-3', exerciseId: 'ex-seated-leg-curl' }
const HIP_THRUST = { slotId: 'slot-lower-a-4', exerciseId: 'ex-hip-thrust' }
const CALF = { slotId: 'slot-lower-a-5', exerciseId: 'ex-standing-calf-raise' }
const CRUNCH = { slotId: 'slot-lower-a-6', exerciseId: 'ex-cable-crunch' }
const SHRUG = { exerciseId: 'ex-barbell-shrug' } // finisher, always ad hoc

/** Two Lower A sessions a week apart; the second has every flowchart outcome. */
async function twoLowerAWeeks(c: TestCtx) {
  const week1 = await insertSession(c, {
    id: 'la-1',
    programDayId: 'day-lower-a',
    date: '2026-09-28',
    exercises: [
      { ...SQUAT, sets: sets(4, 220, 8) }, // in range → same load, +1 rep
      { ...LEG_EXT, sets: sets(3, 170, 12) }, // in range
      { ...LEG_CURL, sets: sets(3, 95, 9) }, // below 10 → miss 1 of 2
      {
        ...HIP_THRUST,
        sets: [
          [200, 10],
          [200, 9],
        ],
      },
      { ...CALF, sets: sets(3, 350, 12) },
      { ...CRUNCH, sets: sets(3, 160, 15) }, // all at the top → step
    ],
  })
  const week2 = await insertSession(c, {
    id: 'la-2',
    programDayId: 'day-lower-a',
    date: '2026-10-05',
    exercises: [
      { ...SQUAT, sets: [{ loadLb: 135, reps: 5, isWarmup: true }, ...sets(4, 220, 10)] },
      {
        ...LEG_EXT,
        sets: [
          [170, 11],
          [170, 10],
          [170, 9],
        ],
      },
      {
        ...LEG_CURL,
        sets: [
          [95, 9],
          [95, 9],
          [95, 8],
        ],
      },
      { ...HIP_THRUST, sets: [] },
      { ...CALF, sets: sets(3, 350, 13) },
      { ...CRUNCH, sets: sets(3, 165, 10) },
      { ...SHRUG, sets: sets(3, 135, 10) },
    ],
  })
  return { week1, week2 }
}

describe('getLoggerView', () => {
  it('shows the snapshot, the live sets and last time on the same track', async () => {
    const c = pool.make()
    await insertSession(c, {
      id: 'la-1',
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [
        { ...SQUAT, sets: sets(4, 220, 8) },
        { ...LEG_EXT, sets: sets(3, 170, 12) },
      ],
    })
    // Not "last time" for Lower A: voided, abandoned, or another program day's track.
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-10-01',
      voided: true,
      exercises: [{ ...SQUAT, sets: sets(4, 2200, 10) }],
    })
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-10-03',
      status: 'abandoned',
      exercises: [{ ...SQUAT, sets: sets(1, 230, 3) }],
    })
    await insertSession(c, {
      programDayId: 'day-lower-b',
      date: '2026-10-02',
      exercises: [
        { slotId: 'slot-lower-b-5', exerciseId: 'ex-leg-extension', sets: sets(2, 180, 15) },
      ],
    })
    const id = await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-10-05',
      status: 'in_progress',
      exercises: [
        {
          ...SQUAT,
          sets: [
            { loadLb: 135, reps: 5, isWarmup: true },
            { loadLb: 220, reps: 10, rir: 2 },
            { loadLb: 2200, reps: 10, voided: true },
            { loadLb: 220, reps: 9, rir: 1 },
          ],
        },
        {
          ...LEG_EXT,
          sets: [
            [170, 13],
            [170, 12],
            [170, 11],
          ],
        },
        { ...HIP_THRUST, sets: [] },
      ],
    })

    const view = await getLoggerView(c, id)
    expect(view).toMatchObject({
      session: { id, date: '2026-10-05', status: 'in_progress', programDayId: 'day-lower-a' },
      dayName: 'Lower A',
      gymName: 'Gym 1',
      workingSetCount: 5,
      prescribedSetCount: 9,
    })
    const [squat, legExt, hipThrust] = view!.exercises
    expect(squat).toMatchObject({
      exerciseName: 'Smith machine squat',
      loadType: 'machine',
      prescription: { sets: 4, repMin: 6, repMax: 10, rirMin: 1, rirMax: 2 },
      restMinSec: 120,
      restMaxSec: 180,
      workingSetCount: 2,
      done: false,
      badge: null,
    })
    expect(squat!.sets.map((s) => [s.setIndex, s.loadLb, s.reps, s.rir, s.isWarmup])).toEqual([
      [0, 135, 5, 1, true],
      [1, 220, 10, 2, false],
      [3, 220, 9, 1, false],
    ])
    expect(squat!.lastTime).toEqual({
      sessionId: 'la-1',
      date: '2026-09-28',
      isDeload: false,
      sets: [0, 1, 2, 3].map((i) => ({ setIndex: i, loadLb: 220, reps: 8, rir: 1 })),
    })
    expect(legExt).toMatchObject({ workingSetCount: 3, done: true, restMinSec: 90 })
    // Lower A's leg extension track, not Lower B's later session.
    expect(legExt!.lastTime).toMatchObject({ sessionId: 'la-1', date: '2026-09-28' })
    expect(legExt!.lastTime!.sets.map((s) => s.reps)).toEqual([12, 12, 12])
    expect(hipThrust).toMatchObject({ sets: [], workingSetCount: 0, done: false, lastTime: null })
  })

  it('shares last time across gyms only for free weights, and by series for ad hoc work', async () => {
    const c = pool.make()
    await c.db.gyms.add({ id: 'gym-2', name: 'Home', sortOrder: 1, archivedAt: null, createdAt: 0 })
    await insertSession(c, {
      programDayId: 'day-push',
      date: '2026-09-29',
      exercises: [
        { slotId: 'slot-push-1', exerciseId: 'ex-incline-db-bench', sets: sets(3, 70, 8) },
        { slotId: 'slot-push-3', exerciseId: 'ex-machine-fly', sets: sets(2, 205, 12) },
        { ...SHRUG, sets: sets(3, 135, 10) },
      ],
    })
    // An ad hoc Pull-day shrug: ad hoc work has no track, so any day's session counts.
    await insertSession(c, {
      programDayId: 'day-pull',
      date: '2026-09-30',
      exercises: [{ ...SHRUG, sets: sets(3, 140, 10) }],
    })
    const id = await insertSession(c, {
      programDayId: 'day-push',
      gymId: 'gym-2',
      date: '2026-10-06',
      status: 'in_progress',
      exercises: [
        { slotId: 'slot-push-1', exerciseId: 'ex-incline-db-bench', sets: [] },
        { slotId: 'slot-push-3', exerciseId: 'ex-machine-fly', sets: [] },
        { ...SHRUG, sets: [] },
      ],
    })
    const view = await getLoggerView(c, id)
    expect(view!.gymName).toBe('Home')
    const [bench, fly, shrug] = view!.exercises
    // Dumbbells share a track across gyms.
    expect(bench!.lastTime).toMatchObject({ date: '2026-09-29' })
    expect(bench!.lastTime!.sets.map((s) => s.reps)).toEqual([8, 8, 8])
    // Machines are separate per gym.
    expect(fly!.lastTime).toBeNull()
    expect(shrug).toMatchObject({ adHoc: true, isFinisher: true })
    expect(shrug!.lastTime).toMatchObject({ date: '2026-09-30' })
    expect(shrug!.lastTime!.sets.map((s) => s.loadLb)).toEqual([140, 140, 140])
  })

  it('badges calibration exercises and returns null for a missing session', async () => {
    const c = pool.make()
    const id = await insertSession(c, {
      programDayId: 'day-push',
      date: '2026-09-29',
      status: 'in_progress',
      exercises: [
        {
          slotId: 'slot-push-2',
          exerciseId: 'ex-flat-machine-press',
          sets: [],
          isCalibration: true,
        },
      ],
    })
    expect((await getLoggerView(c, id))!.exercises[0]!.badge).toBe('set_load')
    expect(await getLoggerView(c, 'missing')).toBeNull()
  })
})

describe('getSessionSummary', () => {
  it('reports each exercise’s flowchart outcome, next suggestion, best set and PRs', async () => {
    const c = pool.make()
    const { week2 } = await twoLowerAWeeks(c)
    const summary = await getSessionSummary(c, week2)
    expect(summary).toMatchObject({
      sessionId: 'la-2',
      date: '2026-10-05',
      dayName: 'Lower A',
      gymName: 'Gym 1',
      status: 'finished',
      counted: true,
      isDeload: false,
      missesBeforeDrop: 2,
      stalls: [],
      deloadSuggestion: null,
    })
    const rows = summary!.exercises.map((e) => [
      e.exerciseName,
      e.outcome,
      e.missStreak,
      e.next?.loadLb ?? null,
      e.next?.repTargets ?? null,
      e.isPr,
    ])
    expect(rows).toEqual([
      ['Smith machine squat', 'step', 0, 230, [6, 6, 6, 6], true],
      ['Leg extension', 'miss', 1, 170, [11, 10, 10], false],
      ['Seated leg curl', 'drop', 0, 90, [10, 10, 10], false],
      ['Hip thrust', 'skipped', 0, 200, [11, 10], false],
      ['Standing calf raise', 'plus_rep', 0, 350, [14, 14, 14], true],
      ['Cable crunch', 'plus_rep', 0, 165, [11, 11, 11], true],
      ['Barbell shrug', 'not_tracked', 0, null, null, false],
    ])
    const [squat, legExt, curl] = summary!.exercises
    // Warm-ups never count: best set and working sets use the 4 × 220.
    expect(squat).toMatchObject({ baseLb: 220, workingSetCount: 4, prescribedSets: 4 })
    expect(squat!.bestSet).toMatchObject({ loadLb: 220, reps: 10 })
    expect(squat!.bestSet!.e1rmDisplayLb).toBeCloseTo(220 * (1 + 10 / 30), 9)
    expect(squat!.next).toMatchObject({ branch: 'step', sets: 4, isDeload: false, badge: null })
    // Reps-at-load exercises (repMax > 12) show no e1RM.
    expect(legExt!.bestSet).toEqual({
      setIndex: 0,
      loadLb: 170,
      reps: 11,
      e1rmDisplayLb: null,
      e1rmTotalLb: null,
    })
    // No set reached the range: the heaviest set still shows.
    expect(curl!.bestSet).toMatchObject({ loadLb: 95, reps: 9, e1rmDisplayLb: null })
  })

  it('reports session volume with snapshot weights and working sets only', async () => {
    const c = pool.make()
    const { week2 } = await twoLowerAWeeks(c)
    const { volume } = (await getSessionSummary(c, week2))!
    expect(volume).toEqual({
      byMuscle: [
        { muscleId: 'quads', name: 'Quads', sets: 7 },
        { muscleId: 'hamstrings', name: 'Hamstrings', sets: 3 },
        { muscleId: 'glutes', name: 'Glutes', sets: 2 },
        { muscleId: 'calves', name: 'Calves', sets: 3 },
        { muscleId: 'abs', name: 'Abs', sets: 3 },
        { muscleId: 'traps', name: 'Traps', sets: 3 },
      ],
      totalSets: 19,
      sessionCap: 11,
      overCap: [],
    })
  })

  it('flags a muscle over the session cap', async () => {
    const c = pool.make()
    const id = await logDay(c, {
      programDayId: 'day-push',
      date: '2026-09-29',
      extra: [{ exerciseId: 'ex-straight-bar-pushdown', sets: sets(3, 130, 12) }],
    })
    const { volume } = (await getSessionSummary(c, id))!
    // Push plans 9.5 triceps sets; 3 more pushdowns → 12.5 > 11.
    expect(volume.overCap).toEqual([{ muscleId: 'triceps', name: 'Triceps', sets: 12.5 }])
  })

  it('shows calibration results and the load they set', async () => {
    const c = pool.make()
    const id = await logDay(c, { programDayId: 'day-push', date: '2026-09-29' })
    const summary = (await getSessionSummary(c, id))!
    const flat = summary.exercises.find((e) => e.exerciseId === 'ex-flat-machine-press')
    expect(flat).toMatchObject({
      outcome: 'calibrated',
      next: { loadLb: 100, repTargets: [8, 8, 8], branch: 'calibrated', badge: null },
    })
    const fly = summary.exercises.find((e) => e.exerciseId === 'ex-machine-fly')
    expect(fly).toMatchObject({ outcome: 'calibrated', next: { loadLb: 205 } })
    const bench = summary.exercises.find((e) => e.exerciseId === 'ex-incline-db-bench')
    expect(bench).toMatchObject({
      outcome: 'plus_rep',
      next: { loadLb: 70, repTargets: [7, 7, 7] },
    })
  })

  it('marks deload sessions and suggests the deload version while a deload runs', async () => {
    const c = pool.make()
    const acceptedAt = Date.UTC(2026, 8, 28)
    await c.db.suggestions.add({
      id: 's1',
      kind: 'deload',
      key: 'deload;manual',
      status: 'accepted',
      payload: {},
      firstShownAt: acceptedAt,
      respondedAt: acceptedAt,
    })
    const id = await logDay(c, { programDayId: 'day-push', date: '2026-09-29', isDeload: true })
    const summary = (await getSessionSummary(c, id))!
    expect(summary.isDeload).toBe(true)
    expect(new Set(summary.exercises.map((e) => e.outcome))).toEqual(new Set(['deload']))
    // 4 deload sessions left: next time is also a deload (70 → 65, 2 sets).
    expect(summary.exercises[0]!.next).toEqual({
      loadLb: 65,
      repTargets: [6, 6],
      sets: 2,
      branch: 'start',
      isDeload: true,
      badge: null,
    })
  })

  it('lists stall flags for the session’s exercises', async () => {
    const c = pool.make()
    const pull = (date: string, reps: number): SessionSpec => ({
      programDayId: 'day-pull',
      date,
      exercises: [
        { slotId: 'slot-pull-1', exerciseId: 'ex-weighted-chin-up', sets: sets(3, 50, reps) },
      ],
    })
    await insertSession(c, pull('2026-09-02', 6))
    await insertSession(c, pull('2026-09-09', 6))
    await insertSession(c, pull('2026-09-16', 5))
    const last = await insertSession(c, pull('2026-09-23', 6))
    const summary = (await getSessionSummary(c, last))!
    expect(summary.stalls).toEqual([
      {
        exerciseId: 'ex-weighted-chin-up',
        name: 'Weighted chin-up',
        scope: '*',
        gymName: null,
        since: '2026-09-09',
      },
    ])
    const [chin] = summary.exercises
    expect(chin).toMatchObject({ outcome: 'plus_rep', isPr: false })
    // Chin-up e1RM: (163 + 50) × 1.2 = 255.6 total, shown as the added-load equivalent.
    expect(chin!.bestSet!.e1rmTotalLb).toBeCloseTo(255.6, 9)
    expect(chin!.bestSet!.e1rmDisplayLb).toBeCloseTo(92.6, 9)
  })

  it('offers a deload after joint pain in 2 of the last 3 sessions', async () => {
    const c = pool.make()
    await logDay(c, {
      id: 'jp-1',
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      jointPain: true,
    })
    await logDay(c, { id: 'jp-2', programDayId: 'day-push', date: '2026-09-29' })
    await logDay(c, { id: 'jp-3', programDayId: 'day-pull', date: '2026-09-30', jointPain: true })
    expect((await getSessionSummary(c, 'jp-3'))!.deloadSuggestion).toEqual({
      reasons: ['joint_pain'],
      fingerprint: 'deload;joint_pain=jp-1,jp-3',
    })
  })

  it('does not evaluate sessions that are not counted', async () => {
    const c = pool.make()
    const id = await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      status: 'abandoned',
      exercises: [
        { ...SQUAT, sets: sets(4, 220, 10) },
        { ...LEG_EXT, sets: [] },
      ],
    })
    const summary = (await getSessionSummary(c, id))!
    expect(summary.counted).toBe(false)
    expect(summary.exercises.map((e) => [e.outcome, e.next])).toEqual([
      ['not_tracked', null],
      ['skipped', null],
    ])
    expect(await getSessionSummary(c, 'missing')).toBeNull()
  })
})

describe('listSessions', () => {
  it('lists sessions newest first with day, gym, status and working-set counts', async () => {
    const c = pool.make()
    await c.db.gyms.add({ id: 'gym-2', name: 'Home', sortOrder: 1, archivedAt: null, createdAt: 0 })
    await insertSession(c, {
      id: 'a',
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [
        {
          ...SQUAT,
          sets: [
            { loadLb: 135, reps: 5, isWarmup: true },
            ...sets(4, 220, 8),
            { loadLb: 2200, reps: 8, voided: true },
          ],
        },
      ],
    })
    await insertSession(c, {
      id: 'b',
      programDayId: 'day-push',
      date: '2026-09-29',
      status: 'abandoned',
      exercises: [
        { slotId: 'slot-push-1', exerciseId: 'ex-incline-db-bench', sets: sets(2, 70, 8) },
      ],
    })
    await insertSession(c, {
      id: 'c',
      programDayId: 'day-pull',
      date: '2026-09-30',
      voided: true,
      exercises: [],
    })
    await insertSession(c, {
      id: 'd',
      programDayId: null,
      gymId: 'gym-2',
      date: '2026-10-01',
      exercises: [{ ...SHRUG, sets: sets(3, 135, 10) }],
    })
    await insertSession(c, {
      id: 'e',
      programDayId: 'day-lower-b',
      date: '2026-10-02',
      hour: 8,
      status: 'in_progress',
      exercises: [{ slotId: 'slot-lower-b-1', exerciseId: 'ex-deadlift', sets: sets(1, 315, 6) }],
    })
    await insertSession(c, {
      id: 'f',
      programDayId: 'day-upper',
      date: '2026-10-02',
      hour: 19,
      exercises: [],
    })
    await c.db.sessions.update('a', { editedAt: 1 })

    const list = await listSessions(c)
    expect(list.map((s) => [s.id, s.dayName, s.gymName, s.status, s.workingSets])).toEqual([
      ['f', 'Upper', 'Gym 1', 'finished', 0],
      ['e', 'Lower B', 'Gym 1', 'in_progress', 1],
      ['d', 'Ad hoc', 'Home', 'finished', 3],
      ['b', 'Push', 'Gym 1', 'abandoned', 2],
      ['a', 'Lower A', 'Gym 1', 'finished', 4],
    ])
    expect(list.find((s) => s.id === 'a')).toMatchObject({ edited: true, voided: false })

    const all = await listSessions(c, { includeVoided: true })
    expect(all.map((s) => s.id)).toEqual(['f', 'e', 'd', 'c', 'b', 'a'])
    expect(all.find((s) => s.id === 'c')).toMatchObject({ voided: true, dayName: 'Pull' })
    expect((await listSessions(c, { limit: 2 })).map((s) => s.id)).toEqual(['f', 'e'])
  })
})

describe('getSessionDetail', () => {
  it('combines the logged sets with each exercise’s result', async () => {
    const c = pool.make()
    const { week2 } = await twoLowerAWeeks(c)
    const detail = (await getSessionDetail(c, week2))!
    expect(detail).toMatchObject({
      dayName: 'Lower A',
      counted: true,
      voided: false,
      edited: false,
      missesBeforeDrop: 2,
      workingSetCount: 19,
      volume: { totalSets: 19 },
    })
    const [squat] = detail.exercises
    expect(squat!.sets).toHaveLength(5)
    expect(squat!.sets[0]).toMatchObject({ isWarmup: true, loadLb: 135 })
    expect(squat!.lastTime).toMatchObject({ sessionId: 'la-1' })
    expect(squat!.result).toMatchObject({ outcome: 'step', next: { loadLb: 230 }, isPr: true })
    expect(detail.exercises.map((e) => e.result.outcome)).toEqual([
      'step',
      'miss',
      'drop',
      'skipped',
      'plus_rep',
      'plus_rep',
      'not_tracked',
    ])
  })

  it('shows a voided session without evaluating it', async () => {
    const c = pool.make()
    const { week1 } = await twoLowerAWeeks(c)
    await c.db.sessions.update(week1, { voidedAt: 1, editedAt: 1 })
    const detail = (await getSessionDetail(c, week1))!
    expect(detail).toMatchObject({ counted: false, voided: true, edited: true })
    expect(new Set(detail.exercises.map((e) => e.result.outcome))).toEqual(new Set(['not_tracked']))
    expect(await getSessionDetail(c, 'missing')).toBeNull()
  })
})
