// The Progression rules flowchart, one session at a time, and the replay that folds a track's
// history into its current state. Suggestions are always re-derived from logged sets this way;
// stored suggestions are never read back.
//
// Per session, in order:
//   1. Deload session: not evaluated; the miss streak resets.
//   2. No working sets (exercise skipped): not evaluated; the state carries forward unchanged.
//   3. The track's first session when its start says calibrate: not evaluated for top/below; the
//      last working set's load becomes the base.
//   4. Otherwise evaluate exactly the first N working sets by setIndex (N = prescribed sets).
//      Base = the lowest of their loads. Every set ≥ repMax → step. None < repMin → same load,
//      +1 rep. Some set < repMin → a miss; `missesBeforeDrop` misses in a row at the same base
//      → drop. Missing sets are neither top nor below. The streak resets after a clean session,
//      a drop, a base-load change and a deload.
import { compareLocalDate } from '@/domain/dates'
import type { Settings } from '@/domain/settings/registry'
import type {
  Branch,
  Notice,
  SessionResult,
  SetLog,
  TrackSession,
  TrackStart,
  TrackState,
  WorkingSet,
} from '@/domain/types'
import { loadsEqual } from '@/domain/units'

/** State of a track with no history. */
export function initialTrackState(): TrackState {
  return {
    lastBaseLb: null,
    lastBranch: 'start',
    missStreak: 0,
    lastReps: [],
    calibrated: false,
    evaluatedCount: 0,
  }
}

export interface Evaluation {
  state: TrackState
  result: SessionResult
}

export interface Replay {
  state: TrackState
  /** One result per session, in replay order. */
  results: SessionResult[]
}

type SetLogLike = Pick<SetLog, 'setIndex' | 'loadLb' | 'reps' | 'isWarmup' | 'voidedAt'>

/** Working sets of a session exercise: warm-ups and voided sets removed, sorted by setIndex. */
export function toWorkingSets(logs: readonly SetLogLike[]): WorkingSet[] {
  return bySetIndex(
    logs
      .filter((l) => !l.isWarmup && l.voidedAt === null)
      .map((l) => ({ setIndex: l.setIndex, loadLb: l.loadLb, reps: l.reps })),
  )
}

/**
 * One step of the flowchart. Sessions that are not evaluated (deload, no sets) report the branch
 * still in force and a null base.
 */
export function evaluateSession(
  prev: TrackState,
  session: TrackSession,
  start: TrackStart,
  settings: Settings,
): Evaluation {
  const notEvaluated = (state: TrackState, notices: Notice[]): Evaluation => ({
    state,
    result: {
      sessionId: session.sessionId,
      branch: prev.lastBranch,
      evaluated: false,
      baseLb: null,
      allTop: false,
      anyBelow: false,
      missStreakAfter: state.missStreak,
      notices,
    },
  })

  if (session.isDeload) return notEvaluated({ ...prev, missStreak: 0 }, [{ code: 'deload' }])

  const sets = bySetIndex(session.sets)
  const last = sets[sets.length - 1]
  if (last === undefined) return notEvaluated(prev, [])

  const n = Math.max(1, session.prescribed.sets)

  if (start.calibrate && !prev.calibrated && prev.evaluatedCount === 0) {
    const state: TrackState = {
      ...prev,
      lastBaseLb: last.loadLb,
      lastBranch: 'calibration',
      missStreak: 0,
      lastReps: repsByPosition(sets, n),
      calibrated: true,
    }
    return {
      state,
      result: {
        sessionId: session.sessionId,
        branch: 'calibration',
        evaluated: false,
        baseLb: last.loadLb,
        allTop: false,
        anyBelow: false,
        missStreakAfter: 0,
        notices: [],
      },
    }
  }

  const { repMin, repMax } = session.prescribed
  const evaluated = sets.slice(0, n)
  const notices: Notice[] = []

  const loads = distinctLoads(evaluated.map((s) => s.loadLb))
  const base = loads[0] as number
  if (loads.length > 1) notices.push({ code: 'mixed_loads', detail: { loads } })
  if (evaluated.length < n) {
    notices.push({ code: 'missing_sets', detail: { logged: evaluated.length, prescribed: n } })
  }

  const allTop = evaluated.length >= n && evaluated.every((s) => s.reps >= repMax)
  const anyBelow = evaluated.some((s) => s.reps < repMin)

  let branch: Branch
  let missStreak: number
  if (allTop) {
    branch = 'step'
    missStreak = 0
  } else if (!anyBelow) {
    branch = 'same_plus_rep'
    missStreak = 0
  } else {
    const baseChanged = prev.lastBaseLb !== null && !loadsEqual(base, prev.lastBaseLb)
    const streak = (baseChanged ? 0 : prev.missStreak) + 1
    if (streak >= settings.missesBeforeDrop) {
      branch = 'drop'
      missStreak = 0
    } else {
      branch = 'same_after_miss'
      missStreak = streak
    }
  }

  const state: TrackState = {
    lastBaseLb: base,
    lastBranch: branch,
    missStreak,
    lastReps: repsByPosition(evaluated, n),
    calibrated: prev.calibrated,
    evaluatedCount: prev.evaluatedCount + 1,
  }
  return {
    state,
    result: {
      sessionId: session.sessionId,
      branch,
      evaluated: true,
      baseLb: base,
      allTop,
      anyBelow,
      missStreakAfter: missStreak,
      notices,
    },
  }
}

/** Fold a track's finished sessions, in (date, startedAt) order, through the flowchart. */
export function replayTrack(
  start: TrackStart,
  history: readonly TrackSession[],
  settings: Settings,
): Replay {
  const ordered = [...history].sort(
    (a, b) => compareLocalDate(a.date, b.date) || a.startedAt - b.startedAt,
  )
  let state = initialTrackState()
  const results: SessionResult[] = []
  for (const session of ordered) {
    const step = evaluateSession(state, session, start, settings)
    state = step.state
    results.push(step.result)
  }
  return { state, results }
}

function bySetIndex(sets: readonly WorkingSet[]): WorkingSet[] {
  return [...sets].sort((a, b) => a.setIndex - b.setIndex)
}

/** Reps of the i-th working set for i < n (null where the set is missing). */
function repsByPosition(sets: readonly WorkingSet[], n: number): (number | null)[] {
  return Array.from({ length: n }, (_, i) => sets[i]?.reps ?? null)
}

/** Distinct loads (by load tolerance), ascending. */
function distinctLoads(loads: readonly number[]): number[] {
  const out: number[] = []
  for (const l of [...loads].sort((a, b) => a - b)) {
    if (!out.some((o) => loadsEqual(o, l))) out.push(l)
  }
  return out
}
