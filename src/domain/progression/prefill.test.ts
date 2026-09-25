import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, resolveSettings } from '@/domain/settings/registry'
import type { LoadType, NextPrescription, Regime, TrackStart, TrackState } from '@/domain/types'
import { initialTrackState } from './evaluate'
import { deloadPrescription, nextPrescription, repTargets } from './prefill'

const S = DEFAULT_SETTINGS
const SQUAT: Regime = {
  sets: 4,
  repMin: 6,
  repMax: 10,
  rirMin: 1,
  rirMax: 2,
  restMinSec: 120,
  restMaxSec: 180,
}
const START: TrackStart = { startLoadLb: 220, calibrate: false }

const state = (patch: Partial<TrackState>): TrackState => ({ ...initialTrackState(), ...patch })

describe('repTargets', () => {
  it('same_plus_rep: last + 1 per set, capped at repMax; repMin where there is no last', () => {
    expect(repTargets('same_plus_rep', [8, 10, 9, null], 5, 6, 10)).toEqual([9, 10, 10, 6, 6])
  })

  it('same_after_miss: last reps clamped into the range, no +1', () => {
    expect(repTargets('same_after_miss', [8, 5, 0, 12], 4, 6, 10)).toEqual([8, 6, 6, 10])
    expect(repTargets('same_after_miss', [], 2, 6, 10)).toEqual([6, 6])
  })

  it('keeps +1 targets inside a rep range that has since moved up', () => {
    expect(repTargets('same_plus_rep', [6, 7], 2, 10, 15)).toEqual([10, 10])
  })

  it('every other branch targets repMin', () => {
    for (const branch of ['start', 'calibration', 'calibrated', 'step', 'drop'] as const) {
      expect(repTargets(branch, [9, 9, 9], 3, 8, 12)).toEqual([8, 8, 8])
    }
  })

  it('returns one target per prescribed set', () => {
    expect(repTargets('same_plus_rep', [8, 8, 8, 8], 2, 6, 10)).toEqual([9, 9])
    expect(repTargets('step', [], 0, 6, 10)).toEqual([])
  })
})

describe('nextPrescription', () => {
  const next = (s: TrackState, start = START, stepLb = 10, loadType: LoadType = 'machine') =>
    nextPrescription(s, start, SQUAT, stepLb, loadType, S)

  it('uses the start load with no history', () => {
    expect(next(initialTrackState())).toEqual({
      loadLb: 220,
      repTargets: [6, 6, 6, 6],
      sets: 4,
      branch: 'start',
      isCalibration: false,
      missStreakBefore: 0,
      notices: [],
    })
    expect(next(initialTrackState(), { startLoadLb: null, calibrate: false }).loadLb).toBeNull()
  })

  it('flags a calibration session: blank when no start load, "recalibrate" with one', () => {
    expect(next(initialTrackState(), { startLoadLb: null, calibrate: true })).toMatchObject({
      loadLb: null,
      branch: 'start',
      isCalibration: true,
      notices: [{ code: 'calibration_needed' }],
    })
    expect(next(initialTrackState(), { startLoadLb: 205, calibrate: true })).toMatchObject({
      loadLb: 205,
      isCalibration: true,
      notices: [{ code: 'recalibrate' }],
    })
  })

  it('after calibration: the calibration load with repMin targets', () => {
    const s = state({ lastBaseLb: 55, lastBranch: 'calibration', calibrated: true, lastReps: [9] })
    expect(next(s, { startLoadLb: null, calibrate: true })).toMatchObject({
      loadLb: 55,
      branch: 'calibrated',
      isCalibration: false,
      repTargets: [6, 6, 6, 6],
      notices: [],
    })
    expect(next(state({ lastBaseLb: 55, lastBranch: 'calibrated' })).branch).toBe('calibrated')
  })

  it('step adds the current step to the base', () => {
    expect(next(state({ lastBaseLb: 220, lastBranch: 'step' }), START, 5).loadLb).toBe(225)
  })

  it('same-load branches keep the base and report the streak before the session', () => {
    const miss = state({
      lastBaseLb: 220,
      lastBranch: 'same_after_miss',
      missStreak: 1,
      lastReps: [8, 7, 5, 4],
    })
    expect(next(miss)).toMatchObject({
      loadLb: 220,
      branch: 'same_after_miss',
      repTargets: [8, 7, 6, 6],
      missStreakBefore: 1,
    })
    const inRange = state({ lastBaseLb: 220, lastBranch: 'same_plus_rep', lastReps: [8, 8, 7, 6] })
    expect(next(inRange)).toMatchObject({ loadLb: 220, repTargets: [9, 9, 8, 7] })
  })

  it('drop uses the whole-step routine, going negative only for bodyweight-plus', () => {
    expect(next(state({ lastBaseLb: 220, lastBranch: 'drop' }))).toMatchObject({
      loadLb: 200,
      repTargets: [6, 6, 6, 6],
    })
    expect(next(state({ lastBaseLb: 0, lastBranch: 'drop' }), START, 5).loadLb).toBe(0)
    const assisted = next(state({ lastBaseLb: 0, lastBranch: 'drop' }), START, 5, 'bodyweight_plus')
    expect(assisted.loadLb).toBe(-5)
  })

  it('returns a null load when the base is unknown', () => {
    for (const lastBranch of ['step', 'drop', 'same_plus_rep', 'calibration'] as const) {
      expect(next(state({ lastBranch })).loadLb).toBeNull()
    }
  })

  it('uses the regime set count even when it changed since the last session', () => {
    const s = state({ lastBaseLb: 220, lastBranch: 'same_plus_rep', lastReps: [8, 8] })
    expect(nextPrescription(s, START, { ...SQUAT, sets: 3 }, 10, 'machine', S)).toMatchObject({
      sets: 3,
      repTargets: [9, 9, 6],
    })
  })
})

describe('deloadPrescription', () => {
  const base: NextPrescription = {
    loadLb: 220,
    repTargets: [9, 9, 8, 7],
    sets: 4,
    branch: 'same_plus_rep',
    isCalibration: false,
    missStreakBefore: 0,
    notices: [],
  }

  it('halves the sets (rounding up) and cuts the load 10% in whole steps', () => {
    expect(deloadPrescription(base, SQUAT, 10, 'machine', S)).toEqual({
      ...base,
      loadLb: 200,
      sets: 2,
      repTargets: [9, 9],
      notices: [{ code: 'deload' }],
    })
    const threeSets = { ...SQUAT, sets: 3 }
    expect(deloadPrescription(base, threeSets, 10, 'machine', S).sets).toBe(2)
    const oneSet = { ...SQUAT, sets: 1 }
    expect(deloadPrescription(base, oneSet, 10, 'machine', S).sets).toBe(1)
  })

  it('keeps a blank load blank and existing notices', () => {
    const blank = { ...base, loadLb: null, notices: [{ code: 'calibration_needed' as const }] }
    expect(deloadPrescription(blank, SQUAT, 5, 'machine', S)).toMatchObject({
      loadLb: null,
      notices: [{ code: 'calibration_needed' }, { code: 'deload' }],
    })
  })

  it('cuts bodyweight-plus added load below zero', () => {
    const chin = { ...base, loadLb: 0 }
    expect(deloadPrescription(chin, SQUAT, 5, 'bodyweight_plus', S).loadLb).toBe(-5)
  })

  it('uses the deload settings', () => {
    const s = resolveSettings({ deloadSetFraction: 0.75, deloadLoadCutPct: 20 })
    expect(deloadPrescription(base, SQUAT, 10, 'machine', s)).toMatchObject({
      sets: 3,
      loadLb: 180,
      repTargets: [9, 9, 8],
    })
    const noCut = resolveSettings({ deloadLoadCutPct: 0 })
    expect(deloadPrescription(base, SQUAT, 10, 'machine', noCut).loadLb).toBe(220)
  })

  it('is not thrown off by binary error in the set fraction', () => {
    const s = { ...S, deloadSetFraction: 0.1 + 0.2 }
    expect(deloadPrescription(base, { ...SQUAT, sets: 10 }, 10, 'machine', s).sets).toBe(3)
  })

  it('pads rep targets with repMin when the prescription has fewer than the deload sets', () => {
    const short = { ...base, repTargets: [9] }
    expect(deloadPrescription(short, SQUAT, 10, 'machine', S).repTargets).toEqual([9, 6])
  })
})
