// Views of one session: the logger, the post-session summary, the history list and the read-only
// history detail. Results and next suggestions come from replaying history (TrainingModel); a
// session's own numbers come from its immutable snapshot rows.
import type { DeloadReason } from '@/domain/deload'
import { compareMetric } from '@/domain/e1rm'
import type {
  Branch,
  LoadType,
  LocalDate,
  Notice,
  Session,
  SessionExercise,
  SessionPrescription,
  SessionResult,
  SessionStatus,
  SessionSuggestion,
  SetLog,
  SwapKind,
} from '@/domain/types'
import { countWorkingSets, loggedSessionVolume, overSessionCap } from '@/domain/volume'
import type { ServiceCtx } from '../../context'
import { isCountedSession, type TrainingModel } from '../model'
import {
  badgeFor,
  bestSetOf,
  compareSessions,
  dayNameOf,
  deloadView,
  gymNameOf,
  isTracked,
  loadQueryData,
  metricBasis,
  muscleRows,
  openStallViews,
  scopeOf,
  type BestSet,
  type MuscleSets,
  type PrescriptionBadge,
  type QueryData,
  type StallView,
} from './shared'

// ── Logger ───────────────────────────────────────────────────────────────────

export interface SetView {
  id: string
  setIndex: number
  loadLb: number
  reps: number
  rir: number | null
  isWarmup: boolean
  note: string
  loggedAt: number
  edited: boolean
}

export interface LastTimeView {
  sessionId: string
  date: LocalDate
  isDeload: boolean
  /** Working sets, by setIndex. */
  sets: { setIndex: number; loadLb: number; reps: number; rir: number | null }[]
}

export interface LoggerExerciseView {
  sessionExerciseId: string
  order: number
  slotId: string | null
  adHoc: boolean
  exerciseId: string
  exerciseName: string
  loadType: LoadType
  perHand: boolean
  unilateral: boolean
  isMainLift: boolean
  isFinisher: boolean
  swapKind: SwapKind
  swappedFromExerciseId: string | null
  prescription: SessionPrescription
  suggestion: SessionSuggestion
  badge: PrescriptionBadge
  restMinSec: number
  restMaxSec: number
  /** Non-voided sets by setIndex, warm-ups included (flagged). */
  sets: SetView[]
  workingSetCount: number
  /** Working sets ≥ prescribed sets. */
  done: boolean
  /** The most recent earlier counted session of the same track (same series when ad hoc). */
  lastTime: LastTimeView | null
}

export interface LoggerView {
  session: Session
  dayName: string
  gymName: string
  exercises: LoggerExerciseView[]
  workingSetCount: number
  prescribedSetCount: number
}

/** The logger screen for a session; null if it doesn't exist. */
export async function getLoggerView(
  ctx: Pick<ServiceCtx, 'db'>,
  sessionId: string,
): Promise<LoggerView | null> {
  const q = await loadQueryData(ctx)
  const session = q.index.sessions.get(sessionId)
  return session ? buildLoggerView(q, session) : null
}

function buildLoggerView(q: QueryData, session: Session): LoggerView {
  const exercises = q.index.exercisesOf(session.id).map((se): LoggerExerciseView => {
    const sets = q.index.liveSetsOf(se.id)
    const workingSetCount = sets.filter((s) => !s.isWarmup).length
    return {
      sessionExerciseId: se.id,
      order: se.order,
      slotId: se.slotId,
      adHoc: se.adHoc,
      exerciseId: se.exerciseId,
      exerciseName: se.exerciseName,
      loadType: se.loadType,
      perHand: se.perHand,
      unilateral: se.unilateral,
      isMainLift: se.isMainLift,
      isFinisher: se.isFinisher,
      swapKind: se.swapKind,
      swappedFromExerciseId: se.swappedFromExerciseId,
      prescription: se.prescription,
      suggestion: se.suggestion,
      badge: badgeFor(se.suggestion),
      restMinSec: se.prescription.restMinSec,
      restMaxSec: se.prescription.restMaxSec,
      sets: sets.map(setView),
      workingSetCount,
      done: workingSetCount >= se.prescription.sets,
      lastTime: lastTimeFor(q, session, se),
    }
  })
  return {
    session,
    dayName: dayNameOf(q.data.programDays, session.programDayId),
    gymName: gymNameOf(q.gyms, session.gymId),
    exercises,
    workingSetCount: exercises.reduce((n, e) => n + e.workingSetCount, 0),
    prescribedSetCount: exercises.reduce((n, e) => n + e.prescription.sets, 0),
  }
}

function setView(s: SetLog): SetView {
  return {
    id: s.id,
    setIndex: s.setIndex,
    loadLb: s.loadLb,
    reps: s.reps,
    rir: s.rir,
    isWarmup: s.isWarmup,
    note: s.note,
    loggedAt: s.loggedAt,
    edited: s.editedAt !== null,
  }
}

/**
 * The latest counted session before this one where the same track (program day, exercise, gym
 * scope) logged working sets. Ad hoc exercises and finishers have no track, so they match any
 * earlier session of the same series (exercise, gym scope).
 */
function lastTimeFor(q: QueryData, session: Session, se: SessionExercise): LastTimeView | null {
  const tracked = isTracked(session, se)
  const scope = scopeOf(q.model, se.exerciseId, session.gymId)
  const counted = q.index.counted
  for (let i = counted.length - 1; i >= 0; i--) {
    const earlier = counted[i] as Session
    if (compareSessions(earlier, session) >= 0) continue
    if (tracked && earlier.programDayId !== session.programDayId) continue
    if (scopeOf(q.model, se.exerciseId, earlier.gymId) !== scope) continue
    for (const other of q.index.exercisesOf(earlier.id)) {
      if (other.exerciseId !== se.exerciseId) continue
      if (tracked && !isTracked(earlier, other)) continue
      const sets = q.index.workingSetsOf(other.id)
      if (sets.length === 0) continue
      return {
        sessionId: earlier.id,
        date: earlier.date,
        isDeload: earlier.isDeload,
        sets: sets.map((s) => ({
          setIndex: s.setIndex,
          loadLb: s.loadLb,
          reps: s.reps,
          rir: s.rir,
        })),
      }
    }
  }
  return null
}

// ── Summary ──────────────────────────────────────────────────────────────────

/**
 * What happened to an exercise: the flowchart branch (step / +1 rep / miss / drop), a finished
 * calibration, no working sets (skipped), a deload session, or no progression track (ad hoc
 * sessions and exercises, finishers, and sessions that aren't counted).
 */
export type ExerciseOutcome =
  'step' | 'plus_rep' | 'miss' | 'drop' | 'calibrated' | 'skipped' | 'not_tracked' | 'deload'

export interface NextSuggestionView {
  loadLb: number | null
  repTargets: number[]
  sets: number
  branch: Branch
  /**
   * The next session is a deload session: a deload is running, or (when superseded) the track's
   * next session was one.
   */
  isDeload: boolean
  badge: PrescriptionBadge
  /**
   * A later counted session of the same track exists: this is what followed this session then,
   * not what the track suggests now.
   */
  superseded: boolean
}

export interface SummaryExerciseView {
  sessionExerciseId: string
  exerciseId: string
  exerciseName: string
  loadType: LoadType
  perHand: boolean
  isFinisher: boolean
  outcome: ExerciseOutcome
  /** Misses in a row after this session ("Miss 1 of 2"); 0 unless the outcome is a miss. */
  missStreak: number
  /** The load the flowchart evaluated (the lowest working load), or null. */
  baseLb: number | null
  notices: Notice[]
  workingSetCount: number
  prescribedSets: number
  /**
   * The suggestion that followed this session on its track (history replayed up to and including
   * it; null when it has no track).
   */
  next: NextSuggestionView | null
  bestSet: BestSet | null
  /** The session's metric beat every earlier point of the exercise's strength series. */
  isPr: boolean
}

export interface SessionVolumeView {
  /** Fractional sets per muscle, in muscle order. */
  byMuscle: MuscleSets[]
  totalSets: number
  sessionCap: number
  /** Muscles strictly over the per-session cap. */
  overCap: MuscleSets[]
}

export interface SessionSummaryView {
  sessionId: string
  date: LocalDate
  dayName: string
  gymName: string
  status: SessionStatus
  isDeload: boolean
  /** Finished and not voided: only counted sessions are evaluated. */
  counted: boolean
  missesBeforeDrop: number
  exercises: SummaryExerciseView[]
  volume: SessionVolumeView
  /**
   * Current stall flags of this session's exercises (at this session's gym scope), leaving out
   * stalls answered in the suggestion log.
   */
  stalls: StallView[]
  /** A deload to suggest now (null when none is triggered, one is running, or it was answered). */
  deloadSuggestion: { reasons: DeloadReason[]; fingerprint: string } | null
}

/** The post-session summary; null if the session doesn't exist. */
export async function getSessionSummary(
  ctx: Pick<ServiceCtx, 'db'>,
  sessionId: string,
): Promise<SessionSummaryView | null> {
  const q = await loadQueryData(ctx)
  const session = q.index.sessions.get(sessionId)
  return session ? buildSummary(q, session) : null
}

function buildSummary(q: QueryData, session: Session): SessionSummaryView {
  const { model } = q
  const counted = isCountedSession(session)
  const results = model.sessionResults(session.id)
  const deload = deloadView(model)
  const sessionExercises = q.index.exercisesOf(session.id)

  const exercises = sessionExercises.map((se) =>
    summarizeExercise(q, session, se, results.get(se.id), counted, deload.active),
  )

  const volume = loggedSessionVolume(
    sessionExercises,
    countWorkingSets(q.index.setsOfSession(session.id)),
  )
  const cap = model.settings.sessionCap

  const inSession = new Set(
    sessionExercises.map(
      (se) => `${se.exerciseId}|${scopeOf(model, se.exerciseId, session.gymId)}`,
    ),
  )
  const stalls = openStallViews(q, model, (f) => inSession.has(`${f.exerciseId}|${f.scope}`))

  return {
    sessionId: session.id,
    date: session.date,
    dayName: dayNameOf(q.data.programDays, session.programDayId),
    gymName: gymNameOf(q.gyms, session.gymId),
    status: session.status,
    isDeload: session.isDeload,
    counted,
    missesBeforeDrop: model.settings.missesBeforeDrop,
    exercises,
    volume: {
      byMuscle: muscleRows(volume.byMuscle, q.muscles),
      totalSets: volume.totalSets,
      sessionCap: cap,
      overCap: muscleRows(volume.byMuscle, q.muscles, overSessionCap(volume.byMuscle, cap)),
    },
    stalls,
    deloadSuggestion:
      deload.suggested && deload.fingerprint !== null
        ? { reasons: deload.reasons, fingerprint: deload.fingerprint }
        : null,
  }
}

function summarizeExercise(
  q: QueryData,
  session: Session,
  se: SessionExercise,
  result: SessionResult | undefined,
  counted: boolean,
  deloadActive: boolean,
): SummaryExerciseView {
  const { model } = q
  const working = q.index.workingSetsOf(se.id)
  const scope = scopeOf(model, se.exerciseId, session.gymId)
  const tracked = counted && isTracked(session, se) && result !== undefined
  const outcome: ExerciseOutcome =
    working.length === 0
      ? 'skipped'
      : !tracked
        ? 'not_tracked'
        : session.isDeload
          ? 'deload'
          : outcomeOf(result.branch)

  return {
    sessionExerciseId: se.id,
    exerciseId: se.exerciseId,
    exerciseName: se.exerciseName,
    loadType: se.loadType,
    perHand: se.perHand,
    isFinisher: se.isFinisher,
    outcome,
    missStreak: outcome === 'miss' && result ? result.missStreakAfter : 0,
    baseLb: result?.baseLb ?? null,
    notices: result ? [...result.notices] : [],
    workingSetCount: working.length,
    prescribedSets: se.prescription.sets,
    next: tracked ? nextFor(model, session, se, deloadActive) : null,
    bestSet: bestSetOf(working, metricBasis(model, se), {
      loadType: se.loadType,
      bodyweightLb: session.bodyweightLb,
    }),
    isPr:
      counted && model.exercise(se.exerciseId)
        ? isPr(model, se.exerciseId, scope, session.id)
        : false,
  }
}

function outcomeOf(branch: Branch): ExerciseOutcome {
  switch (branch) {
    case 'step':
      return 'step'
    case 'same_plus_rep':
      return 'plus_rep'
    case 'same_after_miss':
      return 'miss'
    case 'drop':
      return 'drop'
    case 'calibration':
    case 'calibrated':
      return 'calibrated'
    case 'start':
      return 'not_tracked'
  }
}

/**
 * The suggestion that followed this session on its track: the track replayed up to and including
 * it, with the slot's current regime (null if the slot is gone). When a later counted session of
 * the track exists the view is `superseded`, and that session says whether the next one was a
 * deload; otherwise the running deload does.
 */
function nextFor(
  model: TrainingModel,
  session: Session,
  se: SessionExercise,
  deloadActive: boolean,
): NextSuggestionView | null {
  if (session.programDayId === null || !model.exercise(se.exerciseId)) return null
  const slot = model.slotsOf(session.programDayId).find((s) => s.id === se.slotId)
  if (!slot) return null
  const scope = model.scopeFor(se.exerciseId, session.gymId)
  const later = model
    .trackHistory(session.programDayId, se.exerciseId, scope)
    .find((t) => compareSessions(t, session) > 0)
  const isDeload = later ? later.isDeload : deloadActive
  const p = model.prescriptionAfter(
    {
      programDayId: session.programDayId,
      regime: slot,
      exerciseId: se.exerciseId,
      gymId: session.gymId,
      isDeload,
    },
    session,
  )
  return {
    loadLb: p.loadLb,
    repTargets: p.repTargets,
    sets: p.sets,
    branch: p.branch,
    isDeload,
    badge: badgeFor(p),
    superseded: later !== undefined,
  }
}

/** The session's series point beats every earlier point (a first-ever point is not a PR). */
function isPr(model: TrainingModel, exerciseId: string, scope: string, sessionId: string): boolean {
  const points = model.series(exerciseId, scope)
  const i = points.findIndex((p) => p.sessionId === sessionId)
  const point = points[i]
  if (i <= 0 || !point) return false
  return points.slice(0, i).every((p) => compareMetric(point.value, p.value) > 0)
}

// ── History ──────────────────────────────────────────────────────────────────

export interface SessionListItem {
  id: string
  date: LocalDate
  startedAt: number
  programDayId: string | null
  /** The program day's name, or 'Ad hoc'. */
  dayName: string
  gymName: string
  status: SessionStatus
  isDeload: boolean
  /** Non-voided, non-warm-up sets. */
  workingSets: number
  voided: boolean
  edited: boolean
}

/** Sessions, newest first. Voided sessions are left out unless `includeVoided`. */
export async function listSessions(
  ctx: Pick<ServiceCtx, 'db'>,
  { limit, includeVoided = false }: { limit?: number; includeVoided?: boolean } = {},
): Promise<SessionListItem[]> {
  const { db } = ctx
  const { sessions, setLogs, programDays, gyms } = await db.transaction(
    'r',
    [db.sessions, db.setLogs, db.programDays, db.gyms],
    async () => ({
      sessions: await db.sessions.toArray(),
      setLogs: await db.setLogs.toArray(),
      programDays: await db.programDays.toArray(),
      gyms: await db.gyms.toArray(),
    }),
  )
  const workingBySession = new Map<string, number>()
  for (const s of setLogs) {
    if (s.isWarmup || s.voidedAt !== null) continue
    workingBySession.set(s.sessionId, (workingBySession.get(s.sessionId) ?? 0) + 1)
  }
  const list = sessions
    .filter((s) => includeVoided || s.voidedAt === null)
    .sort((a, b) => compareSessions(b, a))
    .map((s): SessionListItem => ({
      id: s.id,
      date: s.date,
      startedAt: s.startedAt,
      programDayId: s.programDayId,
      dayName: dayNameOf(programDays, s.programDayId),
      gymName: gymNameOf(gyms, s.gymId),
      status: s.status,
      isDeload: s.isDeload,
      workingSets: workingBySession.get(s.id) ?? 0,
      voided: s.voidedAt !== null,
      edited: s.editedAt !== null,
    }))
  return limit === undefined ? list : list.slice(0, Math.max(0, limit))
}

export type SessionDetailExerciseView = LoggerExerciseView & {
  result: SummaryExerciseView
  /** Deleted (voided) sets by setIndex, for Edit mode to list and restore (restoreSet). */
  voidedSets: SetView[]
}

export interface SessionDetailView extends Omit<LoggerView, 'exercises'> {
  exercises: SessionDetailExerciseView[]
  counted: boolean
  voided: boolean
  edited: boolean
  missesBeforeDrop: number
  volume: SessionVolumeView
}

/**
 * History detail (and the Edit-mode screen): the logged sets, the deleted ones, and each
 * exercise's result; null if missing.
 */
export async function getSessionDetail(
  ctx: Pick<ServiceCtx, 'db'>,
  sessionId: string,
): Promise<SessionDetailView | null> {
  const q = await loadQueryData(ctx)
  const session = q.index.sessions.get(sessionId)
  if (!session) return null
  const logger = buildLoggerView(q, session)
  const summary = buildSummary(q, session)
  const results = new Map(summary.exercises.map((e) => [e.sessionExerciseId, e]))
  return {
    ...logger,
    exercises: logger.exercises.map((e) => ({
      ...e,
      result: results.get(e.sessionExerciseId) as SummaryExerciseView,
      voidedSets: q.index
        .setsOf(e.sessionExerciseId)
        .filter((s) => s.voidedAt !== null)
        .map(setView),
    })),
    counted: summary.counted,
    voided: session.voidedAt !== null,
    edited: session.editedAt !== null,
    missesBeforeDrop: summary.missesBeforeDrop,
    volume: summary.volume,
  }
}
