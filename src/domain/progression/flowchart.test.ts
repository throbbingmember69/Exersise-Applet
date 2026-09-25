// Acceptance: "Suggested loads follow the Progression rules flowchart exactly, including the
// two-session miss rule." Each case replays a track's history and checks the next pre-fill.
import { describe, expect, it } from 'vitest'
import { addDays, parseLocalDate } from '@/domain/dates'
import { DEFAULT_SETTINGS, resolveSettings } from '@/domain/settings/registry'
import type {
  LoadType,
  NextPrescription,
  Regime,
  SessionResult,
  TrackSession,
  TrackStart,
} from '@/domain/types'
import { replayTrack, toWorkingSets } from './evaluate'
import { deloadPrescription, nextPrescription } from './prefill'

const regime = (sets: number, repMin: number, repMax: number): Regime => ({
  sets,
  repMin,
  repMax,
  rirMin: 1,
  rirMax: 2,
  restMinSec: 120,
  restMaxSec: 180,
})

interface Track {
  regime: Regime
  start: TrackStart
  stepLb: number
  loadType: LoadType
}

// Seed tracks from the spec's program tables.
const SMITH_SQUAT: Track = {
  regime: regime(4, 6, 10),
  start: { startLoadLb: 220, calibrate: false },
  stepLb: 10,
  loadType: 'machine',
}
const LATERAL_RAISE: Track = {
  regime: regime(3, 10, 20),
  start: { startLoadLb: 40, calibrate: false },
  stepLb: 2.5,
  loadType: 'machine',
}
const WEIGHTED_CHIN_UP: Track = {
  regime: regime(3, 6, 8),
  start: { startLoadLb: 50, calibrate: false },
  stepLb: 5,
  loadType: 'bodyweight_plus',
}
const INCLINE_CABLE_PRESS: Track = {
  regime: regime(3, 8, 12),
  start: { startLoadLb: 53, calibrate: false },
  stepLb: 5,
  loadType: 'cable',
}
const FLAT_PRESS: Track = {
  regime: regime(3, 8, 12),
  start: { startLoadLb: null, calibrate: true },
  stepLb: 5,
  loadType: 'machine',
}

type SetSpec = [loadLb: number, reps: number]
interface SessionSpec {
  sets: SetSpec[]
  isDeload?: boolean
}

/** Sets at one load: at(220, 10, 10, 9, 8). */
const at = (loadLb: number, ...reps: number[]): SessionSpec => ({
  sets: reps.map((r) => [loadLb, r]),
})
const skipped: SessionSpec = { sets: [] }
const deload = (spec: SessionSpec): SessionSpec => ({ ...spec, isDeload: true })

const FIRST_DAY = parseLocalDate('2026-09-28')

function toHistory(track: Track, specs: SessionSpec[]): TrackSession[] {
  return specs.map((spec, i) => ({
    sessionId: `s${i + 1}`,
    date: addDays(FIRST_DAY, 7 * i),
    startedAt: Date.UTC(2026, 8, 28 + 7 * i, 17),
    isDeload: spec.isDeload ?? false,
    isCalibration: false,
    prescribed: {
      sets: track.regime.sets,
      repMin: track.regime.repMin,
      repMax: track.regime.repMax,
    },
    sets: spec.sets.map(([loadLb, reps], setIndex) => ({ setIndex, loadLb, reps })),
  }))
}

function run(
  track: Track,
  specs: SessionSpec[],
  settings = DEFAULT_SETTINGS,
): { next: NextPrescription; results: SessionResult[] } {
  const { state, results } = replayTrack(track.start, toHistory(track, specs), settings)
  const next = nextPrescription(
    state,
    track.start,
    track.regime,
    track.stepLb,
    track.loadType,
    settings,
  )
  return { next, results }
}

/** The suggested load before each session and after the last one. */
function loadsAlong(track: Track, specs: SessionSpec[]): (number | null)[] {
  return Array.from(
    { length: specs.length + 1 },
    (_, k) => run(track, specs.slice(0, k)).next.loadLb,
  )
}

const MISS = at(220, 8, 7, 6, 5)
const MISS_2 = at(220, 7, 6, 5, 5)
const IN_RANGE = at(220, 8, 8, 7, 6)

describe('progression flowchart', () => {
  it('starts at the start load with repMin targets', () => {
    const { next } = run(SMITH_SQUAT, [])
    expect(next).toEqual({
      loadLb: 220,
      repTargets: [6, 6, 6, 6],
      sets: 4,
      branch: 'start',
      isCalibration: false,
      missStreakBefore: 0,
      notices: [],
    })
  })

  it('every set at the top → add one step (220 → 230), reps back to repMin', () => {
    const { next, results } = run(SMITH_SQUAT, [at(220, 10, 10, 10, 10)])
    expect(results[0]).toMatchObject({ branch: 'step', allTop: true, anyBelow: false })
    expect(next).toMatchObject({ loadLb: 230, branch: 'step', repTargets: [6, 6, 6, 6] })
  })

  it('reps above repMax count as top', () => {
    expect(run(SMITH_SQUAT, [at(220, 12, 11, 10, 10)]).next).toMatchObject({
      loadLb: 230,
      branch: 'step',
    })
  })

  it('in range, none below → same load, aim for +1 rep per set', () => {
    const { next } = run(SMITH_SQUAT, [IN_RANGE])
    expect(next).toMatchObject({
      loadLb: 220,
      branch: 'same_plus_rep',
      repTargets: [9, 9, 8, 7],
      missStreakBefore: 0,
    })
  })

  it('+1 rep targets are capped at repMax', () => {
    expect(run(SMITH_SQUAT, [at(220, 10, 10, 9, 8)]).next.repTargets).toEqual([10, 10, 10, 9])
  })

  it('one session below range → same load, last reps as targets (pulled back into range)', () => {
    const { next, results } = run(SMITH_SQUAT, [MISS])
    expect(results[0]).toMatchObject({
      branch: 'same_after_miss',
      anyBelow: true,
      missStreakAfter: 1,
    })
    expect(next).toMatchObject({
      loadLb: 220,
      branch: 'same_after_miss',
      repTargets: [8, 7, 6, 6],
      missStreakBefore: 1,
    })
  })

  it('a 0-rep (failed) set counts as below the range', () => {
    expect(run(SMITH_SQUAT, [at(220, 10, 10, 10, 0)]).next.branch).toBe('same_after_miss')
  })

  it('two sessions below range in a row at the same load → drop 10% in whole steps (220 → 200)', () => {
    const { next, results } = run(SMITH_SQUAT, [MISS, MISS_2])
    expect(results.map((r) => r.branch)).toEqual(['same_after_miss', 'drop'])
    expect(results[1]?.missStreakAfter).toBe(0)
    expect(next).toMatchObject({ loadLb: 200, branch: 'drop', repTargets: [6, 6, 6, 6] })
  })

  it('miss, in range, miss → no drop', () => {
    const { next, results } = run(SMITH_SQUAT, [MISS, IN_RANGE, MISS_2])
    expect(results.map((r) => r.missStreakAfter)).toEqual([1, 0, 1])
    expect(next).toMatchObject({ loadLb: 220, branch: 'same_after_miss', missStreakBefore: 1 })
  })

  it('a miss at a changed load starts a new streak (streak 1)', () => {
    const { next, results } = run(SMITH_SQUAT, [MISS, at(230, 8, 7, 6, 5)])
    expect(results[1]).toMatchObject({ branch: 'same_after_miss', baseLb: 230, missStreakAfter: 1 })
    expect(next).toMatchObject({ loadLb: 230, branch: 'same_after_miss' })
  })

  it('drop then a miss → no second drop in a row; a further miss at the new load drops again', () => {
    const afterDrop = run(SMITH_SQUAT, [MISS, MISS_2, at(200, 8, 7, 6, 5)])
    expect(afterDrop.next).toMatchObject({
      loadLb: 200,
      branch: 'same_after_miss',
      missStreakBefore: 1,
    })

    const ignoredDrop = run(SMITH_SQUAT, [MISS, MISS_2, MISS])
    expect(ignoredDrop.next).toMatchObject({ loadLb: 220, branch: 'same_after_miss' })

    const again = run(SMITH_SQUAT, [MISS, MISS_2, at(200, 8, 7, 6, 5), at(200, 7, 6, 5, 5)])
    expect(again.next).toMatchObject({ loadLb: 180, branch: 'drop' })
  })

  it('a missing set with the rest at the top is not a step (and not a miss)', () => {
    const { next, results } = run(SMITH_SQUAT, [at(220, 10, 10, 10)])
    expect(results[0]).toMatchObject({ branch: 'same_plus_rep', allTop: false, anyBelow: false })
    expect(results[0]?.notices).toContainEqual({
      code: 'missing_sets',
      detail: { logged: 3, prescribed: 4 },
    })
    expect(next).toMatchObject({ loadLb: 220, repTargets: [10, 10, 10, 6] })
  })

  it('an extra set below the range is ignored', () => {
    expect(run(SMITH_SQUAT, [at(220, 10, 10, 10, 10, 3)]).next).toMatchObject({
      loadLb: 230,
      branch: 'step',
    })
  })

  it('a skipped session (no sets) between two misses still leads to a drop', () => {
    const { next, results } = run(SMITH_SQUAT, [MISS, skipped, MISS_2])
    expect(results[1]).toMatchObject({ evaluated: false, missStreakAfter: 1 })
    expect(next).toMatchObject({ loadLb: 200, branch: 'drop' })
  })

  it('a deload between misses resets the streak', () => {
    const { next, results } = run(SMITH_SQUAT, [MISS, deload(at(200, 6, 6)), MISS_2])
    expect(results[1]).toMatchObject({ evaluated: false, missStreakAfter: 0 })
    expect(next).toMatchObject({ loadLb: 220, branch: 'same_after_miss', missStreakBefore: 1 })
  })

  it('after a deload the pre-deload suggestion returns', () => {
    const before = run(SMITH_SQUAT, [IN_RANGE]).next
    const during = deloadPrescription(
      before,
      SMITH_SQUAT.regime,
      SMITH_SQUAT.stepLb,
      SMITH_SQUAT.loadType,
      DEFAULT_SETTINGS,
    )
    expect(during).toMatchObject({ loadLb: 200, sets: 2, repTargets: [9, 9] })
    const after = run(SMITH_SQUAT, [IN_RANGE, deload(at(200, 9, 9)), deload(at(200, 9, 9))]).next
    expect(after).toEqual(before)
  })

  it('warm-ups (and voided sets) are ignored', () => {
    const logs = [
      { setIndex: 0, loadLb: 135, reps: 5, isWarmup: true, voidedAt: null },
      { setIndex: 1, loadLb: 185, reps: 3, isWarmup: true, voidedAt: null },
      { setIndex: 2, loadLb: 220, reps: 10, isWarmup: false, voidedAt: null },
      { setIndex: 3, loadLb: 220, reps: 4, isWarmup: false, voidedAt: Date.UTC(2026, 8, 28) },
      { setIndex: 4, loadLb: 220, reps: 10, isWarmup: false, voidedAt: null },
      { setIndex: 5, loadLb: 220, reps: 10, isWarmup: false, voidedAt: null },
      { setIndex: 6, loadLb: 220, reps: 11, isWarmup: false, voidedAt: null },
    ]
    const history = toHistory(SMITH_SQUAT, [skipped]).map((s) => ({
      ...s,
      sets: toWorkingSets(logs),
    }))
    const { state } = replayTrack(SMITH_SQUAT.start, history, DEFAULT_SETTINGS)
    expect(state).toMatchObject({ lastBranch: 'step', lastBaseLb: 220, missStreak: 0 })
  })

  it('the minimum drop is one step (20 → 15 with a 5 lb step; lateral raise 40 → 37.5)', () => {
    const light: Track = { ...SMITH_SQUAT, start: { startLoadLb: 20, calibrate: false }, stepLb: 5 }
    expect(run(light, [at(20, 5, 5, 5, 5), at(20, 5, 5, 5, 5)]).next.loadLb).toBe(15)
    expect(run(LATERAL_RAISE, [at(40, 12, 9, 8), at(40, 11, 9, 8)]).next.loadLb).toBe(37.5)
  })

  it('bodyweight-plus drops apply to the added load (+50 → +45; 0 → −5 assisted)', () => {
    const misses = (added: number) => [at(added, 7, 6, 5), at(added, 6, 5, 5)]
    expect(run(WEIGHTED_CHIN_UP, misses(50)).next).toMatchObject({ loadLb: 45, branch: 'drop' })
    const bodyweightOnly = { ...WEIGHTED_CHIN_UP, start: { startLoadLb: 0, calibrate: false } }
    expect(run(bodyweightOnly, misses(0)).next.loadLb).toBe(-5)
  })

  it('a step is added to a start load that is not a multiple of the step (53 + 5 → 58)', () => {
    expect(run(INCLINE_CABLE_PRESS, [at(53, 12, 12, 12)]).next.loadLb).toBe(58)
  })

  it('"Set in week 1": blank pre-fill, calibration session, then its last working load', () => {
    const first = run(FLAT_PRESS, []).next
    expect(first).toMatchObject({
      loadLb: null,
      isCalibration: true,
      repTargets: [8, 8, 8],
      notices: [{ code: 'calibration_needed' }],
    })

    const trials: SessionSpec = {
      sets: [
        [40, 12],
        [60, 7],
        [55, 10],
        [55, 9],
      ],
    }
    const { next, results } = run(FLAT_PRESS, [trials])
    expect(results[0]).toMatchObject({ branch: 'calibration', evaluated: false, baseLb: 55 })
    expect(next).toMatchObject({
      loadLb: 55,
      branch: 'calibrated',
      isCalibration: false,
      repTargets: [8, 8, 8],
    })

    // The session after calibration is evaluated normally.
    expect(run(FLAT_PRESS, [trials, at(55, 12, 12, 12)]).next).toMatchObject({
      loadLb: 60,
      branch: 'step',
    })
  })

  it('mixed loads → the lowest load is the base, with a notice', () => {
    const { next, results } = run(SMITH_SQUAT, [
      {
        sets: [
          [230, 10],
          [220, 10],
          [220, 10],
          [220, 9],
        ],
      },
    ])
    expect(results[0]?.notices).toContainEqual({
      code: 'mixed_loads',
      detail: { loads: [220, 230] },
    })
    expect(next).toMatchObject({ loadLb: 220, branch: 'same_plus_rep' })
  })

  it('mixed loads all at the top step from the lowest load', () => {
    const { next } = run(SMITH_SQUAT, [
      {
        sets: [
          [230, 10],
          [220, 10],
          [220, 10],
          [220, 10],
        ],
      },
    ])
    expect(next).toMatchObject({ loadLb: 230, branch: 'step' })
  })

  it('follows the flowchart across a multi-week run', () => {
    const weeks = [
      at(220, 8, 8, 7, 7), // in range
      at(220, 9, 9, 8, 8), // in range
      at(220, 10, 10, 10, 10), // top → 230
      at(230, 7, 7, 6, 6), // in range
      at(230, 8, 7, 6, 5), // miss 1
      at(230, 7, 6, 5, 5), // miss 2 → drop to 210
      at(210, 9, 8, 8, 7), // in range
      at(210, 10, 10, 10, 10), // top → 220
    ]
    expect(loadsAlong(SMITH_SQUAT, weeks)).toEqual([220, 220, 220, 230, 230, 230, 210, 210, 220])
  })

  it('honours an edited missesBeforeDrop', () => {
    const three = resolveSettings({ missesBeforeDrop: 3 })
    expect(run(SMITH_SQUAT, [MISS, MISS_2], three).next.loadLb).toBe(220)
    expect(run(SMITH_SQUAT, [MISS, MISS_2, MISS], three).next.loadLb).toBe(200)
  })

  it('honours an edited dropPct', () => {
    const twenty = resolveSettings({ dropPct: 20 })
    expect(run(SMITH_SQUAT, [MISS, MISS_2], twenty).next.loadLb).toBe(180)
  })
})
