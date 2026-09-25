// Shared plumbing for the training read side: one consistent read of everything the views need,
// history indexes, as-of models, and small view helpers. Query functions run inside
// dexie-react-hooks `useLiveQuery`, so this module only awaits Dexie reads and never writes.
import { compareLocalDate } from '@/domain/dates'
import type { DeloadReason } from '@/domain/deload'
import { compareMetric, sessionMetric, type MetricKind, type MetricValue } from '@/domain/e1rm'
import { gymScope } from '@/domain/progression/keys'
import type {
  Gym,
  GymScope,
  LoadType,
  LocalDate,
  Muscle,
  MuscleId,
  ProgramDay,
  Session,
  SessionExercise,
  SetLog,
} from '@/domain/types'
import { SHARED_GYM_SCOPE } from '@/domain/types'
import type { ServiceCtx } from '../../context'
import { getAppState } from '../../settings'
import {
  isCountedSession,
  loadTrainingData,
  TrainingModel,
  type StallFlag,
  type TrainingData,
} from '../model'

/** appState key of the gym used for the last session (written by the session commands). */
export const LAST_GYM_KEY = 'lastGymId'
/** Day label for sessions without a program day. */
export const AD_HOC_DAY_NAME = 'Ad hoc'
export const UNKNOWN_DAY_NAME = 'Unknown day'
export const UNKNOWN_GYM_NAME = 'Unknown gym'

/** Everything the training views read, from one read transaction. */
export interface QueryData {
  data: TrainingData
  /** Replays all counted history (use `modelAsOf` for date-bounded answers). */
  model: TrainingModel
  /** All gyms (archived included), by sortOrder. */
  gyms: readonly Gym[]
  /** All muscles (archived included), by sortOrder. */
  muscles: readonly Muscle[]
  /** Raw appState 'lastGymId' value (may be stale or missing). */
  lastGymSetting: unknown
  index: HistoryIndex
}

export async function loadQueryData(ctx: Pick<ServiceCtx, 'db'>): Promise<QueryData> {
  const { db } = ctx
  const raw = await db.transaction(
    'r',
    [
      db.settings,
      db.exercises,
      db.programDays,
      db.programSlots,
      db.gymSlotOverrides,
      db.gymExerciseSettings,
      db.trackStarts,
      db.sessions,
      db.sessionExercises,
      db.setLogs,
      db.suggestions,
      db.gyms,
      db.muscles,
      db.appState,
    ],
    async () => ({
      data: await loadTrainingData(ctx),
      gyms: await db.gyms.orderBy('sortOrder').toArray(),
      muscles: await db.muscles.orderBy('sortOrder').toArray(),
      lastGymSetting: await getAppState<unknown>(ctx, LAST_GYM_KEY),
    }),
  )
  return { ...raw, model: new TrainingModel(raw.data), index: new HistoryIndex(raw.data) }
}

/** (date, startedAt) order: the order history is replayed in. */
export function compareSessions(
  a: Pick<Session, 'date' | 'startedAt'>,
  b: Pick<Session, 'date' | 'startedAt'>,
): number {
  return compareLocalDate(a.date, b.date) || a.startedAt - b.startedAt
}

/** A model that only sees sessions dated on or before `asOf`. */
export function modelAsOf(data: TrainingData, asOf: LocalDate): TrainingModel {
  return new TrainingModel({
    ...data,
    sessions: data.sessions.filter((s) => compareLocalDate(s.date, asOf) <= 0),
  })
}

/** Lookups over logged history. */
export class HistoryIndex {
  readonly sessions: ReadonlyMap<string, Session>
  /** Counted sessions (finished, not voided), oldest first. */
  readonly counted: readonly Session[]
  private readonly exercisesBySession = new Map<string, SessionExercise[]>()
  private readonly setsBySessionExercise = new Map<string, SetLog[]>()

  constructor(data: TrainingData) {
    this.sessions = new Map(data.sessions.map((s) => [s.id, s]))
    this.counted = data.sessions.filter(isCountedSession).sort(compareSessions)
    for (const se of data.sessionExercises) {
      const list = this.exercisesBySession.get(se.sessionId) ?? []
      list.push(se)
      this.exercisesBySession.set(se.sessionId, list)
    }
    for (const list of this.exercisesBySession.values()) list.sort((a, b) => a.order - b.order)
    for (const set of data.setLogs) {
      const list = this.setsBySessionExercise.get(set.sessionExerciseId) ?? []
      list.push(set)
      this.setsBySessionExercise.set(set.sessionExerciseId, list)
    }
    for (const list of this.setsBySessionExercise.values()) {
      list.sort((a, b) => a.setIndex - b.setIndex || a.loggedAt - b.loggedAt)
    }
  }

  /** A session's exercises, in order. */
  exercisesOf(sessionId: string): readonly SessionExercise[] {
    return this.exercisesBySession.get(sessionId) ?? []
  }

  /** Every set of a session exercise (voided included), by setIndex. */
  setsOf(sessionExerciseId: string): readonly SetLog[] {
    return this.setsBySessionExercise.get(sessionExerciseId) ?? []
  }

  /** Non-voided sets (warm-ups included), by setIndex. */
  liveSetsOf(sessionExerciseId: string): SetLog[] {
    return this.setsOf(sessionExerciseId).filter((s) => s.voidedAt === null)
  }

  /** Working sets: not warm-ups, not voided; by setIndex. */
  workingSetsOf(sessionExerciseId: string): SetLog[] {
    return this.setsOf(sessionExerciseId).filter((s) => s.voidedAt === null && !s.isWarmup)
  }

  /** Every set logged in a session (voided included). */
  setsOfSession(sessionId: string): SetLog[] {
    return this.exercisesOf(sessionId).flatMap((se) => [...this.setsOf(se.id)])
  }
}

/** Whether a session exercise belongs to a progression track (see TrainingModel.trackHistory). */
export function isTracked(
  session: Pick<Session, 'programDayId'>,
  se: Pick<SessionExercise, 'adHoc' | 'slotId' | 'isFinisher'>,
): boolean {
  return session.programDayId !== null && !se.adHoc && se.slotId !== null && !se.isFinisher
}

/** The gym scope of an exercise at a gym; an unknown exercise is treated as gym-specific. */
export function scopeOf(model: TrainingModel, exerciseId: string, gymId: string): GymScope {
  return model.exercise(exerciseId) ? model.scopeFor(exerciseId, gymId) : gymScope(true, gymId)
}

/** Active gyms, by sortOrder. */
export function activeGyms(gyms: readonly Gym[]): Gym[] {
  return gyms.filter((g) => g.archivedAt === null)
}

/** The preferred gym if it is active, else the first active gym, else null. */
export function resolveGymId(gyms: readonly Gym[], preferred: unknown): string | null {
  const active = activeGyms(gyms)
  if (typeof preferred === 'string' && active.some((g) => g.id === preferred)) return preferred
  return active[0]?.id ?? null
}

export function gymNameOf(gyms: readonly Gym[], gymId: string): string {
  return gyms.find((g) => g.id === gymId)?.name ?? UNKNOWN_GYM_NAME
}

/** The gym a scope names, or null for the shared scope. */
export function scopeGymName(gyms: readonly Gym[], scope: GymScope): string | null {
  return scope === SHARED_GYM_SCOPE ? null : gymNameOf(gyms, scope)
}

/** Order scopes: shared first, then gyms by sortOrder, then unknown ids. */
export function compareScopes(gyms: readonly Gym[], a: GymScope, b: GymScope): number {
  const rank = (s: GymScope) => {
    if (s === SHARED_GYM_SCOPE) return -1
    const i = gyms.findIndex((g) => g.id === s)
    return i === -1 ? gyms.length : i
  }
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
}

export function dayNameOf(days: readonly ProgramDay[], programDayId: string | null): string {
  if (programDayId === null) return AD_HOC_DAY_NAME
  return days.find((d) => d.id === programDayId)?.name ?? UNKNOWN_DAY_NAME
}

/** Active days, in program order. */
export function activeDays(days: readonly ProgramDay[]): ProgramDay[] {
  return days
    .filter((d) => d.archivedAt === null)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
}

/** Badge for a prescription: calibration with no load, or calibration from a known load. */
export type PrescriptionBadge = 'set_load' | 'recalibrate' | null

export function badgeFor(p: { isCalibration: boolean; loadLb: number | null }): PrescriptionBadge {
  if (!p.isCalibration) return null
  return p.loadLb === null ? 'set_load' : 'recalibrate'
}

export interface MuscleSets {
  muscleId: MuscleId
  name: string
  sets: number
}

/** A volume map as rows in muscle sortOrder (unknown muscles last, by id); zero rows dropped. */
export function muscleRows(
  byMuscle: ReadonlyMap<MuscleId, number>,
  muscles: readonly Muscle[],
  only?: readonly MuscleId[],
): MuscleSets[] {
  const known = new Map(muscles.map((m, i) => [m.id, { name: m.name, rank: i }]))
  const ids = only ?? [...byMuscle.keys()]
  return ids
    .map((id) => ({ muscleId: id, name: known.get(id)?.name ?? id, sets: byMuscle.get(id) ?? 0 }))
    .filter((r) => r.sets > 0)
    .sort((a, b) => {
      const ra = known.get(a.muscleId)?.rank ?? muscles.length
      const rb = known.get(b.muscleId)?.rank ?? muscles.length
      return ra - rb || (a.muscleId < b.muscleId ? -1 : 1)
    })
}

export interface DeloadView {
  /** An accepted deload is running. */
  active: boolean
  /** Deload sessions still to do (0 when none is active). */
  remaining: number
  /** Length of a deload in sessions. */
  total: number
  /** Suggest a deload now: triggered, none active, and this situation not already answered. */
  suggested: boolean
  reasons: DeloadReason[]
  /** Suggestion-log key of the current trigger (null when nothing triggers). */
  fingerprint: string | null
}

/**
 * Deload status and suggestion. A trigger whose fingerprint was already accepted or dismissed in
 * the suggestion log is not suggested again (the fingerprint changes when the situation does).
 */
export function deloadView(model: TrainingModel): DeloadView {
  const { status, trigger } = model.deloadState()
  const answered =
    trigger.fingerprint !== null &&
    model.data.suggestions.some(
      (s) => s.kind === 'deload' && s.key === trigger.fingerprint && s.status !== 'shown',
    )
  return {
    active: status.active,
    remaining: status.remaining,
    total: status.total,
    suggested: trigger.suggest && !status.active && !answered,
    reasons: [...trigger.reasons],
    fingerprint: trigger.fingerprint,
  }
}

export interface StallView {
  exerciseId: string
  name: string
  scope: GymScope
  gymName: string | null
  /** Date of the first session in the window that failed to beat the earlier best. */
  since: LocalDate | null
}

export function stallView(q: QueryData, model: TrainingModel, flag: StallFlag): StallView {
  const sinceId = flag.result.sinceSessionId
  return {
    exerciseId: flag.exerciseId,
    name: model.exercise(flag.exerciseId)?.name ?? flag.exerciseId,
    scope: flag.scope,
    gymName: scopeGymName(q.gyms, flag.scope),
    since: sinceId === null ? null : (q.index.sessions.get(sinceId)?.date ?? null),
  }
}

/** The metric kind and rep floor an exercise's series uses (snapshot values if it's gone). */
export function metricBasis(
  model: TrainingModel,
  se: Pick<SessionExercise, 'exerciseId' | 'prescription'>,
): { kind: MetricKind; repMin: number } {
  const exercise = model.exercise(se.exerciseId)
  if (exercise) {
    return { kind: model.metricKindOf(exercise.id), repMin: exercise.defaultRegime.repMin }
  }
  return {
    kind: se.prescription.repMax > model.settings.e1rmRepCutoff ? 'repsAtLoad' : 'e1rm',
    repMin: se.prescription.repMin,
  }
}

export interface BestSet {
  setIndex: number
  loadLb: number
  reps: number
  /** Chart value of the set's e1RM (added-load equivalent for bodyweight-plus); null for reps-at-load. */
  e1rmDisplayLb: number | null
  /** e1RM of the whole system load; null for reps-at-load. */
  e1rmTotalLb: number | null
}

/**
 * A session exercise's best working set by its series metric (highest e1RM, or heaviest load with
 * reps ≥ repMin then most reps). With no qualifying set, the heaviest set with at least one rep.
 */
export function bestSetOf(
  sets: readonly Pick<SetLog, 'setIndex' | 'loadLb' | 'reps'>[],
  basis: { kind: MetricKind; repMin: number },
  strength: { loadType: LoadType; bodyweightLb: number | null },
): BestSet | null {
  const pick = (kind: MetricKind, repMin: number) => {
    let best: { set: (typeof sets)[number]; value: MetricValue } | null = null
    for (const set of sets) {
      const value = sessionMetric([set], kind, strength, repMin)
      if (value && (best === null || compareMetric(value, best.value) > 0)) best = { set, value }
    }
    return best
  }
  const best = pick(basis.kind, basis.repMin) ?? pick('repsAtLoad', 1)
  if (!best) return null
  const e1rm = best.value.kind === 'e1rm' ? best.value : null
  return {
    setIndex: best.set.setIndex,
    loadLb: best.set.loadLb,
    reps: best.set.reps,
    e1rmDisplayLb: e1rm?.displayLb ?? null,
    e1rmTotalLb: e1rm?.totalLb ?? null,
  }
}
