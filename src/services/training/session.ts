// Logger commands for the one in-progress session: start it (writing its immutable prescription
// snapshots), log, correct and void sets, swap, add and remove exercises before they have sets,
// fix its bodyweight, and finish or abandon it. Finished and abandoned sessions change only through Edit mode
// (edit.ts); the rules are enforced by db/guards.ts.
//
// Suggestions are computed by replaying history through the training model and frozen into each
// session exercise's snapshot when the session starts. They are never read back by the engine;
// the next session's suggestion is re-derived from the logged sets.
import {
  assertCanLog,
  assertKnownBodyweight,
  assertLoad,
  assertNoLoggedSets,
  assertReps,
  assertRir,
  assertSetNotVoided,
  assertSetOf,
  assertSetValues,
  checkSetPatch,
  nextSetIndex,
  requireSession,
  requireSessionExercise,
  requireSet,
  type SetPatch,
} from '@/db/guards'
import { deloadPrescription } from '@/domain/progression/prefill'
import type {
  Exercise,
  NextPrescription,
  ProgramSlot,
  Regime,
  Session,
  SessionExercise,
  SessionSuggestion,
  SetLog,
  SwapKind,
} from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { resolveSessionBodyweight } from './bodyweight'
import { loadTrainingModel, type TrainingModel } from './model'

/** appState key of the gym the last session was started at (the start sheet's default). */
export const LAST_GYM_ID_KEY = 'lastGymId'

// ── Start ────────────────────────────────────────────────────────────────────

export interface StartSessionInput {
  gymId: string
  /** null = ad hoc session: no program day, no exercises until added. */
  programDayId: string | null
  /**
   * Defaults to whether an accepted deload is running, for a program day. An ad hoc session
   * defaults to false: it isn't one of the deload cycle's program days.
   */
  isDeload?: boolean
  /**
   * Explicit bodyweight (source 'manual'). Otherwise the start sheet's default
   * (resolveSessionBodyweight: same-day weigh-in → trend → seed → unknown).
   */
  bodyweightLb?: number
}

/**
 * Start a session and snapshot every active slot of its program day, with the suggestion the
 * flowchart gives for the slot's exercise at this gym. Returns the new session id.
 */
export async function startSession(ctx: ServiceCtx, input: StartSessionInput): Promise<string> {
  const { db } = ctx
  checkStartInput(input)

  const model = await loadTrainingModel(ctx)
  const current = model.inProgressSession()
  if (current) throw inProgressError(current.id)

  const gym = await db.gyms.get(input.gymId)
  if (!gym) throw new ServiceError('gym_not_found', 'Pick a gym.', { gymId: input.gymId })
  if (gym.archivedAt !== null) {
    throw new ServiceError('gym_archived', `${gym.name} is archived.`, { gymId: gym.id })
  }
  if (input.programDayId !== null) {
    const day = await db.programDays.get(input.programDayId)
    if (!day) {
      throw new ServiceError('day_not_found', 'Pick a program day.', {
        programDayId: input.programDayId,
      })
    }
    if (day.archivedAt !== null) {
      throw new ServiceError('day_archived', `${day.name} is archived.`, { programDayId: day.id })
    }
  }

  const now = ctx.now()
  const date = today(ctx)
  const isDeload =
    input.isDeload ?? (input.programDayId !== null && model.deloadState().status.active)
  const bodyweight =
    input.bodyweightLb !== undefined
      ? { weightLb: input.bodyweightLb, source: 'manual' as const }
      : resolveSessionBodyweight(
          { bodyEntries: await db.bodyEntries.toArray(), settings: model.settings },
          date,
        )

  const sessionId = ctx.newId()
  const programDayId = input.programDayId
  const snapshots: SessionExercise[] =
    programDayId === null
      ? []
      : model.slotsOf(programDayId).map((slot, order) => {
          const { exercise, swapKind } = model.resolveSlotExercise(slot, input.gymId)
          const p = model.prescriptionFor({
            programDayId,
            regime: slot,
            exerciseId: exercise.id,
            gymId: input.gymId,
            isDeload,
          })
          return buildSnapshot(model, {
            id: ctx.newId(),
            sessionId,
            order,
            slotId: slot.id,
            exercise,
            gymId: input.gymId,
            swapKind,
            swappedFromExerciseId: swapKind === 'gym_override' ? slot.defaultExerciseId : null,
            regime: slot,
            sets: p.sets,
            suggestion: suggestionOf(p),
            bodyweightLb: bodyweight.weightLb,
            createdAt: now,
          })
        })

  const session: Session = {
    id: sessionId,
    date,
    startedAt: now,
    finishedAt: null,
    // Minutes east of UTC (`|| 0` turns UTC's -0 into 0).
    tzOffsetMin: -new Date(now).getTimezoneOffset() || 0,
    status: 'in_progress',
    programDayId,
    gymId: input.gymId,
    isDeload,
    jointPain: false,
    bodyweightLb: bodyweight.weightLb,
    // With no bodyweight at all this is 'manual', which means nothing (see SessionBodyweight).
    bodyweightSource: bodyweight.source,
    note: '',
    voidedAt: null,
    editedAt: null,
    createdAt: now,
  }

  await db.transaction('rw', [db.sessions, db.sessionExercises, db.appState], async () => {
    // Re-check under the write lock so two quick taps can't start two sessions.
    const racing = await db.sessions
      .where('status')
      .equals('in_progress')
      .filter((s) => s.voidedAt === null)
      .first()
    if (racing) throw inProgressError(racing.id)
    await db.sessions.add(session)
    await db.sessionExercises.bulkAdd(snapshots)
    await db.appState.put({ key: LAST_GYM_ID_KEY, value: input.gymId })
  })
  return sessionId
}

/** Runtime checks of the start input (a bad value would otherwise be stored as-is). */
function checkStartInput(input: StartSessionInput): void {
  if (typeof input.gymId !== 'string') {
    throw new ServiceError('gym_not_found', 'Pick a gym.', { gymId: input.gymId })
  }
  if (input.programDayId !== null && typeof input.programDayId !== 'string') {
    throw new ServiceError('day_not_found', 'Pick a program day.', {
      programDayId: input.programDayId,
    })
  }
  if (input.isDeload !== undefined && typeof input.isDeload !== 'boolean') {
    throw new ServiceError('invalid_deload', 'Deload must be yes or no.', {
      isDeload: input.isDeload,
    })
  }
  if (input.bodyweightLb !== undefined) assertKnownBodyweight(input.bodyweightLb)
}

/**
 * Set the in-progress session's bodyweight: the logger's fix for a missing or wrong value. It
 * becomes a manual bodyweight. Snapshots never change, so a row's 'no_bodyweight' notice stays;
 * it only matters while the session's bodyweight is still null.
 */
export async function setSessionBodyweight(
  ctx: ServiceCtx,
  sessionId: string,
  weightLb: number,
): Promise<void> {
  assertKnownBodyweight(weightLb)
  const { db } = ctx
  await db.transaction('rw', db.sessions, async () => {
    assertCanLog(requireSession(await db.sessions.get(sessionId), sessionId))
    // In-progress changes don't stamp editedAt: that marks changes made in Edit mode.
    await db.sessions.update(sessionId, { bodyweightLb: weightLb, bodyweightSource: 'manual' })
  })
}

// ── Sets ─────────────────────────────────────────────────────────────────────

export interface LogSetInput {
  sessionExerciseId: string
  /** Per hand/limb as written; the added load for bodyweight-plus (may be ≤ 0 when assisted). */
  loadLb: number
  reps: number
  rir?: number | null
  isWarmup?: boolean
  note?: string
}

/** Log a set against an exercise of the in-progress session. Returns the new set id. */
export async function logSet(ctx: ServiceCtx, input: LogSetInput): Promise<string> {
  const { db } = ctx
  const rir = input.rir ?? null
  assertReps(input.reps)
  assertRir(rir)
  checkSetPatch({ isWarmup: input.isWarmup, note: input.note })
  const id = ctx.newId()
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.sessionExercises, db.setLogs], async () => {
    const se = requireSessionExercise(
      await db.sessionExercises.get(input.sessionExerciseId),
      input.sessionExerciseId,
    )
    const session = requireSession(await db.sessions.get(se.sessionId), se.sessionId)
    assertCanLog(session)
    assertLoad(input.loadLb, se.loadType)
    const existing = await db.setLogs.where('sessionExerciseId').equals(se.id).toArray()
    await db.setLogs.add(
      buildSetLog({ ...input, rir }, { id, se, setIndex: nextSetIndex(existing), loggedAt: now }),
    )
  })
  return id
}

/** Correct a set of the in-progress session (load, reps, RIR, warm-up flag, note). */
export async function updateSet(ctx: ServiceCtx, setId: string, patch: SetPatch): Promise<void> {
  const { db } = ctx
  const p = checkSetPatch(patch)
  if (p.reps !== undefined) assertReps(p.reps)
  if (p.rir !== undefined) assertRir(p.rir)
  await db.transaction('rw', [db.sessions, db.sessionExercises, db.setLogs], async () => {
    const { set, se } = await loadSetForLogger(ctx, setId)
    assertSetNotVoided(set)
    assertSetValues({ ...set, ...p }, se.loadType)
    // In-progress corrections don't stamp editedAt: that marks changes made in Edit mode.
    if (Object.keys(p).length > 0) await db.setLogs.update(set.id, p)
  })
}

/** Delete (soft-void) a set of the in-progress session. Its setIndex is never reused. */
export async function voidSet(ctx: ServiceCtx, setId: string): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.sessionExercises, db.setLogs], async () => {
    const { set } = await loadSetForLogger(ctx, setId)
    assertSetNotVoided(set)
    await db.setLogs.update(set.id, { voidedAt: now })
  })
}

/** A set, its session exercise and session, checked to belong together and be loggable. */
async function loadSetForLogger(ctx: Pick<ServiceCtx, 'db'>, setId: string) {
  const { db } = ctx
  const set = requireSet(await db.setLogs.get(setId), setId)
  const se = requireSessionExercise(
    await db.sessionExercises.get(set.sessionExerciseId),
    set.sessionExerciseId,
  )
  const session = requireSession(await db.sessions.get(set.sessionId), set.sessionId)
  assertSetOf(set, se, session)
  assertCanLog(session)
  return { set, se, session }
}

/** A new set row (shared with Edit mode's addSet). */
export function buildSetLog(
  v: Pick<LogSetInput, 'loadLb' | 'reps' | 'isWarmup' | 'note'> & { rir: number | null },
  meta: {
    id: string
    se: SessionExercise
    setIndex: number
    loggedAt: number
    editedAt?: number | null
  },
): SetLog {
  return {
    id: meta.id,
    sessionId: meta.se.sessionId,
    sessionExerciseId: meta.se.id,
    exerciseId: meta.se.exerciseId,
    setIndex: meta.setIndex,
    loadLb: v.loadLb,
    reps: v.reps,
    rir: v.rir,
    isWarmup: v.isWarmup ?? false,
    note: v.note ?? '',
    loggedAt: meta.loggedAt,
    editedAt: meta.editedAt ?? null,
    voidedAt: null,
  }
}

// ── Exercises ────────────────────────────────────────────────────────────────

/**
 * One-off swap of a session exercise that has no sets yet (G6). The row is replaced (new id, same
 * order and slot). A slot row keeps the slot's regime and gets the new exercise's own track
 * suggestion; an ad hoc row is rebuilt like `addExercise`. Swapping back to the planned exercise
 * restores the plain row. The new exercise can't already fill another row of the session
 * ('exercise_in_session'): tracks and series count one entry per row, so a duplicate would count
 * one session twice. Returns the new session exercise id.
 *
 * The row's voided sets are hard-deleted with it. This is the one exception to soft deletes:
 * sets voided while the session is still in progress are scratch data, not history (DESIGN, lead
 * changes). Once the session is finished, sets are only ever voided.
 */
export async function swapExercise(
  ctx: ServiceCtx,
  sessionExerciseId: string,
  newExerciseId: string,
): Promise<string> {
  const { db } = ctx
  const model = await loadTrainingModel(ctx)
  const se = requireSessionExercise(
    model.data.sessionExercises.find((x) => x.id === sessionExerciseId),
    sessionExerciseId,
  )
  const session = requireSession(
    model.data.sessions.find((s) => s.id === se.sessionId),
    se.sessionId,
  )
  assertCanLog(session)
  assertNoLoggedSets(se, model.data.setLogs)
  const exercise = requireActiveExercise(model.exercise(newExerciseId), newExerciseId)
  if (exercise.id === se.exerciseId) {
    throw new ServiceError('same_exercise', `${exercise.name} is already in this slot.`, {
      exerciseId: exercise.id,
    })
  }
  assertNotInSession(
    model.data.sessionExercises.filter((x) => x.sessionId === session.id),
    exercise,
    se.id,
  )

  const slot =
    se.slotId === null ? undefined : model.data.programSlots.find((s) => s.id === se.slotId)
  const identity = swapIdentity(se, slot, exercise.id)
  const now = ctx.now()
  const id = ctx.newId()
  let replacement: SessionExercise
  if (se.slotId !== null && session.programDayId !== null) {
    // The slot's regime as snapshotted (before any deload cut); the deload is re-applied below.
    const regime: Regime = { ...regimeOf(se.prescription), sets: se.prescription.setsBeforeDeload }
    const p = model.prescriptionFor({
      programDayId: session.programDayId,
      regime,
      exerciseId: exercise.id,
      gymId: session.gymId,
      isDeload: session.isDeload,
    })
    replacement = buildSnapshot(model, {
      id,
      sessionId: session.id,
      order: se.order,
      slotId: se.slotId,
      exercise,
      gymId: session.gymId,
      ...identity,
      regime,
      sets: p.sets,
      suggestion: suggestionOf(p),
      bodyweightLb: session.bodyweightLb,
      createdAt: now,
    })
  } else {
    replacement = adHocSnapshot(model, {
      id,
      session,
      order: se.order,
      exercise,
      ...identity,
      createdAt: now,
    })
  }

  await db.transaction('rw', [db.sessions, db.sessionExercises, db.setLogs], async () => {
    // Re-check under the write lock: still in progress, row still there, still no sets, and the
    // exercise not added elsewhere meanwhile.
    assertCanLog(requireSession(await db.sessions.get(session.id), session.id))
    const current = requireSessionExercise(await db.sessionExercises.get(se.id), se.id)
    assertNotInSession(
      await db.sessionExercises.where('sessionId').equals(session.id).toArray(),
      exercise,
      se.id,
    )
    const sets = await db.setLogs.where('sessionExerciseId').equals(se.id).toArray()
    assertNoLoggedSets(current, sets)
    // Only voided (scratch) sets are left: they go with the row (see the doc comment).
    await db.setLogs.bulkDelete(sets.map((s) => s.id))
    await db.sessionExercises.delete(se.id)
    await db.sessionExercises.add(replacement)
  })
  return id
}

/**
 * Add a library exercise (a finisher, or anything not on the day) at the end of the in-progress
 * session. Ad hoc rows are logged and count toward volume and strength series but are never
 * evaluated for progression (G4); their suggested load is the last non-deload working load of
 * the exercise's strength series at this gym scope, cut like a slot row in a deload session. An
 * exercise already in the session is refused ('exercise_in_session'): log it in its row.
 * Returns the new session exercise id.
 */
export async function addExercise(
  ctx: ServiceCtx,
  sessionId: string,
  exerciseId: string,
): Promise<string> {
  const { db } = ctx
  const model = await loadTrainingModel(ctx)
  const session = requireSession(
    model.data.sessions.find((s) => s.id === sessionId),
    sessionId,
  )
  assertCanLog(session)
  const exercise = requireActiveExercise(model.exercise(exerciseId), exerciseId)
  assertNotInSession(
    model.data.sessionExercises.filter((x) => x.sessionId === session.id),
    exercise,
    null,
  )
  const id = ctx.newId()
  const row = adHocSnapshot(model, {
    id,
    session,
    order: 0,
    exercise,
    swapKind: 'none',
    swappedFromExerciseId: null,
    createdAt: ctx.now(),
  })
  await db.transaction('rw', [db.sessions, db.sessionExercises], async () => {
    assertCanLog(requireSession(await db.sessions.get(sessionId), sessionId))
    const rows = await db.sessionExercises.where('sessionId').equals(sessionId).toArray()
    assertNotInSession(rows, exercise, null)
    const order = rows.reduce((next, r) => Math.max(next, r.order + 1), 0)
    await db.sessionExercises.add({ ...row, order })
  })
  return id
}

/**
 * Remove an exercise that has no sets from the in-progress session. Its voided (scratch) sets are
 * hard-deleted with it, as in `swapExercise`.
 */
export async function removeExercise(ctx: ServiceCtx, sessionExerciseId: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', [db.sessions, db.sessionExercises, db.setLogs], async () => {
    const se = requireSessionExercise(
      await db.sessionExercises.get(sessionExerciseId),
      sessionExerciseId,
    )
    assertCanLog(requireSession(await db.sessions.get(se.sessionId), se.sessionId))
    const sets = await db.setLogs.where('sessionExerciseId').equals(se.id).toArray()
    assertNoLoggedSets(se, sets)
    await db.setLogs.bulkDelete(sets.map((s) => s.id))
    await db.sessionExercises.delete(se.id)
  })
}

// ── Finish ───────────────────────────────────────────────────────────────────

export interface FinishSessionInput {
  /** Joints ached this session (feeds the deload trigger). */
  jointPain?: boolean
  note?: string
}

/** Finish the in-progress session: it becomes history and feeds the next suggestions. */
export async function finishSession(
  ctx: ServiceCtx,
  sessionId: string,
  input: FinishSessionInput = {},
): Promise<void> {
  if (input.jointPain !== undefined && typeof input.jointPain !== 'boolean') {
    throw new ServiceError('invalid_joint_pain', 'Joint pain must be yes or no.')
  }
  if (input.note !== undefined && typeof input.note !== 'string') {
    throw new ServiceError('invalid_note', 'The note must be text.')
  }
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.sessions, async () => {
    assertCanLog(requireSession(await db.sessions.get(sessionId), sessionId))
    await db.sessions.update(sessionId, {
      status: 'finished',
      finishedAt: now,
      ...(input.jointPain !== undefined && { jointPain: input.jointPain }),
      ...(input.note !== undefined && { note: input.note }),
    })
  })
}

/** Abandon the in-progress session: kept (and restorable in Edit mode) but never counted. */
export async function abandonSession(ctx: ServiceCtx, sessionId: string): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.sessions, async () => {
    assertCanLog(requireSession(await db.sessions.get(sessionId), sessionId))
    await db.sessions.update(sessionId, { status: 'abandoned', finishedAt: now })
  })
}

// ── Snapshot building ────────────────────────────────────────────────────────

interface SnapshotArgs {
  id: string
  sessionId: string
  order: number
  slotId: string | null
  exercise: Exercise
  gymId: string
  swapKind: SwapKind
  swappedFromExerciseId: string | null
  /** The regime before any deload cut. */
  regime: Regime
  /** Sets actually prescribed (fewer in a deload). */
  sets: number
  suggestion: SessionSuggestion
  /** The session's bodyweight: a bodyweight-plus row without one gets a 'no_bodyweight' notice. */
  bodyweightLb: number | null
  createdAt: number
}

/** The immutable prescription snapshot of one session exercise. */
function buildSnapshot(model: TrainingModel, a: SnapshotArgs): SessionExercise {
  const { exercise } = a
  // Without a bodyweight a bodyweight-plus set has no e1RM: the logger asks for one.
  const suggestion: SessionSuggestion =
    exercise.loadType === 'bodyweight_plus' && a.bodyweightLb === null
      ? { ...a.suggestion, notices: [...a.suggestion.notices, { code: 'no_bodyweight' }] }
      : a.suggestion
  return {
    id: a.id,
    sessionId: a.sessionId,
    order: a.order,
    slotId: a.slotId,
    adHoc: a.slotId === null,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    loadType: exercise.loadType,
    perHand: exercise.perHand,
    unilateral: exercise.unilateral,
    equipmentSpecific: exercise.equipmentSpecific,
    gymScope: model.scopeFor(exercise.id, a.gymId),
    isMainLift: exercise.isMainLift,
    isFinisher: exercise.isFinisher,
    swappedFromExerciseId: a.swappedFromExerciseId,
    swapKind: a.swapKind,
    prescription: {
      ...regimeOf(a.regime),
      sets: a.sets,
      setsBeforeDeload: a.regime.sets,
      stepLb: model.stepFor(exercise.id, a.gymId),
    },
    muscleWeights: { ...exercise.muscleWeights },
    suggestion,
    createdAt: a.createdAt,
  }
}

/**
 * An ad hoc row: the exercise's default regime and its series' last working load. In a deload
 * session it gets the same cut as a slot row (deloadPrescription): ceil(sets × fraction) sets and
 * a whole-step lighter load (a 0% cut keeps the load).
 */
function adHocSnapshot(
  model: TrainingModel,
  a: {
    id: string
    session: Session
    order: number
    exercise: Exercise
    swapKind: SwapKind
    swappedFromExerciseId: string | null
    createdAt: number
  },
): SessionExercise {
  const { exercise, session } = a
  const regime = exercise.defaultRegime
  const plain: NextPrescription = {
    loadLb: lastWorkingLoad(model, exercise.id, session.gymId),
    repTargets: Array.from({ length: regime.sets }, () => regime.repMin),
    sets: regime.sets,
    branch: 'start',
    missStreakBefore: 0,
    isCalibration: false,
    notices: [],
  }
  const p = session.isDeload
    ? deloadPrescription(
        plain,
        regime,
        model.stepFor(exercise.id, session.gymId),
        exercise.loadType,
        model.settings,
      )
    : plain
  return buildSnapshot(model, {
    id: a.id,
    sessionId: session.id,
    order: a.order,
    slotId: null,
    exercise,
    gymId: session.gymId,
    swapKind: a.swapKind,
    swappedFromExerciseId: a.swappedFromExerciseId,
    regime,
    sets: p.sets,
    suggestion: suggestionOf(p),
    bodyweightLb: session.bodyweightLb,
    createdAt: a.createdAt,
  })
}

/**
 * The most recent working-set load of an exercise's strength series at a gym, if any. Deload
 * sessions are skipped: their loads are cut by design.
 */
function lastWorkingLoad(model: TrainingModel, exerciseId: string, gymId: string): number | null {
  const sessions = model.seriesSessions(exerciseId, model.scopeFor(exerciseId, gymId))
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i]!.isDeload) continue
    const last = sessions[i]!.sets.at(-1)
    if (last) return last.loadLb
  }
  return null
}

/**
 * Swap kind of a row after a one-off swap. The row's planned exercise is what the session started
 * with (the one swapped away from, if already swapped); choosing it again restores the plain row,
 * a gym override when it differs from the slot's default.
 */
function swapIdentity(
  se: SessionExercise,
  slot: ProgramSlot | undefined,
  newExerciseId: string,
): { swapKind: SwapKind; swappedFromExerciseId: string | null } {
  const planned =
    se.swapKind === 'one_off' && se.swappedFromExerciseId !== null
      ? se.swappedFromExerciseId
      : se.exerciseId
  if (newExerciseId !== planned) return { swapKind: 'one_off', swappedFromExerciseId: planned }
  if (slot && planned !== slot.defaultExerciseId) {
    return { swapKind: 'gym_override', swappedFromExerciseId: slot.defaultExerciseId }
  }
  return { swapKind: 'none', swappedFromExerciseId: null }
}

function suggestionOf(p: NextPrescription): SessionSuggestion {
  return {
    loadLb: p.loadLb,
    repTargets: [...p.repTargets],
    branch: p.branch,
    missStreakBefore: p.missStreakBefore,
    isCalibration: p.isCalibration,
    notices: p.notices.map((n) => ({ ...n })),
  }
}

function regimeOf(r: Regime): Regime {
  return {
    sets: r.sets,
    repMin: r.repMin,
    repMax: r.repMax,
    rirMin: r.rirMin,
    rirMax: r.rirMax,
    restMinSec: r.restMinSec,
    restMaxSec: r.restMaxSec,
  }
}

/**
 * A session holds an exercise at most once (a row other than `exceptRowId` is refused): the
 * training model replays one track or series entry per row, so a duplicate would count one
 * session twice (a single session's misses could trigger the two-miss drop).
 */
function assertNotInSession(
  rows: readonly SessionExercise[],
  exercise: Exercise,
  exceptRowId: string | null,
): void {
  const other = rows.find((r) => r.exerciseId === exercise.id && r.id !== exceptRowId)
  if (other) {
    throw new ServiceError(
      'exercise_in_session',
      `${exercise.name} is already in this session. Log it in its row.`,
      { exerciseId: exercise.id, sessionExerciseId: other.id },
    )
  }
}

function requireActiveExercise(e: Exercise | undefined, id: string): Exercise {
  if (!e) {
    throw new ServiceError('exercise_not_found', 'That exercise is not in the library.', {
      exerciseId: id,
    })
  }
  if (e.archivedAt !== null) {
    throw new ServiceError('exercise_archived', `${e.name} is archived.`, { exerciseId: id })
  }
  return e
}

function inProgressError(sessionId: string): ServiceError {
  return new ServiceError(
    'session_in_progress',
    'A session is already in progress. Finish or abandon it first.',
    { sessionId },
  )
}
