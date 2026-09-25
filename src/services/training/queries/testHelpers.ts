// Test helpers for the query tests (not used by the app): throwaway contexts, and whole program
// days logged the way a lifter following the app would log them (the suggested load in every
// slot), written with testFixtures.insertSession.
import type { ProgramSlot } from '@/domain/types'
import { createTestCtx } from '../../context'
import { loadTrainingModel } from '../model'
import { insertSession, type ExerciseSpec, type SessionSpec, type SetSpec } from '../testFixtures'

export type TestCtx = ReturnType<typeof createTestCtx>

/** Contexts created by a test file, closed and deleted in afterEach. */
export function testCtxPool() {
  const ctxs: TestCtx[] = []
  return {
    make(opts?: Parameters<typeof createTestCtx>[0]): TestCtx {
      const c = createTestCtx(opts)
      ctxs.push(c)
      return c
    },
    async cleanup(): Promise<void> {
      for (const c of ctxs.splice(0)) {
        c.db.close()
        await c.db.delete()
      }
    },
  }
}

/** Loads a lifter picks for tracks with no known load ("Set in week 1", or a new gym's machine). */
export const CALIBRATION_LOADS: Readonly<Record<string, number>> = {
  'ex-flat-machine-press': 100,
  'ex-flat-db-press': 50,
  'ex-bss': 40,
  'ex-leg-press': 270,
}
const DEFAULT_CALIBRATION_LOAD = 100

/**
 * Reps per working set: the suggested targets, the top or bottom of the range, a miss (last set
 * one rep under the range), or a function of the slot, set index and target.
 */
export type RepPlan =
  | 'target'
  | 'top'
  | 'bottom'
  | 'miss'
  | ((slot: ProgramSlot, setIndex: number, target: number) => number)

export interface DaySpec extends Omit<SessionSpec, 'exercises' | 'programDayId'> {
  programDayId: string
  /** Default rep plan for every slot ('target'). */
  reps?: RepPlan
  /** Per-slot rep plans. */
  repsBySlot?: Readonly<Record<string, RepPlan>>
  /** Per-slot load overrides (else the suggestion, else a calibration load). */
  loadsBySlot?: Readonly<Record<string, number>>
  /** Slots whose exercise is left with no sets. */
  skip?: readonly string[]
  /** Log a warm-up set (half the load × 5) before each exercise's working sets. */
  warmups?: boolean
  /** Ad hoc exercises appended after the program slots. */
  extra?: readonly ExerciseSpec[]
}

/** Log every active slot of a program day at its suggested load and prescribed set count. */
export async function logDay(ctx: TestCtx, spec: DaySpec): Promise<string> {
  const { reps, repsBySlot, loadsBySlot, skip, warmups, extra, ...session } = spec
  const model = await loadTrainingModel(ctx)
  const gymId = session.gymId ?? 'gym-1'
  const exercises: ExerciseSpec[] = model.slotsOf(spec.programDayId).map((slot) => {
    const { exercise } = model.resolveSlotExercise(slot, gymId)
    const p = model.prescriptionFor({
      programDayId: spec.programDayId,
      regime: slot,
      exerciseId: exercise.id,
      gymId,
      isDeload: session.isDeload ?? false,
    })
    const load =
      loadsBySlot?.[slot.id] ??
      p.loadLb ??
      CALIBRATION_LOADS[exercise.id] ??
      DEFAULT_CALIBRATION_LOAD
    const plan = repsBySlot?.[slot.id] ?? reps ?? 'target'
    const sets: SetSpec[] = []
    if (!skip?.includes(slot.id)) {
      if (warmups) sets.push({ loadLb: load / 2, reps: 5, isWarmup: true })
      p.repTargets.forEach((target, i) => {
        sets.push([load, repsFor(plan, slot, i, target, p.repTargets.length)])
      })
    }
    return {
      slotId: slot.id,
      exerciseId: exercise.id,
      sets,
      isCalibration: p.isCalibration,
      branch: p.branch,
    }
  })
  return insertSession(ctx, { ...session, exercises: [...exercises, ...(extra ?? [])] })
}

function repsFor(
  plan: RepPlan,
  slot: ProgramSlot,
  i: number,
  target: number,
  sets: number,
): number {
  if (typeof plan === 'function') return plan(slot, i, target)
  switch (plan) {
    case 'target':
      return target
    case 'top':
      return slot.repMax
    case 'bottom':
      return slot.repMin
    case 'miss':
      return i === sets - 1 ? slot.repMin - 1 : slot.repMin
  }
}

/** The same working set repeated. */
export function sets(n: number, loadLb: number, reps: number): [number, number][] {
  return Array.from({ length: n }, () => [loadLb, reps])
}
