// Progress screens: the per-exercise overview (latest, best, 4-week change, stall) and one
// exercise's strength series per gym scope. Series points come from TrainingModel.series, which
// already leaves out deload, calibration and post-drop sessions.
import { addDays, compareLocalDate } from '@/domain/dates'
import { compareMetric, type MetricKind, type MetricValue } from '@/domain/e1rm'
import type { MetricPoint } from '@/domain/stall'
import type { GymScope, LoadType, LocalDate } from '@/domain/types'
import type { ServiceCtx } from '../../context'
import type { StallFlag, TrainingModel } from '../model'
import {
  compareScopes,
  loadQueryData,
  modelAsOf,
  queryDate,
  scopeGymName,
  type QueryData,
} from './shared'

/** "Change vs 4 weeks ago" compares the latest point with the latest one at least this old. */
export const PROGRESS_CHANGE_LOOKBACK_DAYS = 28

export interface DatedMetric {
  sessionId: string
  date: LocalDate
  value: MetricValue
}

export type ChangeDirection = 'up' | 'flat' | 'down'

export type MetricChange =
  | {
      kind: 'e1rm'
      /** Date of the point compared against. */
      since: LocalDate
      direction: ChangeDirection
      /** % change of the total-load e1RM. */
      pct: number
      /** Change of the displayed e1RM (added-load equivalent for bodyweight-plus). */
      deltaLb: number
    }
  | {
      kind: 'repsAtLoad'
      since: LocalDate
      direction: ChangeDirection
      loadDeltaLb: number
      repsDelta: number
    }

export interface ProgressOverviewItem {
  exerciseId: string
  name: string
  scope: GymScope
  /** The gym for gym-specific (machine/cable) series; null when shared across gyms. */
  gymName: string | null
  kind: MetricKind
  loadType: LoadType
  perHand: boolean
  isMainLift: boolean
  /** Number of sessions in the series. */
  sessions: number
  latest: DatedMetric
  best: DatedMetric
  changeVs4WeeksAgo: MetricChange | null
  stalled: boolean
}

/**
 * Every exercise series with at least one point on or before `asOf`, stalled first, then main
 * lifts, then by name. "Change vs 4 weeks ago" compares the latest point with the latest earlier
 * point at least 4 weeks before `asOf` (null when there is none). Throws ServiceError
 * 'invalid_date' for a bad date.
 */
export async function getProgressOverview(
  ctx: Pick<ServiceCtx, 'db'>,
  { asOf: asOfInput }: { asOf: LocalDate },
): Promise<ProgressOverviewItem[]> {
  const asOf = queryDate(asOfInput, 'As-of date')
  const q = await loadQueryData(ctx)
  const model = modelAsOf(q.data, asOf)
  const stalls = stallsByKey(model)
  const lookback = addDays(asOf, -PROGRESS_CHANGE_LOOKBACK_DAYS)
  const items: ProgressOverviewItem[] = []

  for (const exercise of q.data.exercises) {
    for (const scope of model.scopesWithHistory(exercise.id)) {
      const points = model.series(exercise.id, scope)
      const latest = points[points.length - 1]
      if (!latest) continue
      // Strictly before the latest point: a point is never compared with itself.
      const reference = points
        .slice(0, -1)
        .filter((p) => compareLocalDate(p.date, lookback) <= 0)
        .pop()
      items.push({
        exerciseId: exercise.id,
        name: exercise.name,
        scope,
        gymName: scopeGymName(q.gyms, scope),
        kind: model.metricKindOf(exercise.id),
        loadType: exercise.loadType,
        perHand: exercise.perHand,
        isMainLift: exercise.isMainLift,
        sessions: points.length,
        latest: dated(latest),
        best: dated(bestPoint(points) as MetricPoint),
        changeVs4WeeksAgo: reference ? metricChange(reference, latest) : null,
        stalled: stalls.get(`${exercise.id}|${scope}`)?.result.stalled ?? false,
      })
    }
  }

  return items.sort(
    (a, b) =>
      Number(b.stalled) - Number(a.stalled) ||
      Number(b.isMainLift) - Number(a.isMainLift) ||
      a.name.localeCompare(b.name) ||
      compareScopes(q.gyms, a.scope, b.scope),
  )
}

export interface ProgressPoint {
  sessionId: string
  date: LocalDate
  /**
   * e1RM series: the displayed e1RM (for bodyweight-plus, the added-load equivalent).
   * Reps-at-load series: the best set.
   */
  value: number | { loadLb: number; reps: number }
  /** e1RM of the whole system load (bodyweight + added); null for reps-at-load. */
  totalLb: number | null
}

export interface ProgressSeries {
  scope: GymScope
  gymName: string | null
  points: ProgressPoint[]
  stall: {
    stalled: boolean
    /** Date of the first session in the window that failed to beat the earlier best. */
    since: LocalDate | null
  }
}

export interface ExerciseProgress {
  exerciseId: string
  name: string
  kind: MetricKind
  loadType: LoadType
  perHand: boolean
  isMainLift: boolean
  /** Bodyweight-plus: points show the added-load equivalent; `totalLb` has the total. */
  isBodyweightPlus: boolean
  /** One series per gym scope with history: shared first, then gyms in order. */
  series: ProgressSeries[]
}

/** One exercise's strength series for charts; null if the exercise doesn't exist. */
export async function getExerciseProgress(
  ctx: Pick<ServiceCtx, 'db'>,
  exerciseId: string,
): Promise<ExerciseProgress | null> {
  const q = await loadQueryData(ctx)
  const { model } = q
  const exercise = model.exercise(exerciseId)
  if (!exercise) return null
  const stalls = stallsByKey(model)

  const series = model
    .scopesWithHistory(exerciseId)
    .sort((a, b) => compareScopes(q.gyms, a, b))
    .map((scope): ProgressSeries => {
      const stall = stalls.get(`${exerciseId}|${scope}`)?.result
      return {
        scope,
        gymName: scopeGymName(q.gyms, scope),
        points: model.series(exerciseId, scope).map(progressPoint),
        stall: {
          stalled: stall?.stalled ?? false,
          since: sessionDate(q, stall?.stalled ? stall.sinceSessionId : null),
        },
      }
    })

  return {
    exerciseId,
    name: exercise.name,
    kind: model.metricKindOf(exerciseId),
    loadType: exercise.loadType,
    perHand: exercise.perHand,
    isMainLift: exercise.isMainLift,
    isBodyweightPlus: exercise.loadType === 'bodyweight_plus',
    series,
  }
}

function stallsByKey(model: TrainingModel): Map<string, StallFlag> {
  return new Map(model.stallFlags().map((f) => [`${f.exerciseId}|${f.scope}`, f]))
}

function sessionDate(q: QueryData, sessionId: string | null): LocalDate | null {
  return sessionId === null ? null : (q.index.sessions.get(sessionId)?.date ?? null)
}

function dated(p: MetricPoint): DatedMetric {
  return { sessionId: p.sessionId, date: p.date, value: p.value }
}

function progressPoint(p: MetricPoint): ProgressPoint {
  const base = { sessionId: p.sessionId, date: p.date }
  return p.value.kind === 'e1rm'
    ? { ...base, value: p.value.displayLb, totalLb: p.value.totalLb }
    : { ...base, value: { loadLb: p.value.loadLb, reps: p.value.reps }, totalLb: null }
}

/** The best point (earliest on ties). */
function bestPoint(points: readonly MetricPoint[]): MetricPoint | null {
  let best: MetricPoint | null = null
  for (const p of points) if (best === null || compareMetric(p.value, best.value) > 0) best = p
  return best
}

function metricChange(from: MetricPoint, to: MetricPoint): MetricChange | null {
  const a = from.value
  const b = to.value
  if (a.kind !== b.kind) return null
  const cmp = compareMetric(b, a)
  const direction: ChangeDirection = cmp > 0 ? 'up' : cmp < 0 ? 'down' : 'flat'
  if (a.kind === 'e1rm' && b.kind === 'e1rm') {
    return {
      kind: 'e1rm',
      since: from.date,
      direction,
      pct: a.totalLb > 0 ? ((b.totalLb - a.totalLb) / a.totalLb) * 100 : 0,
      deltaLb: b.displayLb - a.displayLb,
    }
  }
  if (a.kind === 'repsAtLoad' && b.kind === 'repsAtLoad') {
    return {
      kind: 'repsAtLoad',
      since: from.date,
      direction,
      loadDeltaLb: b.loadLb - a.loadLb,
      repsDelta: b.reps - a.reps,
    }
  }
  return null
}
