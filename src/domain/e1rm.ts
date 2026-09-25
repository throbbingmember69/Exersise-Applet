// Strength metrics for e1RM charts, stall detection and the main-lift check.
//
// e1RM is Epley: load × (1 + reps/30), using each session's best set. Weighted chin-ups
// (bodyweight_plus) put bodyweight + added load into the formula and subtract bodyweight for
// display. The metric is chosen per exercise from its rep range: above the e1RM rep cutoff the
// exercise tracks reps-at-load instead (heaviest qualifying set, ties broken by reps).
import type { Settings } from '@/domain/settings/registry'
import type { LoadType, WorkingSet } from '@/domain/types'
import { loadsEqual } from '@/domain/units'

export type MetricKind = 'e1rm' | 'repsAtLoad'

export type MetricValue =
  | {
      kind: 'e1rm'
      /** e1RM of the whole system load (bodyweight + added for bodyweight_plus). */
      totalLb: number
      /** What the chart shows: the added-load equivalent for bodyweight_plus, else totalLb. */
      displayLb: number
    }
  | {
      kind: 'repsAtLoad'
      /** The load as logged (the added load for bodyweight_plus). */
      loadLb: number
      reps: number
    }

export interface StrengthContext {
  loadType: LoadType
  /** The session's bodyweight; required for bodyweight_plus e1RM. */
  bodyweightLb: number | null
}

export interface SetStrength {
  totalLb: number
  displayLb: number
}

type SetLike = Pick<WorkingSet, 'loadLb' | 'reps'>

/** Epley estimated one-rep max: load × (1 + reps/30). */
export function epley(totalLb: number, reps: number): number {
  return totalLb * (1 + reps / 30)
}

/** e1RM of one set, or null when it can't be computed (no reps, or no bodyweight for bodyweight_plus). */
export function setStrength(set: SetLike, ctx: StrengthContext): SetStrength | null {
  if (!(set.reps >= 1)) return null
  if (ctx.loadType !== 'bodyweight_plus') {
    const e = epley(set.loadLb, set.reps)
    return { totalLb: e, displayLb: e }
  }
  if (ctx.bodyweightLb === null) return null
  const totalLb = epley(ctx.bodyweightLb + set.loadLb, set.reps)
  return { totalLb, displayLb: totalLb - ctx.bodyweightLb }
}

/** Metric for an exercise: reps-at-load when its rep range tops out strictly above the cutoff. */
export function metricKind(repMax: number, settings: Settings): MetricKind {
  return repMax > settings.e1rmRepCutoff ? 'repsAtLoad' : 'e1rm'
}

/**
 * A session's best-set metric, or null when no set qualifies. e1rm: the highest total e1RM over
 * sets with at least one rep. repsAtLoad: the highest (load, reps) over sets with reps ≥ repMin.
 */
export function sessionMetric(
  sets: readonly SetLike[],
  kind: MetricKind,
  ctx: StrengthContext,
  repMin: number,
): MetricValue | null {
  let best: MetricValue | null = null
  for (const set of sets) {
    let candidate: MetricValue | null
    if (kind === 'e1rm') {
      const s = setStrength(set, ctx)
      candidate = s ? { kind: 'e1rm', totalLb: s.totalLb, displayLb: s.displayLb } : null
    } else {
      candidate =
        set.reps >= repMin && set.reps >= 1
          ? { kind: 'repsAtLoad', loadLb: set.loadLb, reps: set.reps }
          : null
    }
    if (candidate && (best === null || compareMetric(candidate, best) > 0)) best = candidate
  }
  return best
}

/**
 * Order two metrics of the same kind: −1 (a worse), 0 (equal), 1 (a better). Loads and e1RMs
 * compare with the load tolerance; reps-at-load is lexicographic (load, then reps), so more reps
 * at the same load and any heavier qualifying load both count as better.
 */
export function compareMetric(a: MetricValue, b: MetricValue): -1 | 0 | 1 {
  if (a.kind === 'e1rm' && b.kind === 'e1rm') return compareLoads(a.totalLb, b.totalLb)
  if (a.kind === 'repsAtLoad' && b.kind === 'repsAtLoad') {
    const byLoad = compareLoads(a.loadLb, b.loadLb)
    if (byLoad !== 0) return byLoad
    return a.reps === b.reps ? 0 : a.reps > b.reps ? 1 : -1
  }
  throw new RangeError(`Cannot compare metrics of different kinds: ${a.kind} vs ${b.kind}`)
}

function compareLoads(a: number, b: number): -1 | 0 | 1 {
  if (loadsEqual(a, b)) return 0
  return a > b ? 1 : -1
}
