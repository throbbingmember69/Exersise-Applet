import { afterEach, describe, expect, it } from 'vitest'
import type { ProgramSlot } from '@/domain/types'
import { createTestCtx } from '../context'
import { loadTrainingModel, type TrainingModel } from './model'
import { insertSession } from './testFixtures'

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

function slot(model: TrainingModel, dayId: string, id: string): ProgramSlot {
  const s = model.slotsOf(dayId).find((x) => x.id === id)
  if (!s) throw new Error(`no slot ${id}`)
  return s
}

function prescribe(
  model: TrainingModel,
  dayId: string,
  slotId: string,
  gymId = 'gym-1',
  isDeload = false,
) {
  const s = slot(model, dayId, slotId)
  return model.prescriptionFor({
    programDayId: dayId,
    regime: s,
    exerciseId: model.resolveSlotExercise(s, gymId).exercise.id,
    gymId,
    isDeload,
  })
}

const SQUAT = { slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat' }
const top4 = (load: number): [number, number][] => [
  [load, 10],
  [load, 10],
  [load, 10],
  [load, 10],
]

describe('TrainingModel on the seed program', () => {
  it('starts every slot from the spec start loads', async () => {
    const model = await loadTrainingModel(ctx())
    expect(prescribe(model, 'day-lower-a', 'slot-lower-a-1')).toMatchObject({
      loadLb: 220,
      sets: 4,
      repTargets: [6, 6, 6, 6],
      branch: 'start',
      isCalibration: false,
    })
    // "Set in week 1": blank and calibration.
    expect(prescribe(model, 'day-push', 'slot-push-2')).toMatchObject({
      loadLb: null,
      isCalibration: true,
      notices: [{ code: 'calibration_needed' }],
    })
    // Rep range changed: start load with a recalibrate badge.
    expect(prescribe(model, 'day-push', 'slot-push-3')).toMatchObject({
      loadLb: 205,
      isCalibration: true,
      notices: [{ code: 'recalibrate' }],
    })
    expect(prescribe(model, 'day-pull', 'slot-pull-1')).toMatchObject({ loadLb: 50 })
  })

  it('lists slots in order and resolves the default exercise', async () => {
    const model = await loadTrainingModel(ctx())
    expect(model.slotsOf('day-lower-a').map((s) => s.id)).toEqual(
      [1, 2, 3, 4, 5, 6].map((i) => `slot-lower-a-${i}`),
    )
    expect(
      model.resolveSlotExercise(slot(model, 'day-lower-b', 'slot-lower-b-1'), 'gym-1'),
    ).toMatchObject({
      exercise: { id: 'ex-deadlift' },
      swapKind: 'none',
    })
  })
})

describe('replaying history', () => {
  it('steps up after every set reaches the top of the range', async () => {
    const c = ctx()
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [{ ...SQUAT, sets: top4(220) }],
    })
    const model = await loadTrainingModel(c)
    expect(prescribe(model, 'day-lower-a', 'slot-lower-a-1')).toMatchObject({
      loadLb: 230,
      branch: 'step',
    })
  })

  it('drops after two sessions in a row below the range', async () => {
    const c = ctx()
    const miss: [number, number][] = [
      [220, 8],
      [220, 7],
      [220, 6],
      [220, 5],
    ]
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [{ ...SQUAT, sets: miss }],
    })
    let model = await loadTrainingModel(c)
    expect(prescribe(model, 'day-lower-a', 'slot-lower-a-1')).toMatchObject({
      loadLb: 220,
      branch: 'same_after_miss',
    })
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-10-05',
      exercises: [{ ...SQUAT, sets: miss }],
    })
    model = await loadTrainingModel(c)
    expect(prescribe(model, 'day-lower-a', 'slot-lower-a-1')).toMatchObject({
      loadLb: 200,
      branch: 'drop',
    })
  })

  it('keeps a separate track per program day for the same exercise', async () => {
    const c = ctx()
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [
        {
          slotId: 'slot-lower-a-2',
          exerciseId: 'ex-leg-extension',
          sets: [
            [170, 15],
            [170, 15],
            [170, 15],
          ],
        },
      ],
    })
    const model = await loadTrainingModel(c)
    expect(prescribe(model, 'day-lower-a', 'slot-lower-a-2')).toMatchObject({
      loadLb: 175,
      branch: 'step',
    })
    expect(prescribe(model, 'day-lower-b', 'slot-lower-b-5')).toMatchObject({
      loadLb: 170,
      branch: 'start',
    })
  })

  it('ignores abandoned, voided and in-progress sessions, voided sets and warm-ups', async () => {
    const c = ctx()
    for (const extra of [
      { status: 'abandoned' as const },
      { voided: true },
      { status: 'in_progress' as const },
    ]) {
      await insertSession(c, {
        programDayId: 'day-lower-a',
        date: '2026-09-28',
        ...extra,
        exercises: [{ ...SQUAT, sets: top4(220) }],
      })
    }
    await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-29',
      exercises: [
        {
          ...SQUAT,
          sets: [
            { loadLb: 135, reps: 5, isWarmup: true },
            { loadLb: 2200, reps: 10, voided: true },
            [220, 10],
            [220, 10],
            [220, 10],
            [220, 9],
          ],
        },
      ],
    })
    const model = await loadTrainingModel(c)
    expect(prescribe(model, 'day-lower-a', 'slot-lower-a-1')).toMatchObject({
      loadLb: 220,
      branch: 'same_plus_rep',
      repTargets: [10, 10, 10, 10],
    })
  })

  it('reports each session result for the summary screen', async () => {
    const c = ctx()
    const id = await insertSession(c, {
      programDayId: 'day-lower-a',
      date: '2026-09-28',
      exercises: [{ ...SQUAT, sets: top4(220) }],
    })
    const results = (await loadTrainingModel(c)).sessionResults(id)
    expect([...results.values()]).toMatchObject([
      { branch: 'step', evaluated: true, baseLb: 220, allTop: true },
    ])
  })

  it('applies the deload prescription on request', async () => {
    const model = await loadTrainingModel(ctx())
    // 10% of 220 = 22 → floor(22 / 10) = 2 whole steps.
    expect(prescribe(model, 'day-lower-a', 'slot-lower-a-1', 'gym-1', true)).toMatchObject({
      loadLb: 200,
      sets: 2,
      notices: [{ code: 'deload' }],
    })
  })
})

describe('gym scopes', () => {
  it('shares free-weight tracks across gyms but starts machines fresh at a new gym', async () => {
    const c = ctx()
    await c.db.gyms.add({ id: 'gym-2', name: 'Home', sortOrder: 1, archivedAt: null, createdAt: 0 })
    await insertSession(c, {
      programDayId: 'day-push',
      date: '2026-09-29',
      exercises: [
        {
          slotId: 'slot-push-1',
          exerciseId: 'ex-incline-db-bench',
          sets: [
            [70, 10],
            [70, 10],
            [70, 10],
          ],
        },
      ],
    })
    const model = await loadTrainingModel(c)
    expect(model.scopeFor('ex-incline-db-bench', 'gym-2')).toBe('*')
    expect(prescribe(model, 'day-push', 'slot-push-1', 'gym-2')).toMatchObject({
      loadLb: 75,
      branch: 'step',
    })
    // Machine fly: equipment-specific, no start row at gym-2 → calibration with a blank load.
    expect(model.scopeFor('ex-machine-fly', 'gym-2')).toBe('gym-2')
    expect(prescribe(model, 'day-push', 'slot-push-3', 'gym-2')).toMatchObject({
      loadLb: null,
      isCalibration: true,
    })
  })

  it('uses gym slot overrides and gym step overrides', async () => {
    const c = ctx()
    await c.db.gyms.add({ id: 'gym-2', name: 'Home', sortOrder: 1, archivedAt: null, createdAt: 0 })
    await c.db.gymSlotOverrides.add({
      id: 'o1',
      gymId: 'gym-2',
      slotId: 'slot-lower-b-2',
      exerciseId: 'ex-leg-press',
    })
    await c.db.gymExerciseSettings.add({
      id: 'g1',
      gymId: 'gym-1',
      exerciseId: 'ex-smith-squat',
      stepLb: 5,
    })
    const model = await loadTrainingModel(c)
    expect(
      model.resolveSlotExercise(slot(model, 'day-lower-b', 'slot-lower-b-2'), 'gym-2'),
    ).toMatchObject({
      exercise: { id: 'ex-leg-press' },
      swapKind: 'gym_override',
    })
    expect(model.stepFor('ex-smith-squat', 'gym-1')).toBe(5)
    expect(model.stepFor('ex-smith-squat', 'gym-2')).toBe(10)
  })
})

describe('series, stalls, deload and main lifts', () => {
  const pullDay = (date: string, load: number, reps: number) => ({
    programDayId: 'day-pull',
    date,
    exercises: [
      {
        slotId: 'slot-pull-1',
        exerciseId: 'ex-weighted-chin-up',
        sets: [
          [load, reps],
          [load, reps],
          [load, reps],
        ] as [number, number][],
      },
    ],
  })

  it('pools a series across days and flags a stall after 3 sessions without a gain', async () => {
    const c = ctx()
    await insertSession(c, pullDay('2026-09-02', 50, 6))
    await insertSession(c, pullDay('2026-09-09', 50, 6))
    await insertSession(c, pullDay('2026-09-16', 50, 5))
    await insertSession(c, pullDay('2026-09-23', 50, 6))
    const model = await loadTrainingModel(c)
    const points = model.series('ex-weighted-chin-up', '*')
    expect(points).toHaveLength(4)
    // Bodyweight-plus e1RM uses bodyweight + added load; the chart shows the added-load equivalent.
    expect(points[0]!.value).toMatchObject({ kind: 'e1rm', totalLb: (163 + 50) * 1.2 })
    const flag = model.stallFlags().find((f) => f.exerciseId === 'ex-weighted-chin-up')
    expect(flag).toMatchObject({
      scope: '*',
      seriesKey: 'ex-weighted-chin-up|*',
      result: { stalled: true },
    })
  })

  it('does not flag a series that keeps improving', async () => {
    const c = ctx()
    for (const [i, reps] of [5, 6, 7, 8].entries())
      await insertSession(c, pullDay(`2026-09-0${i + 1}`, 50, reps))
    const model = await loadTrainingModel(c)
    expect(
      model.stallFlags().find((f) => f.exerciseId === 'ex-weighted-chin-up')?.result.stalled,
    ).toBe(false)
  })

  it('tracks an accepted deload until its sessions are done', async () => {
    const c = ctx()
    const acceptedAt = Date.UTC(2026, 9, 1)
    await c.db.suggestions.add({
      id: 's1',
      kind: 'deload',
      key: 'deload;x',
      status: 'accepted',
      payload: {},
      firstShownAt: acceptedAt - 1,
      respondedAt: acceptedAt,
    })
    let state = (await loadTrainingModel(c)).deloadState()
    expect(state.status).toMatchObject({ active: true, remaining: 5 })
    await insertSession(c, { ...pullDay('2026-10-02', 45, 6), isDeload: true })
    state = (await loadTrainingModel(c)).deloadState()
    expect(state.status).toMatchObject({ active: true, remaining: 4 })
  })

  it('suggests a deload when joint pain is flagged in 2 of the last 3 sessions', async () => {
    const c = ctx()
    await insertSession(c, { ...pullDay('2026-09-02', 50, 6), jointPain: true })
    await insertSession(c, pullDay('2026-09-09', 50, 7))
    await insertSession(c, { ...pullDay('2026-09-16', 50, 8), jointPain: true })
    const { trigger, status } = (await loadTrainingModel(c)).deloadState()
    expect(status.active).toBe(false)
    expect(trigger).toMatchObject({ suggest: true, reasons: ['joint_pain'] })
  })

  it('computes the main-lift strength change from total-load e1RM', async () => {
    const c = ctx()
    await insertSession(c, pullDay('2026-09-01', 50, 8))
    await insertSession(c, pullDay('2026-09-22', 50, 6))
    const slide = (await loadTrainingModel(c)).mainLiftSlide('2026-09-22' as never)
    expect(slide.perLift).toHaveLength(1)
    expect(slide.meanChangePct).toBeCloseTo(((213 * 1.2) / (213 * (1 + 8 / 30)) - 1) * 100, 6)
  })

  it('finds the in-progress session', async () => {
    const c = ctx()
    expect((await loadTrainingModel(c)).inProgressSession()).toBeNull()
    const id = await insertSession(c, { ...pullDay('2026-09-02', 50, 6), status: 'in_progress' })
    expect((await loadTrainingModel(c)).inProgressSession()?.id).toBe(id)
  })
})
