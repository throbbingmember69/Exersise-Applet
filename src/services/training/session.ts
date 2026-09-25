// Logger commands for the one in-progress session: start it (writing its immutable prescription
// snapshots), log, correct and void sets, swap, add and remove exercises before they have sets,
// and finish or abandon it. Finished and abandoned sessions change only through Edit mode
// (edit.ts); the rules are enforced by db/guards.ts.
//
// Suggestions are computed by replaying history through the training model and frozen into each
// session exercise's snapshot when the session starts. They are never read back by the engine;
// the next session's suggestion is re-derived from the logged sets.
import {
  assertBodyweight,
  assertCanLog,
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
import { bodyweightOn, buildTrend } from '@/domain/trend'
import type {
  BodyweightSource,
  Exercise,
  LocalDate,
  NextPrescription,
  ProgramSlot,
  Regime,
  Session,
  SessionExercise,
  SessionSuggestion,
  SetLog,
  Settings,
  SwapKind,
} from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { loadTrainingModel, type TrainingModel } from './model'

/** appState key of the gym the last session was started at (the start sheet's default). */
export const LAST_GYM_ID_KEY = 'lastGymId'

// ── Start ────────────────────────────────────────────────────────────────────

export interface StartSessionInput {
  gymId: string
  /** null = ad hoc session: no program day, no exercises until added. */
  programDayId: string | null
  /** Defaults to whether an accepted deload is running. */
  isDeload?: boolean
  /** Explicit bodyweight (source 'manual'); otherwise same-day weigh-in → trend → seed. */
  bodyweightLb?: number
}

/**
 * Start a session and snapshot every active slot of its program day, with the suggestion the
 * flowchart gives for the slot's exercise at this gym. Returns the new session id.
 */
export async function startSession(ctx: ServiceCtx, input: StartSessionInput): Promise<string> {
  const { db } = ctx
  if (input.bodyweightLb !== undefined) assertBodyweight(input.bodyweightLb)

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
  const isDeload = input.isDeload ?? model.deloadState().status.active
  const bodyweight =
    input.bodyweightLb !== undefined
      ? { weightLb: input.bodyweightLb, source: 'manual' as const }
      : await resolveBodyweight(ctx, model.settings, date)

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

/**
 * Bodyweight for a new session: the same-day weigh-in, else the trend weight (or the seed
 * baseline before any weigh-in), else unknown (null, for the lifter to enter).
 */
async function resolveBodyweight(
  ctx: Pick<ServiceCtx, 'db'>,
  settings: Settings,
  date: LocalDate,
): Promise<{ weightLb: number | null; source: BodyweightSource }> {
  const entries = await ctx.db.bodyEntries.toArray()
  for (const e of entries) {
    const w = e.weightLb
    if (e.date !== date || e.source !== 'user' || e.voidedAt !== null || w === null) continue
    if (Number.isFinite(w) && w > 0) return { weightLb: w, source: 'weighin' }
  }
  const bw = bodyweightOn(buildTrend(entries, settings), entries, date)
  return bw ? { weightLb: bw.weightLb, source: bw.source } : { weightLb: null, source: 'manual' }
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
 * order and slot) and its voided sets are dropped: in-progress data isn't history yet. A slot row
 * keeps the slot's regime and gets the new exercise's own track suggestion; an ad hoc row is
 * rebuilt like `addExercise`. Swapping back to the planned exercise restores the plain row.
 * Returns the new session exercise id.
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
    // Re-check under the write lock: still in progress, row still there, still no sets.
    assertCanLog(requireSession(await db.sessions.get(session.id), session.id))
    const current = requireSessionExercise(await db.sessionExercises.get(se.id), se.id)
    const sets = await db.setLogs.where('sessionExerciseId').equals(se.id).toArray()
    assertNoLoggedSets(current, sets)
    await db.setLogs.bulkDelete(sets.map((s) => s.id))
    await db.sessionExercises.delete(se.id)
    await db.sessionExercises.add(replacement)
  })
  return id
}

/**
 * Add a library exercise (a finisher, or anything not on the day) at the end of the in-progress
 * session. Ad hoc rows are logged and count toward volume and strength series but are never
 * evaluated for progression (G4); their suggested load is the last working load of the
 * exercise's strength series at this gym scope. Returns the new session exercise id.
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
    const order = rows.reduce((next, r) => Math.max(next, r.order + 1), 0)
    await db.sessionExercises.add({ ...row, order })
  })
  return id
}

/** Remove an exercise that has no sets from the in-progress session. */
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
  createdAt: number
}

/** The immutable prescription snapshot of one session exercise. */
function buildSnapshot(model: TrainingModel, a: SnapshotArgs): SessionExercise {
  const { exercise } = a
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
    suggestion: a.suggestion,
    createdAt: a.createdAt,
  }
}

/** An ad hoc row: the exercise's default regime and its series' last working load. */
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
  const regime = a.exercise.defaultRegime
  return buildSnapshot(model, {
    id: a.id,
    sessionId: a.session.id,
    order: a.order,
    slotId: null,
    exercise: a.exercise,
    gymId: a.session.gymId,
    swapKind: a.swapKind,
    swappedFromExerciseId: a.swappedFromExerciseId,
    regime,
    sets: regime.sets,
    suggestion: {
      loadLb: lastWorkingLoad(model, a.exercise.id, a.session.gymId),
      repTargets: Array.from({ length: regime.sets }, () => regime.repMin),
      branch: 'start',
      missStreakBefore: 0,
      isCalibration: false,
      notices: [],
    },
    createdAt: a.createdAt,
  })
}

/** The most recent working-set load of an exercise's strength series at a gym, if any. */
function lastWorkingLoad(model: TrainingModel, exerciseId: string, gymId: string): number | null {
  const sessions = model.seriesSessions(exerciseId, model.scopeFor(exerciseId, gymId))
  for (let i = sessions.length - 1; i >= 0; i--) {
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
