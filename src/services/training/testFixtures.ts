// Test helper: write a logged session straight into the database, the way the session service
// would have (session row + prescription snapshots + set logs). Used by service tests only.
import { parseLocalDate } from '@/domain/dates'
import type { Branch, LoadType, Session, SessionExercise, SetLog } from '@/domain/types'
import type { ServiceCtx } from '../context'

export type SetSpec =
  | [loadLb: number, reps: number]
  | { loadLb: number; reps: number; rir?: number | null; isWarmup?: boolean; voided?: boolean }

export interface ExerciseSpec {
  /** Program slot id; omit for an ad hoc exercise. */
  slotId?: string
  exerciseId: string
  sets: SetSpec[]
  isCalibration?: boolean
  branch?: Branch
}

export interface SessionSpec {
  id?: string
  programDayId: string | null
  gymId?: string
  date: string
  /** Hour of day (local time is irrelevant here; only ordering matters). */
  hour?: number
  status?: Session['status']
  isDeload?: boolean
  jointPain?: boolean
  bodyweightLb?: number | null
  voided?: boolean
  exercises: ExerciseSpec[]
}

let counter = 0

export async function insertSession(
  ctx: Pick<ServiceCtx, 'db'>,
  spec: SessionSpec,
): Promise<string> {
  const { db } = ctx
  const id = spec.id ?? `sess-${++counter}`
  const date = parseLocalDate(spec.date)
  const [y, m, d] = spec.date.split('-').map(Number) as [number, number, number]
  const startedAt = Date.UTC(y, m - 1, d, spec.hour ?? 17)
  const session: Session = {
    id,
    date,
    startedAt,
    finishedAt: spec.status === 'in_progress' ? null : startedAt + 3_600_000,
    tzOffsetMin: 0,
    status: spec.status ?? 'finished',
    programDayId: spec.programDayId,
    gymId: spec.gymId ?? 'gym-1',
    isDeload: spec.isDeload ?? false,
    jointPain: spec.jointPain ?? false,
    bodyweightLb: spec.bodyweightLb === undefined ? 163 : spec.bodyweightLb,
    bodyweightSource: 'manual',
    note: '',
    voidedAt: spec.voided ? startedAt + 7_200_000 : null,
    editedAt: null,
    createdAt: startedAt,
  }
  const sessionExercises: SessionExercise[] = []
  const setLogs: SetLog[] = []
  for (const [order, ex] of spec.exercises.entries()) {
    const exercise = await db.exercises.get(ex.exerciseId)
    if (!exercise) throw new Error(`Unknown exercise ${ex.exerciseId}`)
    const slot = ex.slotId ? await db.programSlots.get(ex.slotId) : undefined
    if (ex.slotId && !slot) throw new Error(`Unknown slot ${ex.slotId}`)
    const regime = slot ?? exercise.defaultRegime
    const sets = spec.isDeload ? Math.ceil(regime.sets / 2) : regime.sets
    const seId = `${id}-ex-${order}`
    sessionExercises.push({
      id: seId,
      sessionId: id,
      order,
      slotId: ex.slotId ?? null,
      adHoc: !ex.slotId,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      loadType: exercise.loadType as LoadType,
      perHand: exercise.perHand,
      unilateral: exercise.unilateral,
      equipmentSpecific: exercise.equipmentSpecific,
      gymScope: exercise.equipmentSpecific ? session.gymId : '*',
      isMainLift: exercise.isMainLift,
      isFinisher: exercise.isFinisher,
      swappedFromExerciseId: null,
      swapKind: 'none',
      prescription: {
        sets,
        setsBeforeDeload: regime.sets,
        repMin: regime.repMin,
        repMax: regime.repMax,
        rirMin: regime.rirMin,
        rirMax: regime.rirMax,
        restMinSec: regime.restMinSec,
        restMaxSec: regime.restMaxSec,
        stepLb: exercise.stepLb,
      },
      muscleWeights: exercise.muscleWeights,
      suggestion: {
        loadLb: null,
        repTargets: [],
        branch: ex.branch ?? 'start',
        missStreakBefore: 0,
        isCalibration: ex.isCalibration ?? false,
        notices: [],
      },
      createdAt: startedAt,
    })
    for (const [setIndex, s] of ex.sets.entries()) {
      const set = Array.isArray(s) ? { loadLb: s[0], reps: s[1] } : s
      setLogs.push({
        id: `${seId}-set-${setIndex}`,
        sessionId: id,
        sessionExerciseId: seId,
        exerciseId: exercise.id,
        setIndex,
        loadLb: set.loadLb,
        reps: set.reps,
        rir: 'rir' in set ? (set.rir ?? null) : 1,
        isWarmup: 'isWarmup' in set ? (set.isWarmup ?? false) : false,
        note: '',
        loggedAt: startedAt + (order * 10 + setIndex) * 60_000,
        editedAt: null,
        voidedAt: 'voided' in set && set.voided ? startedAt : null,
      })
    }
  }
  await db.transaction('rw', db.sessions, db.sessionExercises, db.setLogs, async () => {
    await db.sessions.add(session)
    await db.sessionExercises.bulkAdd(sessionExercises)
    await db.setLogs.bulkAdd(setLogs)
  })
  return id
}
