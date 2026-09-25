// End to end through the commands: start → log → finish → the next start's snapshot suggestion.
// Spec acceptance: "Suggested loads follow the Progression rules flowchart exactly, including the
// two-session miss rule." Every expected number is worked out by hand from the flowchart and the
// adopted defaults (drop = max(1, floor(10% × load ÷ step)) steps; deload = ceil(sets / 2) sets
// at the same whole-step 10% cut for one 5-session cycle; rep targets per finding #46).
import { afterEach, describe, expect, it } from 'vitest'
import type { Branch, NoticeCode, SessionExercise, SessionSuggestion } from '@/domain/types'
import { createTestCtx } from '../context'
import { getAppState } from '../settings'
import { loadTrainingModel } from './model'
import {
  abandonSession,
  finishSession,
  LAST_GYM_ID_KEY,
  logSet,
  startSession,
  swapExercise,
} from './session'
import { acceptDeload, recordShown, suggestionByKey } from './suggestions'

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

const MIN_MS = 60_000
const DAY_MS = 86_400_000

const SQUAT = 'slot-lower-a-1' // Smith squat 4 × 6–10, step 10, start 220
const LEG_EXT = 'slot-lower-a-2' // Leg extension 3 × 10–15, step 5, start 170
const BENCH = 'slot-push-1' // Incline DB bench 3 × 6–10, step 5, start 70 (shared across gyms)
const FLAT_PRESS = 'slot-push-2' // Flat machine press 3 × 8–12, step 5, "Set in week 1"
const FLY = 'slot-push-3' // Machine fly 2 × 10–15, step 5, 205 with a recalibrate badge
const HINGE = 'slot-lower-b-1' // Deadlift (or RDL) 3 × 5–8, step 10, deadlift 315 recalibrate

type Sets = readonly (readonly [loadLb: number, reps: number])[]

interface TrainSpec {
  day: string
  gymId?: string
  /** One-off swaps made before logging: slot id → exercise id. */
  swaps?: Readonly<Record<string, string>>
  sets?: Readonly<Record<string, Sets>>
  jointPain?: boolean
  end?: 'finish' | 'abandon'
}

interface Trained {
  id: string
  /** The session's snapshot row for a slot (after any swap). */
  row: (slotId: string) => SessionExercise
}

/** One training day through the commands, a day after the previous one. */
async function train(c: Ctx, spec: TrainSpec): Promise<Trained> {
  c.advance(DAY_MS)
  const id = await startSession(c, { gymId: spec.gymId ?? 'gym-1', programDayId: spec.day })
  const rowsNow = () => c.db.sessionExercises.where('sessionId').equals(id).toArray()
  for (const [slotId, exerciseId] of Object.entries(spec.swaps ?? {})) {
    const target = (await rowsNow()).find((r) => r.slotId === slotId)
    await swapExercise(c, target!.id, exerciseId)
  }
  const rows = await rowsNow()
  const row = (slotId: string) => {
    const found = rows.find((r) => r.slotId === slotId)
    if (!found) throw new Error(`no row for ${slotId}`)
    return found
  }
  for (const [slotId, sets] of Object.entries(spec.sets ?? {})) {
    for (const [loadLb, reps] of sets) {
      c.advance(2 * MIN_MS)
      await logSet(c, { sessionExerciseId: row(slotId).id, loadLb, reps, rir: 1 })
    }
  }
  if (spec.end === 'abandon') await abandonSession(c, id)
  else await finishSession(c, id, { jointPain: spec.jointPain ?? false })
  return { id, row }
}

/** The exact snapshot suggestion. */
function suggestion(
  loadLb: number | null,
  branch: Branch,
  repTargets: number[],
  opts: { missStreakBefore?: number; isCalibration?: boolean; notices?: NoticeCode[] } = {},
): SessionSuggestion {
  return {
    loadLb,
    repTargets,
    branch,
    missStreakBefore: opts.missStreakBefore ?? 0,
    isCalibration: opts.isCalibration ?? false,
    notices: (opts.notices ?? []).map((code) => ({ code })),
  }
}

const sets = (load: number, ...reps: number[]): Sets => reps.map((r) => [load, r] as const)

describe('Suggested loads follow the Progression rules flowchart exactly', () => {
  it('steps, adds reps, drops after two misses in a row, and resets after a deload week', async () => {
    const c = ctx()

    // S1: start loads.
    const s1 = await train(c, {
      day: 'day-lower-a',
      sets: { [SQUAT]: sets(220, 10, 10, 10, 10), [LEG_EXT]: sets(170, 12, 11, 9) },
    })
    expect(s1.row(SQUAT).suggestion).toEqual(suggestion(220, 'start', [6, 6, 6, 6]))
    expect(s1.row(LEG_EXT).suggestion).toEqual(suggestion(170, 'start', [10, 10, 10]))

    // S2. Squat: every set at the top → +1 step (220 → 230), reps back to repMin.
    // Leg extension: a set below the range, first time → same load, last reps as targets.
    const s2 = await train(c, {
      day: 'day-lower-a',
      sets: { [SQUAT]: sets(230, 8, 8, 7, 7), [LEG_EXT]: sets(170, 13, 12, 11) },
    })
    expect(s2.row(SQUAT).suggestion).toEqual(suggestion(230, 'step', [6, 6, 6, 6]))
    expect(s2.row(LEG_EXT).suggestion).toEqual(
      suggestion(170, 'same_after_miss', [12, 11, 10], { missStreakBefore: 1 }),
    )

    // S3. Squat: in range, none below → same load, +1 rep per set.
    // Leg extension: a clean session reset the miss streak.
    const s3 = await train(c, {
      day: 'day-lower-a',
      sets: { [SQUAT]: sets(230, 8, 7, 6, 5), [LEG_EXT]: sets(170, 11, 10, 9) },
    })
    expect(s3.row(SQUAT).suggestion).toEqual(suggestion(230, 'same_plus_rep', [9, 9, 8, 8]))
    expect(s3.row(LEG_EXT).suggestion).toEqual(suggestion(170, 'same_plus_rep', [14, 13, 12]))

    // S4. Squat: first miss (5 < 6) → same load. Leg extension: miss, in range, miss → no drop.
    const s4 = await train(c, {
      day: 'day-lower-a',
      sets: { [SQUAT]: sets(230, 7, 6, 5, 5), [LEG_EXT]: sets(170, 15, 15, 15) },
      jointPain: true,
    })
    expect(s4.row(SQUAT).suggestion).toEqual(
      suggestion(230, 'same_after_miss', [8, 7, 6, 6], { missStreakBefore: 1 }),
    )
    expect(s4.row(LEG_EXT).suggestion).toEqual(
      suggestion(170, 'same_after_miss', [11, 10, 10], { missStreakBefore: 1 }),
    )
    // The summary of S4: the second miss in a row is a drop.
    const results = (await loadTrainingModel(c)).sessionResults(s4.id)
    expect(results.get(s4.row(SQUAT).id)).toMatchObject({
      branch: 'drop',
      baseLb: 230,
      anyBelow: true,
      missStreakAfter: 0,
    })
    expect((await loadTrainingModel(c)).deloadState().trigger.suggest).toBe(false)

    // S5. Squat: below the range a second session in a row → drop 10%:
    // floor(23 / 10) = 2 steps → 210. Leg extension: every set at the top → 175. It is skipped.
    const s5 = await train(c, {
      day: 'day-lower-a',
      sets: { [SQUAT]: sets(210, 7, 6, 5, 5) },
      jointPain: true,
    })
    expect(s5.row(SQUAT).suggestion).toEqual(suggestion(210, 'drop', [6, 6, 6, 6]))
    expect(s5.row(LEG_EXT).suggestion).toEqual(suggestion(175, 'step', [10, 10, 10]))

    // Joint pain in 2 of the last 3 sessions → a deload is suggested and accepted.
    let model = await loadTrainingModel(c)
    const { trigger } = model.deloadState()
    expect(trigger).toEqual({
      suggest: true,
      reasons: ['joint_pain'],
      fingerprint: `deload;joint_pain=${s4.id},${s5.id}`,
    })
    const key = trigger.fingerprint!
    await recordShown(c, { kind: 'deload', key, payload: { reasons: trigger.reasons } })
    await acceptDeload(c, { key })

    // The deload week: one program cycle of 5 sessions, started as deloads automatically.
    // Squat: the pre-deload suggestion (210 after one miss at a new load: streak 1) with
    // ceil(4 / 2) = 2 sets and floor(21 / 10) = 2 steps lighter → 190.
    const d1 = await train(c, { day: 'day-lower-a', sets: { [SQUAT]: sets(190, 7, 7) } })
    expect(await c.db.sessions.get(d1.id)).toMatchObject({ isDeload: true })
    expect(d1.row(SQUAT).prescription).toMatchObject({ sets: 2, setsBeforeDeload: 4 })
    expect(d1.row(SQUAT).suggestion).toEqual(
      suggestion(190, 'same_after_miss', [7, 6], { missStreakBefore: 1, notices: ['deload'] }),
    )
    // Leg extension (skipped in S5, so still the S4 step): 175 − floor(17.5 / 5) × 5 = 160.
    expect(d1.row(LEG_EXT).suggestion).toEqual(
      suggestion(160, 'step', [10, 10], { notices: ['deload'] }),
    )
    // Push bench from its start load: 2 of 3 sets, 70 − 1 step = 65.
    const d2 = await train(c, { day: 'day-push', sets: { [BENCH]: sets(65, 8, 8) } })
    expect(d2.row(BENCH).prescription).toMatchObject({ sets: 2, setsBeforeDeload: 3 })
    expect(d2.row(BENCH).suggestion).toEqual(
      suggestion(65, 'start', [6, 6], { notices: ['deload'] }),
    )
    for (const day of ['day-pull', 'day-lower-b']) {
      const d = await train(c, { day })
      expect((await c.db.sessions.get(d.id))?.isDeload).toBe(true)
    }
    const d5 = await train(c, { day: 'day-upper' })
    expect((await c.db.sessions.get(d5.id))?.isDeload).toBe(true)
    model = await loadTrainingModel(c)
    expect(model.deloadState().status).toMatchObject({ active: false, remaining: 0 })
    // The same situation is not suggested again: its key is already answered.
    expect(model.deloadState().trigger.fingerprint).toBe(key)
    expect(await suggestionByKey(c, key)).toMatchObject({ status: 'accepted' })

    // S6: back to normal sessions at the pre-deload suggestions. The deload reset the squat's
    // miss streak, so this miss is the first again.
    const s6 = await train(c, {
      day: 'day-lower-a',
      sets: { [SQUAT]: sets(210, 7, 6, 5, 5) },
    })
    expect(await c.db.sessions.get(s6.id)).toMatchObject({ isDeload: false })
    expect(s6.row(SQUAT).prescription).toMatchObject({ sets: 4, setsBeforeDeload: 4 })
    expect(s6.row(SQUAT).suggestion).toEqual(
      suggestion(210, 'same_after_miss', [7, 6, 6, 6], { missStreakBefore: 0 }),
    )
    expect(s6.row(LEG_EXT).suggestion).toEqual(suggestion(175, 'step', [10, 10, 10]))

    // S7: S6's miss was the first since the deload → same load, streak 1 (no drop).
    const s7 = await train(c, {
      day: 'day-lower-a',
      sets: { [SQUAT]: sets(210, 10, 10, 10, 10) },
    })
    expect(s7.row(SQUAT).suggestion).toEqual(
      suggestion(210, 'same_after_miss', [7, 6, 6, 6], { missStreakBefore: 1 }),
    )

    // S8: every set at the top → 220.
    const s8 = await train(c, { day: 'day-lower-a', end: 'abandon' })
    expect(s8.row(SQUAT).suggestion).toEqual(suggestion(220, 'step', [6, 6, 6, 6]))
  })

  it('calibrates "Set in week 1" and recalibrated slots before evaluating them', async () => {
    const c = ctx()
    const p1 = await pushWeek1(c)
    expect(p1.row(FLAT_PRESS).suggestion).toEqual(
      suggestion(null, 'start', [8, 8, 8], {
        isCalibration: true,
        notices: ['calibration_needed'],
      }),
    )
    expect(p1.row(FLY).suggestion).toEqual(
      suggestion(205, 'start', [10, 10], { isCalibration: true, notices: ['recalibrate'] }),
    )

    // The calibration session isn't scored: the next load is its last working set's load,
    // with repMin targets. The fly hit the top of its range but doesn't step.
    const p2 = await pushWeek2(c)
    expect(p2.row(FLAT_PRESS).suggestion).toEqual(suggestion(130, 'calibrated', [8, 8, 8]))
    expect(p2.row(FLY).suggestion).toEqual(suggestion(150, 'calibrated', [10, 10]))
    expect(p2.row(BENCH).suggestion).toEqual(suggestion(75, 'step', [6, 6, 6]))

    // After calibration the slots follow the flowchart: every set at the top → +1 step.
    const p3 = await train(c, { day: 'day-push', end: 'abandon' })
    expect(p3.row(FLAT_PRESS).suggestion).toEqual(suggestion(135, 'step', [8, 8, 8]))
    expect(p3.row(FLY).suggestion).toEqual(suggestion(155, 'step', [10, 10]))
    expect(p3.row(BENCH).suggestion).toEqual(suggestion(75, 'same_plus_rep', [9, 9, 9]))
  })

  it('keeps machine tracks per gym and free-weight tracks shared when switching gyms', async () => {
    const c = ctx()
    await pushWeek1(c)
    await pushWeek2(c)
    await c.db.gyms.add({ id: 'gym-2', name: 'Home', sortOrder: 1, archivedAt: null, createdAt: 0 })
    // Gym 2 has no machine fly: its fly slot uses the cable crossover, and small dumbbell jumps.
    await c.db.gymSlotOverrides.add({
      id: 'o1',
      gymId: 'gym-2',
      slotId: FLY,
      exerciseId: 'ex-cable-crossover',
    })
    await c.db.gymExerciseSettings.add({
      id: 'g1',
      gymId: 'gym-2',
      exerciseId: 'ex-incline-db-bench',
      stepLb: 2.5,
    })

    const g1 = await train(c, {
      day: 'day-push',
      gymId: 'gym-2',
      sets: {
        [BENCH]: sets(75, 10, 10, 10),
        [FLAT_PRESS]: [
          [90, 10],
          [100, 9],
        ],
      },
    })
    expect(await getAppState(c, LAST_GYM_ID_KEY)).toBe('gym-2')
    // Dumbbells are shared: the bench continues its gym-1 track.
    expect(g1.row(BENCH)).toMatchObject({
      gymScope: '*',
      prescription: { stepLb: 2.5 },
      suggestion: suggestion(75, 'same_plus_rep', [9, 9, 9]),
    })
    // The machine press is separate per gym: calibration again at gym 2.
    expect(g1.row(FLAT_PRESS)).toMatchObject({
      gymScope: 'gym-2',
      suggestion: suggestion(null, 'start', [8, 8, 8], {
        isCalibration: true,
        notices: ['calibration_needed'],
      }),
    })
    expect(g1.row(FLY)).toMatchObject({
      exerciseId: 'ex-cable-crossover',
      swapKind: 'gym_override',
      swappedFromExerciseId: 'ex-machine-fly',
      gymScope: 'gym-2',
      suggestion: suggestion(null, 'start', [10, 10], {
        isCalibration: true,
        notices: ['calibration_needed'],
      }),
    })

    // Gym 2 again: the bench steps by gym 2's 2.5 lb; the press is calibrated at 100.
    const g2 = await train(c, { day: 'day-push', gymId: 'gym-2', end: 'abandon' })
    expect(g2.row(BENCH).suggestion).toEqual(suggestion(77.5, 'step', [6, 6, 6]))
    expect(g2.row(FLAT_PRESS).suggestion).toEqual(suggestion(100, 'calibrated', [8, 8, 8]))

    // Back at gym 1: the shared bench steps by 5 from gym 2's session; the machines pick up
    // their own gym-1 tracks where they left off.
    const g3 = await train(c, { day: 'day-push', gymId: 'gym-1', end: 'abandon' })
    expect(await getAppState(c, LAST_GYM_ID_KEY)).toBe('gym-1')
    expect(g3.row(BENCH)).toMatchObject({
      prescription: { stepLb: 5 },
      suggestion: suggestion(80, 'step', [6, 6, 6]),
    })
    expect(g3.row(FLAT_PRESS)).toMatchObject({
      gymScope: 'gym-1',
      suggestion: suggestion(135, 'step', [8, 8, 8]),
    })
    expect(g3.row(FLY)).toMatchObject({
      exerciseId: 'ex-machine-fly',
      swapKind: 'none',
      suggestion: suggestion(155, 'step', [10, 10]),
    })
  })

  it('gives a one-off swapped exercise its own track and leaves the default’s alone', async () => {
    const c = ctx()
    const l1 = await train(c, {
      day: 'day-lower-b',
      swaps: { [HINGE]: 'ex-rdl' },
      sets: { [HINGE]: sets(185, 8, 8, 8) },
    })
    expect(l1.row(HINGE)).toMatchObject({
      exerciseId: 'ex-rdl',
      swapKind: 'one_off',
      swappedFromExerciseId: 'ex-deadlift',
      // No RDL start load: its first session is calibration.
      suggestion: suggestion(null, 'start', [5, 5, 5], {
        isCalibration: true,
        notices: ['calibration_needed'],
      }),
    })
    const l2 = await train(c, {
      day: 'day-lower-b',
      sets: { [HINGE]: sets(315, 5, 5, 5) },
    })
    // The deadlift's own track never saw the RDL session.
    expect(l2.row(HINGE)).toMatchObject({
      exerciseId: 'ex-deadlift',
      swapKind: 'none',
      suggestion: suggestion(315, 'start', [5, 5, 5], {
        isCalibration: true,
        notices: ['recalibrate'],
      }),
    })
    const l3 = await train(c, { day: 'day-lower-b', swaps: { [HINGE]: 'ex-rdl' }, end: 'abandon' })
    expect(l3.row(HINGE).suggestion).toEqual(suggestion(185, 'calibrated', [5, 5, 5]))
    const l4 = await train(c, { day: 'day-lower-b', end: 'abandon' })
    // Deadlift calibration at 315 → calibrated at 315.
    expect(l4.row(HINGE).suggestion).toEqual(suggestion(315, 'calibrated', [5, 5, 5]))
  })
})

/** Push week 1: bench at the top; trial loads on the press; the fly at the top of its new range. */
function pushWeek1(c: Ctx) {
  return train(c, {
    day: 'day-push',
    sets: {
      [BENCH]: sets(70, 10, 10, 10),
      [FLAT_PRESS]: [
        [100, 12],
        [120, 10],
        [130, 8],
      ],
      [FLY]: sets(150, 15, 15),
    },
  })
}

/** Push week 2: bench in range; press and fly at the top of their ranges. */
function pushWeek2(c: Ctx) {
  return train(c, {
    day: 'day-push',
    sets: {
      [BENCH]: sets(75, 8, 8, 8),
      [FLAT_PRESS]: sets(130, 12, 12, 12),
      [FLY]: sets(150, 15, 15),
    },
  })
}
