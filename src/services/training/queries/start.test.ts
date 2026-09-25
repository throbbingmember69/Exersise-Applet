import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDate } from '@/domain/types'
import { insertSession } from '../testFixtures'
import { getStartOptions, previewSession } from './start'
import { logDay, sets, testCtxPool } from './testHelpers'

const pool = testCtxPool()
afterEach(() => pool.cleanup())

const d = (s: string) => s as LocalDate
// 2026-09-28 is a Monday (Lower A); the seed week is Mon Lower A, Tue Push, Wed Pull, Fri Lower B,
// Sat Upper.
const MON = d('2026-09-28')

async function addGym2(c: ReturnType<typeof pool.make>, archivedAt: number | null = null) {
  await c.db.gyms.add({ id: 'gym-2', name: 'Home', sortOrder: 1, archivedAt, createdAt: 0 })
}

describe('getStartOptions', () => {
  it('pre-selects the seed gym and today’s scheduled day on first launch', async () => {
    const c = pool.make()
    const opts = await getStartOptions(c, { today: MON })
    expect(opts).toEqual({
      today: MON,
      gyms: [{ id: 'gym-1', name: 'Gym 1' }],
      lastGymId: 'gym-1',
      days: [
        {
          id: 'day-lower-a',
          name: 'Lower A',
          weekday: 1,
          lastDoneDate: null,
          scheduledToday: true,
        },
        { id: 'day-push', name: 'Push', weekday: 2, lastDoneDate: null, scheduledToday: false },
        { id: 'day-pull', name: 'Pull', weekday: 3, lastDoneDate: null, scheduledToday: false },
        {
          id: 'day-lower-b',
          name: 'Lower B',
          weekday: 5,
          lastDoneDate: null,
          scheduledToday: false,
        },
        { id: 'day-upper', name: 'Upper', weekday: 6, lastDoneDate: null, scheduledToday: false },
      ],
      suggestedDayId: 'day-lower-a',
      inProgressSessionId: null,
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

  it('falls back to the first day on an unscheduled day with no history', async () => {
    const c = pool.make()
    // Thursday: no program day is scheduled.
    expect((await getStartOptions(c, { today: d('2026-10-01') })).suggestedDayId).toBe(
      'day-lower-a',
    )
  })

  it('suggests today’s day while it is not done this training week', async () => {
    const c = pool.make()
    await logDay(c, { programDayId: 'day-lower-a', date: '2026-09-28' })
    await logDay(c, { programDayId: 'day-push', date: '2026-09-29' })
    // Wednesday → Pull.
    expect((await getStartOptions(c, { today: d('2026-09-30') })).suggestedDayId).toBe('day-pull')
    // The next Monday is a new training week, so Lower A again (not Pull, the next in order).
    const nextMonday = await getStartOptions(c, { today: d('2026-10-05') })
    expect(nextMonday.suggestedDayId).toBe('day-lower-a')
    expect(nextMonday.days.map((x) => x.lastDoneDate)).toEqual([
      '2026-09-28',
      '2026-09-29',
      null,
      null,
      null,
    ])
  })

  it('moves to the next day in program order once today’s day is done or on a rest day', async () => {
    const c = pool.make()
    await logDay(c, { programDayId: 'day-lower-a', date: '2026-09-28' })
    // Lower A already done this Monday → Push.
    expect((await getStartOptions(c, { today: MON })).suggestedDayId).toBe('day-push')
    await logDay(c, { programDayId: 'day-push', date: '2026-09-29' })
    await logDay(c, { programDayId: 'day-pull', date: '2026-09-29', hour: 19 })
    // Wednesday, but Pull was done a day early → Lower B follows Pull.
    expect((await getStartOptions(c, { today: d('2026-09-30') })).suggestedDayId).toBe(
      'day-lower-b',
    )
    await logDay(c, { programDayId: 'day-lower-b', date: '2026-10-02' })
    await logDay(c, { programDayId: 'day-upper', date: '2026-10-03' })
    // Sunday (rest day) after Upper → wraps to Lower A.
    expect((await getStartOptions(c, { today: d('2026-10-04') })).suggestedDayId).toBe(
      'day-lower-a',
    )
  })

  it('ignores abandoned, voided, in-progress and future sessions', async () => {
    const c = pool.make()
    await logDay(c, { programDayId: 'day-lower-a', date: '2026-09-28' })
    await logDay(c, { programDayId: 'day-push', date: '2026-09-29', status: 'abandoned' })
    await logDay(c, { programDayId: 'day-pull', date: '2026-09-29', voided: true })
    await logDay(c, { programDayId: 'day-lower-b', date: '2026-10-05' })
    const inProgress = await logDay(c, {
      programDayId: 'day-upper',
      date: '2026-10-01',
      status: 'in_progress',
    })
    const opts = await getStartOptions(c, { today: d('2026-10-01') })
    expect(opts.suggestedDayId).toBe('day-push')
    expect(opts.days.map((x) => x.lastDoneDate)).toEqual(['2026-09-28', null, null, null, null])
    expect(opts.inProgressSessionId).toBe(inProgress)
  })

  it('remembers the last gym while it is active', async () => {
    const c = pool.make()
    await addGym2(c)
    await c.db.appState.put({ key: 'lastGymId', value: 'gym-2' })
    let opts = await getStartOptions(c, { today: MON })
    expect(opts.gyms).toEqual([
      { id: 'gym-1', name: 'Gym 1' },
      { id: 'gym-2', name: 'Home' },
    ])
    expect(opts.lastGymId).toBe('gym-2')
    await c.db.gyms.update('gym-2', { archivedAt: 1 })
    opts = await getStartOptions(c, { today: MON })
    expect(opts.gyms.map((g) => g.id)).toEqual(['gym-1'])
    expect(opts.lastGymId).toBe('gym-1')
  })

  it('reports a running deload and counts down its sessions', async () => {
    const c = pool.make()
    const acceptedAt = Date.UTC(2026, 8, 27)
    await c.db.suggestions.add({
      id: 's1',
      kind: 'deload',
      key: 'deload;manual',
      status: 'accepted',
      payload: {},
      firstShownAt: acceptedAt,
      respondedAt: acceptedAt,
    })
    expect((await getStartOptions(c, { today: MON })).deload).toMatchObject({
      active: true,
      remaining: 5,
      total: 5,
    })
    await logDay(c, { programDayId: 'day-lower-a', date: '2026-09-28', isDeload: true })
    await logDay(c, { programDayId: 'day-push', date: '2026-09-29', isDeload: true })
    expect((await getStartOptions(c, { today: d('2026-09-30') })).deload).toMatchObject({
      active: true,
      remaining: 3,
      suggested: false,
    })
  })

  it('suggests a deload after joint pain in 2 of the last 3 sessions until it is answered', async () => {
    const c = pool.make()
    await logDay(c, { programDayId: 'day-lower-a', date: '2026-09-28', jointPain: true })
    await logDay(c, { programDayId: 'day-push', date: '2026-09-29' })
    await logDay(c, { programDayId: 'day-pull', date: '2026-09-30', jointPain: true })
    const today = d('2026-10-02')
    const { deload } = await getStartOptions(c, { today })
    expect(deload).toMatchObject({ active: false, suggested: true, reasons: ['joint_pain'] })
    expect(deload.fingerprint).toMatch(/^deload;joint_pain=/)
    // As of the day before the second flag, nothing triggers yet.
    expect((await getStartOptions(c, { today: d('2026-09-29') })).deload.suggested).toBe(false)

    await c.db.suggestions.add({
      id: 's1',
      kind: 'deload',
      key: deload.fingerprint!,
      status: 'dismissed',
      payload: {},
      firstShownAt: 0,
      respondedAt: 1,
    })
    expect((await getStartOptions(c, { today })).deload).toMatchObject({
      suggested: false,
      fingerprint: deload.fingerprint,
    })
  })
})

describe('previewSession', () => {
  it('previews the seed Push day with start loads, calibration badges and alternates', async () => {
    const c = pool.make()
    const preview = await previewSession(c, {
      gymId: 'gym-1',
      programDayId: 'day-push',
      isDeload: false,
    })
    expect(preview).toMatchObject({
      programDayId: 'day-push',
      dayName: 'Push',
      gymName: 'Gym 1',
      isDeload: false,
      totalSets: 19,
    })
    expect(preview!.slots.map((s) => [s.label, s.suggestion.loadLb, s.badge])).toEqual([
      ['Incline DB bench press', 70, null],
      ['Flat machine or DB press (new)', null, 'set_load'],
      ['Machine fly', 205, 'recalibrate'],
      ['Overhead shoulder press', 170, null],
      ['Lateral raise (machine)', 40, 'recalibrate'],
      ['Single-arm overhead cable triceps extension', 30, null],
      ['Dip machine', 200, 'recalibrate'],
    ])
    expect(preview!.slots[0]).toEqual({
      slotId: 'slot-push-1',
      label: 'Incline DB bench press',
      exerciseId: 'ex-incline-db-bench',
      exerciseName: 'Incline DB bench press',
      loadType: 'dumbbell',
      perHand: true,
      unilateral: false,
      regime: {
        sets: 3,
        repMin: 6,
        repMax: 10,
        rirMin: 1,
        rirMax: 2,
        restMinSec: 120,
        restMaxSec: 180,
      },
      suggestion: {
        loadLb: 70,
        repTargets: [6, 6, 6],
        sets: 3,
        branch: 'start',
        isCalibration: false,
        missStreakBefore: 0,
        notices: [],
      },
      swapKind: 'none',
      alternates: [],
      badge: null,
    })
    expect(preview!.slots[1]).toMatchObject({
      exerciseId: 'ex-flat-machine-press',
      alternates: [{ id: 'ex-flat-db-press', name: 'Flat DB press' }],
      suggestion: { isCalibration: true, notices: [{ code: 'calibration_needed' }] },
    })
    expect(preview!.slots[5]).toMatchObject({ unilateral: true, perHand: false })
  })

  it('previews a deload with half the sets and whole-step lighter loads', async () => {
    const c = pool.make()
    const preview = await previewSession(c, {
      gymId: 'gym-1',
      programDayId: 'day-lower-a',
      isDeload: true,
    })
    // Lower A is 4+3+3+2+3+3 sets → 2+2+2+1+2+2.
    expect(preview!.totalSets).toBe(11)
    expect(
      preview!.slots.map((s) => [s.exerciseId, s.suggestion.loadLb, s.suggestion.sets]),
    ).toEqual([
      ['ex-smith-squat', 200, 2], // 220 − 2 × 10 (10% = 22 → 2 whole steps)
      ['ex-leg-extension', 155, 2], // 170 − 3 × 5
      ['ex-seated-leg-curl', 90, 2], // 95 − 1 × 5 (9.5 → at least one step)
      ['ex-hip-thrust', 180, 1], // 200 − 2 × 10
      ['ex-standing-calf-raise', 320, 2], // 350 − 3 × 10
      ['ex-cable-crunch', 145, 2], // 160 − 3 × 5
    ])
    expect(preview!.slots[0]!.regime.sets).toBe(4)
    expect(preview!.slots[0]!.suggestion.notices).toEqual([{ code: 'deload' }])
  })

  it('reflects logged history in the suggestions', async () => {
    const c = pool.make()
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [
        { slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat', sets: sets(4, 220, 10) },
        {
          slotId: 'slot-lower-a-2',
          exerciseId: 'ex-leg-extension',
          sets: [
            [170, 12],
            [170, 11],
            [170, 10],
          ],
        },
      ],
    })
    const preview = await previewSession(c, {
      gymId: 'gym-1',
      programDayId: 'day-lower-a',
      isDeload: false,
    })
    expect(preview!.slots[0]!.suggestion).toMatchObject({
      loadLb: 230,
      branch: 'step',
      repTargets: [6, 6, 6, 6],
    })
    expect(preview!.slots[1]!.suggestion).toMatchObject({
      loadLb: 170,
      branch: 'same_plus_rep',
      repTargets: [13, 12, 11],
    })
  })

  it('resolves a second gym’s overrides and starts its machines in calibration', async () => {
    const c = pool.make()
    await addGym2(c)
    await c.db.gymSlotOverrides.add({
      id: 'o1',
      gymId: 'gym-2',
      slotId: 'slot-lower-b-2',
      exerciseId: 'ex-leg-press',
    })
    const preview = await previewSession(c, {
      gymId: 'gym-2',
      programDayId: 'day-lower-b',
      isDeload: false,
    })
    expect(preview!.gymName).toBe('Home')
    const [deadlift, split, curl] = preview!.slots
    // Barbell: the shared track keeps its start load and recalibration badge.
    expect(deadlift).toMatchObject({
      exerciseId: 'ex-deadlift',
      suggestion: { loadLb: 315 },
      badge: 'recalibrate',
      alternates: [{ id: 'ex-rdl', name: 'Romanian deadlift' }],
    })
    // The gym's permanent swap; the slot default becomes the swap-back option.
    expect(split).toMatchObject({
      exerciseId: 'ex-leg-press',
      exerciseName: 'Leg press',
      swapKind: 'gym_override',
      alternates: [{ id: 'ex-bss', name: 'Bulgarian split squat' }],
      suggestion: { loadLb: null },
      badge: 'set_load',
    })
    // A machine at a new gym has no start load.
    expect(curl).toMatchObject({ exerciseId: 'ex-seated-leg-curl', badge: 'set_load' })
  })

  it('returns null for an unknown day or gym', async () => {
    const c = pool.make()
    expect(
      await previewSession(c, { gymId: 'gym-1', programDayId: 'nope', isDeload: false }),
    ).toBeNull()
    expect(
      await previewSession(c, { gymId: 'nope', programDayId: 'day-push', isDeload: false }),
    ).toBeNull()
  })
})
