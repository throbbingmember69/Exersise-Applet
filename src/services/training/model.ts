// The training model: loads program + history from the database and replays it through the pure
// engine to answer "what should I lift next?", "what happened last session?", "which lifts are
// stalled?" and "is a deload due?". Nothing here is stored; everything is re-derived from logged
// sets on every load, so edits and voids take effect immediately.
//
// Identity (see domain/progression/keys.ts): a progression TRACK is (program day, exercise, gym
// scope) and is replayed for load suggestions; a strength SERIES is (exercise, gym scope), pooled
// across program days, for e1RM charts, stalls and the cut's strength check. The gym scope uses
// the exercise's CURRENT equipmentSpecific flag, so toggling it regroups history.
import { deloadStatus, deloadTrigger, type DeloadStatus, type DeloadTrigger } from '@/domain/deload'
import { metricKind, type MetricKind } from '@/domain/e1rm'
import { replayTrack, toWorkingSets, type Replay } from '@/domain/progression/evaluate'
import { gymScope, seriesKey, trackKey } from '@/domain/progression/keys'
import { deloadPrescription, nextPrescription } from '@/domain/progression/prefill'
import {
  detectStall,
  seriesPoints,
  type MetricPoint,
  type SeriesSession,
  type StallResult,
} from '@/domain/stall'
import { mainLiftSlide, type MainLiftSlide, type StrengthSeries } from '@/domain/strength'
import type {
  Exercise,
  GymScope,
  LocalDate,
  NextPrescription,
  ProgramDay,
  ProgramSlot,
  Regime,
  Session,
  SessionExercise,
  SessionResult,
  SetLog,
  Settings,
  Suggestion,
  TrackSession,
  TrackStart,
  TrackStartRow,
} from '@/domain/types'
import type { ServiceCtx } from '../context'
import { loadSettings } from '../settings'

/** Everything the model needs, read in one consistent snapshot. */
export interface TrainingData {
  settings: Settings
  exercises: readonly Exercise[]
  programDays: readonly ProgramDay[]
  programSlots: readonly ProgramSlot[]
  gymSlotOverrides: readonly { gymId: string; slotId: string; exerciseId: string }[]
  gymExerciseSettings: readonly { gymId: string; exerciseId: string; stepLb: number | null }[]
  trackStarts: readonly TrackStartRow[]
  sessions: readonly Session[]
  sessionExercises: readonly SessionExercise[]
  setLogs: readonly SetLog[]
  suggestions: readonly Suggestion[]
}

export async function loadTrainingData(ctx: Pick<ServiceCtx, 'db'>): Promise<TrainingData> {
  const { db } = ctx
  return db.transaction(
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
    ],
    async () => ({
      settings: await loadSettings(ctx),
      exercises: await db.exercises.toArray(),
      programDays: await db.programDays.toArray(),
      programSlots: await db.programSlots.toArray(),
      gymSlotOverrides: await db.gymSlotOverrides.toArray(),
      gymExerciseSettings: await db.gymExerciseSettings.toArray(),
      trackStarts: await db.trackStarts.toArray(),
      sessions: await db.sessions.toArray(),
      sessionExercises: await db.sessionExercises.toArray(),
      setLogs: await db.setLogs.toArray(),
      suggestions: await db.suggestions.toArray(),
    }),
  )
}

export async function loadTrainingModel(ctx: Pick<ServiceCtx, 'db'>): Promise<TrainingModel> {
  return new TrainingModel(await loadTrainingData(ctx))
}

/** A session that counts as history: finished and not voided (abandoned sessions don't count). */
export function isCountedSession(s: Pick<Session, 'status' | 'voidedAt'>): boolean {
  return s.status === 'finished' && s.voidedAt === null
}

export interface SlotExercise {
  exercise: Exercise
  /** 'gym_override' when the gym maps this slot to a different exercise. */
  swapKind: 'none' | 'gym_override'
}

export interface PrescriptionRequest {
  programDayId: string
  regime: Regime
  exerciseId: string
  gymId: string
  isDeload: boolean
}

export interface StallFlag {
  exerciseId: string
  scope: GymScope
  seriesKey: string
  result: StallResult
}

export interface DeloadState {
  status: DeloadStatus
  /** Why a deload is suggested now (ignore while one is active). */
  trigger: DeloadTrigger
  acceptedAt: number | null
}

export class TrainingModel {
  readonly settings: Settings
  private readonly exercises: Map<string, Exercise>
  private readonly slotsByDay = new Map<string, ProgramSlot[]>()
  private readonly overrides = new Map<string, string>()
  private readonly gymSteps = new Map<string, number>()
  private readonly trackStarts: Map<string, TrackStartRow>
  /** Counted sessions, oldest first. */
  private readonly counted: Session[]
  private readonly exercisesBySession = new Map<string, SessionExercise[]>()
  private readonly setsBySessionExercise = new Map<string, SetLog[]>()
  private readonly replayCache = new Map<string, Replay>()

  constructor(readonly data: TrainingData) {
    this.settings = data.settings
    this.exercises = new Map(data.exercises.map((e) => [e.id, e]))
    this.trackStarts = new Map(data.trackStarts.map((t) => [t.trackKey, t]))
    for (const slot of data.programSlots) {
      if (slot.archivedAt !== null) continue
      const list = this.slotsByDay.get(slot.programDayId) ?? []
      list.push(slot)
      this.slotsByDay.set(slot.programDayId, list)
    }
    for (const list of this.slotsByDay.values()) list.sort((a, b) => a.order - b.order)
    for (const o of data.gymSlotOverrides)
      this.overrides.set(`${o.gymId}|${o.slotId}`, o.exerciseId)
    for (const g of data.gymExerciseSettings) {
      if (g.stepLb !== null) this.gymSteps.set(`${g.gymId}|${g.exerciseId}`, g.stepLb)
    }
    this.counted = data.sessions
      .filter(isCountedSession)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startedAt - b.startedAt))
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
  }

  exercise(id: string): Exercise | undefined {
    return this.exercises.get(id)
  }

  /** Active (non-archived) slots of a day, in order. */
  slotsOf(programDayId: string): readonly ProgramSlot[] {
    return this.slotsByDay.get(programDayId) ?? []
  }

  /** The exercise that fills a slot at a gym: the gym's override, else the slot default. */
  resolveSlotExercise(slot: ProgramSlot, gymId: string): SlotExercise {
    const overrideId = this.overrides.get(`${gymId}|${slot.id}`)
    const override = overrideId ? this.exercises.get(overrideId) : undefined
    if (override && override.id !== slot.defaultExerciseId) {
      return { exercise: override, swapKind: 'gym_override' }
    }
    const exercise = this.exercises.get(slot.defaultExerciseId)
    if (!exercise)
      throw new Error(`Slot ${slot.id} points at missing exercise ${slot.defaultExerciseId}`)
    return { exercise, swapKind: 'none' }
  }

  /** Progression step for an exercise at a gym (the gym's machine jump overrides the default). */
  stepFor(exerciseId: string, gymId: string): number {
    const gymStep = this.gymSteps.get(`${gymId}|${exerciseId}`)
    if (gymStep !== undefined) return gymStep
    return this.requireExercise(exerciseId).stepLb
  }

  scopeFor(exerciseId: string, gymId: string): GymScope {
    return gymScope(this.requireExercise(exerciseId).equipmentSpecific, gymId)
  }

  /** Where a track starts; a track with no row (e.g. a machine at a new gym) starts with calibration. */
  trackStartFor(programDayId: string, exerciseId: string, scope: GymScope): TrackStart {
    const row = this.trackStarts.get(trackKey(programDayId, exerciseId, scope))
    return row
      ? { startLoadLb: row.startLoadLb, calibrate: row.calibrate }
      : { startLoadLb: null, calibrate: true }
  }

  /** Counted sessions of one track, as engine input. Ad hoc exercises and finishers never count. */
  trackHistory(programDayId: string, exerciseId: string, scope: GymScope): TrackSession[] {
    const out: TrackSession[] = []
    for (const session of this.counted) {
      if (session.programDayId !== programDayId) continue
      for (const se of this.exercisesBySession.get(session.id) ?? []) {
        if (se.exerciseId !== exerciseId || se.adHoc || se.slotId === null || se.isFinisher)
          continue
        if (
          !this.exercises.has(se.exerciseId) ||
          this.scopeFor(se.exerciseId, session.gymId) !== scope
        )
          continue
        out.push({
          sessionId: session.id,
          date: session.date,
          startedAt: session.startedAt,
          isDeload: session.isDeload,
          isCalibration: se.suggestion.isCalibration,
          prescribed: {
            sets: se.prescription.sets,
            repMin: se.prescription.repMin,
            repMax: se.prescription.repMax,
          },
          sets: toWorkingSets(this.setsBySessionExercise.get(se.id) ?? []),
        })
      }
    }
    return out
  }

  replay(programDayId: string, exerciseId: string, scope: GymScope): Replay {
    const key = trackKey(programDayId, exerciseId, scope)
    let replay = this.replayCache.get(key)
    if (!replay) {
      replay = replayTrack(
        this.trackStartFor(programDayId, exerciseId, scope),
        this.trackHistory(programDayId, exerciseId, scope),
        this.settings,
      )
      this.replayCache.set(key, replay)
    }
    return replay
  }

  /** What to pre-fill next time this exercise is done in this program day at this gym. */
  prescriptionFor(req: PrescriptionRequest): NextPrescription {
    const exercise = this.requireExercise(req.exerciseId)
    const scope = this.scopeFor(exercise.id, req.gymId)
    const step = this.stepFor(exercise.id, req.gymId)
    const start = this.trackStartFor(req.programDayId, exercise.id, scope)
    const { state } = this.replay(req.programDayId, exercise.id, scope)
    const next = nextPrescription(state, start, req.regime, step, exercise.loadType, this.settings)
    return req.isDeload
      ? deloadPrescription(next, req.regime, step, exercise.loadType, this.settings)
      : next
  }

  /** Flowchart result of each progression-tracked exercise in a counted session. */
  sessionResults(sessionId: string): Map<string, SessionResult> {
    const out = new Map<string, SessionResult>()
    const session = this.counted.find((s) => s.id === sessionId)
    if (!session || session.programDayId === null) return out
    for (const se of this.exercisesBySession.get(sessionId) ?? []) {
      if (se.adHoc || se.slotId === null || se.isFinisher || !this.exercises.has(se.exerciseId))
        continue
      const scope = this.scopeFor(se.exerciseId, session.gymId)
      const result = this.replay(session.programDayId, se.exerciseId, scope).results.find(
        (r) => r.sessionId === sessionId,
      )
      if (result) out.set(se.id, result)
    }
    return out
  }

  /** e1RM or reps-at-load, chosen from the exercise's default rep range. */
  metricKindOf(exerciseId: string): MetricKind {
    return metricKind(this.requireExercise(exerciseId).defaultRegime.repMax, this.settings)
  }

  /** Counted sessions of one strength series (all program days and ad hoc), as engine input. */
  seriesSessions(exerciseId: string, scope: GymScope): SeriesSession[] {
    const out: SeriesSession[] = []
    for (const session of this.counted) {
      for (const se of this.exercisesBySession.get(session.id) ?? []) {
        if (se.exerciseId !== exerciseId || this.scopeFor(exerciseId, session.gymId) !== scope)
          continue
        out.push({
          sessionId: session.id,
          date: session.date,
          startedAt: session.startedAt,
          isDeload: session.isDeload,
          isCalibration: se.suggestion.isCalibration,
          branch: se.suggestion.branch,
          bodyweightLb: session.bodyweightLb,
          sets: toWorkingSets(this.setsBySessionExercise.get(se.id) ?? []),
        })
      }
    }
    return out
  }

  /** Gym scopes an exercise has history in. */
  scopesWithHistory(exerciseId: string): GymScope[] {
    if (!this.exercises.has(exerciseId)) return []
    const scopes = new Set<GymScope>()
    for (const session of this.counted) {
      if (
        (this.exercisesBySession.get(session.id) ?? []).some((se) => se.exerciseId === exerciseId)
      ) {
        scopes.add(this.scopeFor(exerciseId, session.gymId))
      }
    }
    return [...scopes]
  }

  series(exerciseId: string, scope: GymScope, kind = this.metricKindOf(exerciseId)): MetricPoint[] {
    const exercise = this.requireExercise(exerciseId)
    return seriesPoints(
      this.seriesSessions(exerciseId, scope),
      kind,
      { loadType: exercise.loadType },
      exercise.defaultRegime.repMin,
    )
  }

  /** Stall check for every non-finisher exercise with history, per gym scope. */
  stallFlags(): StallFlag[] {
    const out: StallFlag[] = []
    for (const exercise of this.exercises.values()) {
      if (exercise.isFinisher) continue
      for (const scope of this.scopesWithHistory(exercise.id)) {
        out.push({
          exerciseId: exercise.id,
          scope,
          seriesKey: seriesKey(exercise.id, scope),
          result: detectStall(this.series(exercise.id, scope), this.settings.stallWindow),
        })
      }
    }
    return out
  }

  deloadState(): DeloadState {
    const latest = (kind: Suggestion['kind']) =>
      this.data.suggestions
        .filter((s) => s.kind === kind && s.status === 'accepted' && s.respondedAt !== null)
        .reduce<number | null>(
          (max, s) => (max === null || s.respondedAt! > max ? s.respondedAt : max),
          null,
        )
    const acceptedAt = latest('deload')
    const endedAt = latest('deload_end')
    const deloadSessionsSince =
      acceptedAt === null
        ? 0
        : this.counted.filter((s) => s.isDeload && s.startedAt >= acceptedAt).length
    const status = deloadStatus({ acceptedAt, endedAt, deloadSessionsSince }, this.settings)
    const trigger = deloadTrigger(
      {
        stalledSeries: this.stallFlags()
          .filter((f) => f.result.stalled)
          .map((f) => f.seriesKey),
        recentSessions: this.counted
          .filter((s) => !s.isDeload)
          .sort((a, b) => a.startedAt - b.startedAt)
          .map((s) => ({ id: s.id, jointPain: s.jointPain })),
      },
      this.settings,
    )
    return { status, trigger, acceptedAt }
  }

  /** Main-lift strength change for the cut's end prompt (total-load e1RM). */
  mainLiftSlide(asOf: LocalDate): MainLiftSlide {
    const series: StrengthSeries[] = []
    for (const exercise of this.exercises.values()) {
      if (!exercise.isMainLift) continue
      for (const scope of this.scopesWithHistory(exercise.id)) {
        const points = this.series(exercise.id, scope, 'e1rm').flatMap((p) =>
          p.value.kind === 'e1rm' ? [{ date: p.date, totalLb: p.value.totalLb }] : [],
        )
        series.push({ key: seriesKey(exercise.id, scope), points })
      }
    }
    return mainLiftSlide(series, asOf, this.settings)
  }

  /** The session currently being logged, if any. */
  inProgressSession(): Session | null {
    return (
      this.data.sessions
        .filter((s) => s.status === 'in_progress' && s.voidedAt === null)
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
    )
  }

  private requireExercise(id: string): Exercise {
    const e = this.exercises.get(id)
    if (!e) throw new Error(`Unknown exercise ${id}`)
    return e
  }
}
