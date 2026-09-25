// Write guards for training history. Every session command checks these before it writes, so
// the immutability rules live in one tested place:
// - An in-progress session is logged freely through the logger (session service).
// - A finished or abandoned session changes only through explicit Edit mode, and only in the
//   whitelisted fields below. It never goes back to in progress.
// - `sessionExercises` snapshots are never edited. While a session is in progress a row can be
//   swapped or removed only before any (non-voided) set is logged against it.
// - A command only ever touches rows of the one session it was aimed at.
// Guards are pure checks that throw a ServiceError with a stable code and a readable message.
import type { LoadType, Session, SessionExercise, SetLog } from '@/domain/types'
import { ServiceError } from '@/services/errors'

/** Highest RIR the logger records (the spec's "RIR (0–5)"). */
export const RIR_MAX = 5

/** Set fields that can change: freely while in progress, in Edit mode afterwards. */
export const SET_EDITABLE_FIELDS = ['loadLb', 'reps', 'rir', 'isWarmup', 'note'] as const
/** Session fields Edit mode can change (void/restore have their own commands). */
export const SESSION_EDITABLE_FIELDS = [
  'note',
  'jointPain',
  'isDeload',
  'bodyweightLb',
  'status',
] as const
/** Statuses Edit mode may set: finished ↔ abandoned, never back to in progress. */
export const EDITABLE_STATUSES = ['finished', 'abandoned'] as const

export type SetPatch = Partial<Pick<SetLog, (typeof SET_EDITABLE_FIELDS)[number]>>
export type SessionPatch = Partial<Pick<Session, (typeof SESSION_EDITABLE_FIELDS)[number]>>

// ── Existence ────────────────────────────────────────────────────────────────

export function requireSession(session: Session | undefined, id: string): Session {
  if (!session)
    throw new ServiceError('session_not_found', 'That session no longer exists.', { id })
  return session
}

export function requireSessionExercise(
  se: SessionExercise | undefined,
  id: string,
): SessionExercise {
  if (!se) {
    throw new ServiceError(
      'session_exercise_not_found',
      'That exercise is no longer in the session.',
      {
        id,
      },
    )
  }
  return se
}

export function requireSet(set: SetLog | undefined, id: string): SetLog {
  if (!set) throw new ServiceError('set_not_found', 'That set no longer exists.', { id })
  return set
}

// ── Session state ────────────────────────────────────────────────────────────

/** The logger may write to this session: it is in progress (and not voided). */
export function assertCanLog(session: Session): void {
  if (session.status !== 'in_progress' || session.voidedAt !== null) {
    throw new ServiceError(
      'session_not_in_progress',
      'This session is finished. Use Edit session to change it.',
      { sessionId: session.id, status: session.status },
    )
  }
}

/** Edit mode may be entered: the session is finished or abandoned (voided is allowed). */
export function assertEditable(session: Session): void {
  if (session.status === 'in_progress') {
    throw new ServiceError(
      'session_not_editable',
      'This session is still in progress. Change it in the logger.',
      { sessionId: session.id },
    )
  }
}

/** Edit mode may change this session's data: editable and not voided (restore it first). */
export function assertCanEdit(session: Session): void {
  assertEditable(session)
  if (session.voidedAt !== null) {
    throw new ServiceError('session_voided', 'This session is deleted. Restore it to edit it.', {
      sessionId: session.id,
    })
  }
}

/** A snapshot row can be swapped or removed only while no set is logged against it. */
export function assertNoLoggedSets(se: SessionExercise, sets: readonly SetLog[]): void {
  if (sets.some((s) => s.sessionExerciseId === se.id && s.voidedAt === null)) {
    throw new ServiceError(
      'has_sets',
      `${se.exerciseName} already has sets logged. Delete them first, or add another exercise.`,
      { sessionExerciseId: se.id },
    )
  }
}

// ── Cross-row consistency ────────────────────────────────────────────────────

/** The session exercise belongs to the session (commands never reach into another session). */
export function assertSessionExerciseOf(se: SessionExercise, session: Session): void {
  if (se.sessionId !== session.id) {
    throw new ServiceError('session_mismatch', 'That exercise belongs to a different session.', {
      sessionExerciseId: se.id,
      sessionId: session.id,
    })
  }
}

/** The set belongs to the session and to the session exercise it names. */
export function assertSetOf(set: SetLog, se: SessionExercise, session: Session): void {
  if (
    set.sessionId !== session.id ||
    set.sessionExerciseId !== se.id ||
    se.sessionId !== session.id ||
    set.exerciseId !== se.exerciseId
  ) {
    throw new ServiceError('session_mismatch', 'That set belongs to a different session.', {
      setId: set.id,
      sessionId: session.id,
    })
  }
}

export function assertSetNotVoided(set: SetLog): void {
  if (set.voidedAt !== null) {
    throw new ServiceError('set_voided', 'That set is deleted. Restore it first.', {
      setId: set.id,
    })
  }
}

// ── Patches ──────────────────────────────────────────────────────────────────

/**
 * The patch restricted to the whitelisted fields, with undefined values dropped. Any other key
 * (ids, dates, timestamps, snapshot data) is rejected rather than silently ignored.
 */
export function pickPatch<K extends string>(
  patch: Readonly<Record<string, unknown>>,
  allowed: readonly K[],
  what: string,
): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!(allowed as readonly string[]).includes(key)) {
      throw new ServiceError('field_not_editable', `A ${what}'s ${key} can't be changed.`, {
        field: key,
      })
    }
    if (value !== undefined) out[key as K] = value
  }
  return out
}

export function checkSetPatch(patch: SetPatch): SetPatch {
  const p = pickPatch(patch, SET_EDITABLE_FIELDS, 'set') as SetPatch
  if (p.isWarmup !== undefined && typeof p.isWarmup !== 'boolean') {
    throw new ServiceError('invalid_warmup', 'Warm-up must be yes or no.')
  }
  if (p.note !== undefined && typeof p.note !== 'string') {
    throw new ServiceError('invalid_note', 'The note must be text.')
  }
  return p
}

export function checkSessionPatch(patch: SessionPatch): SessionPatch {
  const p = pickPatch(patch, SESSION_EDITABLE_FIELDS, 'session') as SessionPatch
  if (p.status !== undefined && !(EDITABLE_STATUSES as readonly string[]).includes(p.status)) {
    throw new ServiceError(
      'invalid_status',
      'A past session can only be marked finished or abandoned.',
      { status: p.status },
    )
  }
  if (p.jointPain !== undefined && typeof p.jointPain !== 'boolean') {
    throw new ServiceError('invalid_joint_pain', 'Joint pain must be yes or no.')
  }
  if (p.isDeload !== undefined && typeof p.isDeload !== 'boolean') {
    throw new ServiceError('invalid_deload', 'Deload must be yes or no.')
  }
  if (p.note !== undefined && typeof p.note !== 'string') {
    throw new ServiceError('invalid_note', 'The note must be text.')
  }
  if (p.bodyweightLb !== undefined) assertBodyweight(p.bodyweightLb)
  return p
}

// ── Values ───────────────────────────────────────────────────────────────────

/** Reps: a whole number ≥ 0 (0 = a failed set). */
export function assertReps(reps: number): void {
  if (!Number.isInteger(reps) || reps < 0) {
    throw new ServiceError('invalid_reps', 'Reps must be a whole number of 0 or more.', { reps })
  }
}

/** RIR: blank, or a whole number from 0 to 5. */
export function assertRir(rir: number | null): void {
  if (rir !== null && !(Number.isInteger(rir) && rir >= 0 && rir <= RIR_MAX)) {
    throw new ServiceError('invalid_rir', `RIR must be a whole number from 0 to ${RIR_MAX}.`, {
      rir,
    })
  }
}

/** Load: a finite number; ≥ 0 except bodyweight-plus (added load, ≤ 0 when assisted). */
export function assertLoad(loadLb: number, loadType: LoadType): void {
  if (typeof loadLb !== 'number' || !Number.isFinite(loadLb)) {
    throw new ServiceError('invalid_load', 'Enter a load.', { loadLb })
  }
  if (loadLb < 0 && loadType !== 'bodyweight_plus') {
    throw new ServiceError('invalid_load', "Load can't be negative.", { loadLb })
  }
}

export function assertBodyweight(bodyweightLb: number | null): void {
  if (bodyweightLb !== null && !(Number.isFinite(bodyweightLb) && bodyweightLb > 0)) {
    throw new ServiceError('invalid_bodyweight', 'Bodyweight must be a positive number.', {
      bodyweightLb,
    })
  }
}

/** Full check of a set's values for an exercise of this load type. */
export function assertSetValues(
  v: Pick<SetLog, 'loadLb' | 'reps' | 'rir'>,
  loadType: LoadType,
): void {
  assertReps(v.reps)
  assertRir(v.rir)
  assertLoad(v.loadLb, loadType)
}

/** 1 + the highest setIndex already used by the session exercise (voided sets included), else 0. */
export function nextSetIndex(sets: readonly Pick<SetLog, 'setIndex'>[]): number {
  return sets.reduce((next, s) => Math.max(next, s.setIndex + 1), 0)
}
