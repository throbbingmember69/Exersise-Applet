// What the logger pre-fills for a track's next session: the load chosen by the flowchart branch
// and per-set rep targets. RIR is never pre-filled.
//
// Load: start load with no history (blank for "Set in week 1", flagged as calibration when the
// start says so); the calibration load after calibration; base + step after a step; base on the
// same-load branches; the whole-step drop after a drop (the added load for bodyweight_plus).
// Reps: last reps + 1 per set (capped at repMax) after an in-range session; last reps pulled back
// into the range after a single miss; repMin otherwise and for any set with no previous reps.
// A deload keeps the same suggestion with ceil(sets × fraction) sets and a lighter load; deload
// sessions are skipped by the replay, so the pre-deload suggestion returns afterwards.
import type { Settings } from '@/domain/settings/registry'
import type {
  Branch,
  LoadType,
  NextPrescription,
  Notice,
  Regime,
  TrackStart,
  TrackState,
} from '@/domain/types'
import { clamp } from '@/domain/rounding'
import { dropLoad } from './drop'

/** Guards ceil() against binary error in sets × fraction (10 × (0.1 + 0.2) = 3.000…04). */
const SET_EPSILON = 1e-9

/** The next session's suggestion for a track, from its replayed state. */
export function nextPrescription(
  state: TrackState,
  start: TrackStart,
  regime: Regime,
  stepLb: number,
  loadType: LoadType,
  settings: Settings,
): NextPrescription {
  const sets = regime.sets
  const make = (
    branch: Branch,
    loadLb: number | null,
    extra: { isCalibration?: boolean; notices?: Notice[] } = {},
  ): NextPrescription => ({
    loadLb,
    repTargets: repTargets(branch, state.lastReps, sets, regime.repMin, regime.repMax),
    sets,
    branch,
    isCalibration: extra.isCalibration ?? false,
    missStreakBefore: state.missStreak,
    notices: extra.notices ?? [],
  })

  const base = state.lastBaseLb
  switch (state.lastBranch) {
    case 'start':
      if (start.calibrate) {
        const code = start.startLoadLb === null ? 'calibration_needed' : 'recalibrate'
        return make('start', start.startLoadLb, { isCalibration: true, notices: [{ code }] })
      }
      return make('start', start.startLoadLb)
    case 'calibration':
    case 'calibrated':
      return make('calibrated', base)
    case 'step':
      return make('step', base === null ? null : base + stepLb)
    case 'same_plus_rep':
    case 'same_after_miss':
      return make(state.lastBranch, base)
    case 'drop':
      return make(
        'drop',
        base === null
          ? null
          : dropLoad(base, stepLb, settings.dropPct, loadType === 'bodyweight_plus'),
      )
  }
}

/**
 * Per-set rep targets for a branch. same_plus_rep: last + 1 capped at repMax; same_after_miss:
 * last reps clamped into the range; every other branch, and any set with no last reps: repMin.
 */
export function repTargets(
  branch: Branch,
  lastReps: readonly (number | null)[],
  sets: number,
  repMin: number,
  repMax: number,
): number[] {
  return Array.from({ length: Math.max(0, sets) }, (_, i) => {
    const last = lastReps[i] ?? null
    if (last === null) return repMin
    if (branch === 'same_plus_rep') return clamp(last + 1, repMin, repMax)
    if (branch === 'same_after_miss') return clamp(last, repMin, repMax)
    return repMin
  })
}

/** The deload version of a prescription: fewer sets and a whole-step lighter load. */
export function deloadPrescription(
  p: NextPrescription,
  regime: Regime,
  stepLb: number,
  loadType: LoadType,
  settings: Settings,
): NextPrescription {
  const sets = Math.max(1, Math.ceil(regime.sets * settings.deloadSetFraction - SET_EPSILON))
  const loadLb =
    p.loadLb === null
      ? null
      : dropLoad(p.loadLb, stepLb, settings.deloadLoadCutPct, loadType === 'bodyweight_plus')
  return {
    ...p,
    loadLb,
    sets,
    repTargets: Array.from({ length: sets }, (_, i) => p.repTargets[i] ?? regime.repMin),
    notices: [...p.notices, { code: 'deload' }],
  }
}
