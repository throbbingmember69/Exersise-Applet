// Stall detection on a strength series (one exercise and gym scope, pooled across program days).
//
// Each session contributes its best-set metric. Sessions that are lighter by design don't count:
// deload sessions, calibration sessions and the session right after a miss-rule drop (its
// snapshot branch is 'drop'), plus sessions with no qualifying set. A series is stalled when it
// has at least window + 1 points and the best of the last `window` points is no better than the
// best of all earlier points. The flag is derived, so it clears on the next gain.
import { compareLocalDate } from '@/domain/dates'
import { compareMetric, sessionMetric, type MetricKind, type MetricValue } from '@/domain/e1rm'
import type { Branch, EpochMs, LoadType, LocalDate, WorkingSet } from '@/domain/types'

/** One finished session of a series, with the flags from its snapshot suggestion. */
export interface SeriesSession {
  sessionId: string
  date: LocalDate
  startedAt: EpochMs
  isDeload: boolean
  /** Snapshot suggestion: this session was the track's calibration session. */
  isCalibration: boolean
  /** Snapshot suggestion branch ('drop' = the load was dropped by the miss rule). */
  branch: Branch
  bodyweightLb: number | null
  /** Working sets only (warm-ups and voided sets removed). */
  sets: readonly WorkingSet[]
}

export interface MetricPoint {
  sessionId: string
  date: LocalDate
  startedAt: EpochMs
  value: MetricValue
}

export interface StallResult {
  stalled: boolean
  /** Best point before the window: the mark the window failed to beat (null with too few points). */
  bestBefore: MetricPoint | null
  /** Best point inside the window. */
  bestRecent: MetricPoint | null
  /** First session of the window. */
  sinceSessionId: string | null
}

/** The series' metric points in (date, startedAt) order, excluding sessions lighter by design. */
export function seriesPoints(
  sessions: readonly SeriesSession[],
  kind: MetricKind,
  ctx: { loadType: LoadType },
  repMin: number,
): MetricPoint[] {
  const points: MetricPoint[] = []
  for (const s of sessions) {
    if (s.isDeload || s.isCalibration || s.branch === 'drop') continue
    const value = sessionMetric(
      s.sets,
      kind,
      { loadType: ctx.loadType, bodyweightLb: s.bodyweightLb },
      repMin,
    )
    if (value === null) continue
    points.push({ sessionId: s.sessionId, date: s.date, startedAt: s.startedAt, value })
  }
  return points.sort((a, b) => compareLocalDate(a.date, b.date) || a.startedAt - b.startedAt)
}

/** Stalled when the best of the last `window` points doesn't beat the best of all earlier points. */
export function detectStall(points: readonly MetricPoint[], window: number): StallResult {
  if (window < 1 || points.length < window + 1) {
    return { stalled: false, bestBefore: null, bestRecent: null, sinceSessionId: null }
  }
  const split = points.length - window
  const bestBefore = bestPoint(points.slice(0, split)) as MetricPoint
  const bestRecent = bestPoint(points.slice(split)) as MetricPoint
  return {
    stalled: compareMetric(bestRecent.value, bestBefore.value) <= 0,
    bestBefore,
    bestRecent,
    sinceSessionId: (points[split] as MetricPoint).sessionId,
  }
}

/** The best point (earliest on ties), or null for none. */
function bestPoint(points: readonly MetricPoint[]): MetricPoint | null {
  let best: MetricPoint | null = null
  for (const p of points) if (best === null || compareMetric(p.value, best.value) > 0) best = p
  return best
}
