// Which progression tracks of one exercise have a start load that can no longer change. Shared by
// setTrackStart (which refuses) and getExerciseDetail (which shows the start as read-only), so the
// editor never offers an edit the command would refuse.
//
// Replay reads the track start to score a track's first session (its calibrate flag decides
// whether that session is calibration), so a start is locked once:
// - history: a finished, non-voided session of the day logged at least one working set of the
//   exercise in a program slot; or
// - in progress: the non-voided session being logged has the exercise in a program slot of the
//   day, since finishing it would score it against the new start instead of the one its snapshot
//   was built from.
// The filters match TrainingModel.trackHistory (ad hoc exercises and finishers have no track) and
// the scope uses the exercise's current equipmentSpecific flag, like the model.
import type { AppDB } from '@/db/schema'
import { toWorkingSets } from '@/domain/progression/evaluate'
import { gymScope, trackKey } from '@/domain/progression/keys'
import type { Exercise, Session, SessionExercise, SetLog } from '@/domain/types'
import { isCountedSession } from '../training/model'

/** Why a track start is locked. */
export type TrackLock = 'history' | 'in_progress'

/** One exercise's session rows: its session exercises, their sets and their sessions. */
export interface ExerciseSessionRows {
  sessionExercises: readonly SessionExercise[]
  setLogs: readonly SetLog[]
  sessions: readonly Session[]
}

/** Read inside a transaction that includes sessions, sessionExercises and setLogs. */
export async function readExerciseSessionRows(
  db: AppDB,
  exerciseId: string,
): Promise<ExerciseSessionRows> {
  const sessionExercises = await db.sessionExercises
    .where('exerciseId')
    .equals(exerciseId)
    .toArray()
  const setLogs = await db.setLogs
    .where('sessionExerciseId')
    .anyOf(sessionExercises.map((se) => se.id))
    .toArray()
  const sessionIds = [...new Set(sessionExercises.map((se) => se.sessionId))]
  const sessions = (await db.sessions.bulkGet(sessionIds)).filter((s) => s !== undefined)
  return { sessionExercises, setLogs, sessions }
}

/** Locked track keys of the exercise, with the reason (history wins over in progress). */
export function lockedTracks(
  exercise: Pick<Exercise, 'id' | 'equipmentSpecific'>,
  rows: ExerciseSessionRows,
): Map<string, TrackLock> {
  const sessions = new Map(rows.sessions.map((s) => [s.id, s]))
  const setsBySe = new Map<string, SetLog[]>()
  for (const set of rows.setLogs) {
    const list = setsBySe.get(set.sessionExerciseId) ?? []
    list.push(set)
    setsBySe.set(set.sessionExerciseId, list)
  }
  const out = new Map<string, TrackLock>()
  for (const se of rows.sessionExercises) {
    if (se.exerciseId !== exercise.id || se.adHoc || se.slotId === null || se.isFinisher) continue
    const session = sessions.get(se.sessionId)
    if (!session || session.programDayId === null || session.voidedAt !== null) continue
    const key = trackKey(
      session.programDayId,
      exercise.id,
      gymScope(exercise.equipmentSpecific, session.gymId),
    )
    if (isCountedSession(session)) {
      if (toWorkingSets(setsBySe.get(se.id) ?? []).length > 0) out.set(key, 'history')
    } else if (session.status === 'in_progress' && !out.has(key)) {
      out.set(key, 'in_progress')
    }
  }
  return out
}

/**
 * Finished, non-voided sessions where the exercise has at least one working set (not a warm-up,
 * not voided). A session where it was skipped (snapshotted but no sets) isn't one of them.
 */
export function sessionsWithWorkingSets(rows: ExerciseSessionRows): Session[] {
  const withSets = new Set(
    rows.setLogs.filter((s) => !s.isWarmup && s.voidedAt === null).map((s) => s.sessionId),
  )
  return rows.sessions.filter((s) => isCountedSession(s) && withSets.has(s.id))
}
