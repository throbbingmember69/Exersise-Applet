import { describe, expect, it } from 'vitest'
import type { LocalDate, Session, SessionExercise, SetLog } from '@/domain/types'
import { ServiceError } from '@/services/errors'
import {
  assertCanEdit,
  assertCanLog,
  assertEditable,
  assertLoad,
  assertNoLoggedSets,
  assertReps,
  assertRir,
  assertSetOf,
  assertSetValues,
  checkSessionPatch,
  checkSetPatch,
  nextSetIndex,
  pickPatch,
  requireSession,
} from './guards'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    date: '2026-09-28' as LocalDate,
    startedAt: 1,
    finishedAt: null,
    tzOffsetMin: 0,
    status: 'in_progress',
    programDayId: 'day-lower-a',
    gymId: 'gym-1',
    isDeload: false,
    jointPain: false,
    bodyweightLb: 163,
    bodyweightSource: 'seed',
    note: '',
    voidedAt: null,
    editedAt: null,
    createdAt: 1,
    ...over,
  }
}

function se(over: Partial<SessionExercise> = {}): SessionExercise {
  return {
    id: 'se1',
    sessionId: 's1',
    order: 0,
    slotId: 'slot-lower-a-1',
    adHoc: false,
    exerciseId: 'ex-smith-squat',
    exerciseName: 'Smith machine squat',
    loadType: 'machine',
    perHand: false,
    unilateral: false,
    equipmentSpecific: true,
    gymScope: 'gym-1',
    isMainLift: true,
    isFinisher: false,
    swappedFromExerciseId: null,
    swapKind: 'none',
    prescription: {
      sets: 4,
      setsBeforeDeload: 4,
      repMin: 6,
      repMax: 10,
      rirMin: 1,
      rirMax: 2,
      restMinSec: 120,
      restMaxSec: 180,
      stepLb: 10,
    },
    muscleWeights: { quads: 1, glutes: 0.5 },
    suggestion: {
      loadLb: 220,
      repTargets: [6, 6, 6, 6],
      branch: 'start',
      missStreakBefore: 0,
      isCalibration: false,
      notices: [],
    },
    createdAt: 1,
    ...over,
  }
}

function set(over: Partial<SetLog> = {}): SetLog {
  return {
    id: 'set1',
    sessionId: 's1',
    sessionExerciseId: 'se1',
    exerciseId: 'ex-smith-squat',
    setIndex: 0,
    loadLb: 220,
    reps: 8,
    rir: 1,
    isWarmup: false,
    note: '',
    loggedAt: 1,
    editedAt: null,
    voidedAt: null,
    ...over,
  }
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError)
    return (e as ServiceError).code
  }
  return undefined
}

describe('session state guards', () => {
  it('lets the logger write only to a non-voided in-progress session', () => {
    expect(codeOf(() => assertCanLog(session()))).toBeUndefined()
    for (const status of ['finished', 'abandoned'] as const) {
      expect(codeOf(() => assertCanLog(session({ status })))).toBe('session_not_in_progress')
    }
    expect(codeOf(() => assertCanLog(session({ voidedAt: 5 })))).toBe('session_not_in_progress')
  })

  it('opens Edit mode only for finished or abandoned sessions', () => {
    expect(codeOf(() => assertCanEdit(session()))).toBe('session_not_editable')
    expect(codeOf(() => assertCanEdit(session({ status: 'finished' })))).toBeUndefined()
    expect(codeOf(() => assertCanEdit(session({ status: 'abandoned' })))).toBeUndefined()
    // A voided session must be restored before its data can change, but can still be restored.
    expect(codeOf(() => assertCanEdit(session({ status: 'finished', voidedAt: 5 })))).toBe(
      'session_voided',
    )
    expect(codeOf(() => assertEditable(session({ status: 'finished', voidedAt: 5 })))).toBe(
      undefined,
    )
  })

  it('reports a missing session', () => {
    expect(codeOf(() => requireSession(undefined, 'nope'))).toBe('session_not_found')
  })

  it('blocks swapping or removing an exercise once a non-voided set is logged', () => {
    const row = se()
    expect(codeOf(() => assertNoLoggedSets(row, []))).toBeUndefined()
    expect(codeOf(() => assertNoLoggedSets(row, [set({ voidedAt: 3 })]))).toBeUndefined()
    // Sets of other rows don't count.
    expect(
      codeOf(() => assertNoLoggedSets(row, [set({ sessionExerciseId: 'other' })])),
    ).toBeUndefined()
    expect(codeOf(() => assertNoLoggedSets(row, [set()]))).toBe('has_sets')
  })

  it('rejects a set that belongs to another session or snapshot', () => {
    expect(codeOf(() => assertSetOf(set(), se(), session()))).toBeUndefined()
    expect(codeOf(() => assertSetOf(set({ sessionId: 's2' }), se(), session()))).toBe(
      'session_mismatch',
    )
    expect(codeOf(() => assertSetOf(set(), se({ sessionId: 's2' }), session()))).toBe(
      'session_mismatch',
    )
    expect(codeOf(() => assertSetOf(set({ sessionExerciseId: 'se2' }), se(), session()))).toBe(
      'session_mismatch',
    )
    expect(codeOf(() => assertSetOf(set({ exerciseId: 'ex-rdl' }), se(), session()))).toBe(
      'session_mismatch',
    )
  })
})

describe('patch whitelists', () => {
  it('keeps whitelisted fields and drops undefined values', () => {
    expect(pickPatch({ reps: 8, note: undefined }, ['reps', 'note'], 'set')).toEqual({ reps: 8 })
  })

  it('rejects any field outside the whitelist', () => {
    for (const bad of [
      { id: 'x' },
      { sessionId: 's2' },
      { setIndex: 3 },
      { loggedAt: 0 },
      { voidedAt: null },
    ]) {
      expect(codeOf(() => checkSetPatch(bad as never))).toBe('field_not_editable')
    }
    for (const bad of [
      { date: '2026-01-01' },
      { programDayId: 'day-push' },
      { gymId: 'gym-2' },
      { startedAt: 0 },
      { voidedAt: 1 },
      { editedAt: 1 },
    ]) {
      expect(codeOf(() => checkSessionPatch(bad as never))).toBe('field_not_editable')
    }
  })

  it('allows only finished ↔ abandoned as an edited status', () => {
    expect(checkSessionPatch({ status: 'abandoned' })).toEqual({ status: 'abandoned' })
    expect(codeOf(() => checkSessionPatch({ status: 'in_progress' }))).toBe('invalid_status')
  })

  it('checks the types and bodyweight of a session patch', () => {
    expect(codeOf(() => checkSessionPatch({ jointPain: 'yes' as never }))).toBe(
      'invalid_joint_pain',
    )
    expect(codeOf(() => checkSessionPatch({ isDeload: 1 as never }))).toBe('invalid_deload')
    expect(codeOf(() => checkSessionPatch({ note: 3 as never }))).toBe('invalid_note')
    expect(codeOf(() => checkSessionPatch({ bodyweightLb: 0 }))).toBe('invalid_bodyweight')
    expect(checkSessionPatch({ bodyweightLb: null })).toEqual({ bodyweightLb: null })
  })

  it('checks the types of a set patch', () => {
    expect(codeOf(() => checkSetPatch({ isWarmup: 'no' as never }))).toBe('invalid_warmup')
    expect(codeOf(() => checkSetPatch({ note: 1 as never }))).toBe('invalid_note')
  })
})

describe('set values', () => {
  it('accepts whole reps from 0 (a failed set) up', () => {
    expect(codeOf(() => assertReps(0))).toBeUndefined()
    for (const reps of [-1, 2.5, Number.NaN, Infinity]) {
      expect(codeOf(() => assertReps(reps))).toBe('invalid_reps')
    }
  })

  it('accepts a blank RIR or a whole number from 0 to 5', () => {
    for (const rir of [null, 0, 5]) expect(codeOf(() => assertRir(rir))).toBeUndefined()
    for (const rir of [-1, 6, 1.5, Number.NaN]) {
      expect(codeOf(() => assertRir(rir))).toBe('invalid_rir')
    }
  })

  it('allows a negative load only as bodyweight-plus assistance', () => {
    expect(codeOf(() => assertLoad(0, 'machine'))).toBeUndefined()
    expect(codeOf(() => assertLoad(-5, 'machine'))).toBe('invalid_load')
    expect(codeOf(() => assertLoad(-20, 'bodyweight_plus'))).toBeUndefined()
    expect(codeOf(() => assertLoad(Number.NaN, 'bodyweight_plus'))).toBe('invalid_load')
    expect(codeOf(() => assertLoad(Infinity, 'dumbbell'))).toBe('invalid_load')
    expect(codeOf(() => assertSetValues({ loadLb: 220, reps: 8, rir: null }, 'machine'))).toBe(
      undefined,
    )
  })

  it('numbers sets after the highest index used, voided sets included', () => {
    expect(nextSetIndex([])).toBe(0)
    expect(nextSetIndex([{ setIndex: 0 }, { setIndex: 3 }, { setIndex: 1 }])).toBe(4)
  })
})
