import { describe, expect, it } from 'vitest'
import { parseLocalDate } from '@/domain/dates'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { TrackSession, TrackStart, TrackState, WorkingSet } from '@/domain/types'
import { evaluateSession, initialTrackState, replayTrack, toWorkingSets } from './evaluate'

const S = DEFAULT_SETTINGS
const START: TrackStart = { startLoadLb: 220, calibrate: false }
const CALIBRATE: TrackStart = { startLoadLb: null, calibrate: true }

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x)) deepFreeze(v)
  }
  return x
}

function sets(...pairs: [number, number][]): WorkingSet[] {
  return pairs.map(([loadLb, reps], setIndex) => ({ setIndex, loadLb, reps }))
}

function session(
  id: string,
  workingSets: WorkingSet[],
  extra: Partial<TrackSession> = {},
): TrackSession {
  return {
    sessionId: id,
    date: parseLocalDate('2026-09-28'),
    startedAt: Date.UTC(2026, 8, 28, 17),
    isDeload: false,
    isCalibration: false,
    prescribed: { sets: 3, repMin: 8, repMax: 12 },
    sets: workingSets,
    ...extra,
  }
}

const state = (patch: Partial<TrackState>): TrackState => ({ ...initialTrackState(), ...patch })

describe('toWorkingSets', () => {
  it('drops warm-ups and voided sets and sorts by setIndex', () => {
    const logs = [
      { setIndex: 3, loadLb: 100, reps: 9, isWarmup: false, voidedAt: null },
      { setIndex: 0, loadLb: 50, reps: 10, isWarmup: true, voidedAt: null },
      { setIndex: 2, loadLb: 100, reps: 10, isWarmup: false, voidedAt: 1 },
      { setIndex: 1, loadLb: 100, reps: 11, isWarmup: false, voidedAt: null },
    ]
    expect(toWorkingSets(deepFreeze(logs))).toEqual([
      { setIndex: 1, loadLb: 100, reps: 11 },
      { setIndex: 3, loadLb: 100, reps: 9 },
    ])
  })
})

describe('evaluateSession', () => {
  it('evaluates sets in setIndex order regardless of input order', () => {
    const unordered: WorkingSet[] = [
      { setIndex: 2, loadLb: 100, reps: 3 },
      { setIndex: 0, loadLb: 100, reps: 12 },
      { setIndex: 1, loadLb: 100, reps: 12 },
      { setIndex: 3, loadLb: 100, reps: 12 }, // extra set: ignored
    ]
    const { state: next, result } = evaluateSession(
      initialTrackState(),
      session('a', unordered),
      START,
      S,
    )
    expect(result).toMatchObject({ branch: 'same_after_miss', anyBelow: true, allTop: false })
    expect(next.lastReps).toEqual([12, 12, 3])
  })

  it('records the evaluated state', () => {
    const { state: next, result } = evaluateSession(
      state({ lastBaseLb: 100, missStreak: 0, evaluatedCount: 2 }),
      session('a', sets([100, 12], [100, 12], [100, 12])),
      START,
      S,
    )
    expect(next).toEqual({
      lastBaseLb: 100,
      lastBranch: 'step',
      missStreak: 0,
      lastReps: [12, 12, 12],
      calibrated: false,
      evaluatedCount: 3,
    })
    expect(result).toEqual({
      sessionId: 'a',
      branch: 'step',
      evaluated: true,
      baseLb: 100,
      allTop: true,
      anyBelow: false,
      missStreakAfter: 0,
      notices: [],
    })
  })

  it('pads lastReps with null for missing sets', () => {
    const { state: next } = evaluateSession(
      initialTrackState(),
      session('a', sets([100, 10])),
      START,
      S,
    )
    expect(next.lastReps).toEqual([10, null, null])
  })

  it('continues a streak at the same base and restarts it at a changed base', () => {
    const prev = state({ lastBaseLb: 100, lastBranch: 'same_after_miss', missStreak: 1 })
    const miss = sets([100, 9], [100, 8], [100, 7])
    expect(evaluateSession(prev, session('a', miss), START, S).result.branch).toBe('drop')
    const lighter = sets([95, 9], [95, 8], [95, 7])
    expect(evaluateSession(prev, session('a', lighter), START, S).result).toMatchObject({
      branch: 'same_after_miss',
      missStreakAfter: 1,
    })
  })

  it('treats loads within the load tolerance as the same base', () => {
    const prev = state({ lastBaseLb: 37.5, lastBranch: 'same_after_miss', missStreak: 1 })
    const miss = sets([37.5 + 1e-9, 9], [37.5, 8], [37.5, 7])
    const { result } = evaluateSession(prev, session('a', miss), START, S)
    expect(result.branch).toBe('drop')
    expect(result.notices).toEqual([])
  })

  it('a deload is not evaluated, resets the streak and keeps everything else', () => {
    const prev = state({ lastBaseLb: 100, lastBranch: 'same_after_miss', missStreak: 1 })
    const { state: next, result } = evaluateSession(
      prev,
      session('d', sets([90, 5]), { isDeload: true }),
      START,
      S,
    )
    expect(next).toEqual({ ...prev, missStreak: 0 })
    expect(result).toEqual({
      sessionId: 'd',
      branch: 'same_after_miss',
      evaluated: false,
      baseLb: null,
      allTop: false,
      anyBelow: false,
      missStreakAfter: 0,
      notices: [{ code: 'deload' }],
    })
  })

  it('a session with no working sets carries the state forward unchanged', () => {
    const prev = state({ lastBaseLb: 100, lastBranch: 'same_after_miss', missStreak: 1 })
    const { state: next, result } = evaluateSession(prev, session('x', []), START, S)
    expect(next).toEqual(prev)
    expect(result).toMatchObject({
      evaluated: false,
      branch: 'same_after_miss',
      missStreakAfter: 1,
    })
  })

  it('calibration takes the highest-setIndex working load and sets calibrated', () => {
    const trials: WorkingSet[] = [
      { setIndex: 4, loadLb: 55, reps: 10 },
      { setIndex: 1, loadLb: 40, reps: 15 },
      { setIndex: 2, loadLb: 60, reps: 6 },
    ]
    const { state: next, result } = evaluateSession(
      initialTrackState(),
      session('c', trials),
      CALIBRATE,
      S,
    )
    expect(next).toEqual({
      lastBaseLb: 55,
      lastBranch: 'calibration',
      missStreak: 0,
      lastReps: [15, 6, 10],
      calibrated: true,
      evaluatedCount: 0,
    })
    expect(result).toMatchObject({ branch: 'calibration', evaluated: false, baseLb: 55 })
  })

  it('calibration is derived from the track start, not the stored snapshot flag', () => {
    const flagged = session('c', sets([100, 12], [100, 12], [100, 12]), { isCalibration: true })
    expect(evaluateSession(initialTrackState(), flagged, START, S).result.branch).toBe('step')

    const unflagged = session('c', sets([100, 12], [100, 12], [100, 12]))
    expect(evaluateSession(initialTrackState(), unflagged, CALIBRATE, S).result.branch).toBe(
      'calibration',
    )
  })

  it('a calibrate start is ignored once the track has evaluated history or was calibrated', () => {
    const miss = session('a', sets([100, 5], [100, 5], [100, 5]))
    const evaluated = state({ lastBaseLb: 100, lastBranch: 'same_plus_rep', evaluatedCount: 1 })
    expect(evaluateSession(evaluated, miss, CALIBRATE, S).result.branch).toBe('same_after_miss')
    const calibrated = state({ lastBaseLb: 100, lastBranch: 'calibration', calibrated: true })
    expect(evaluateSession(calibrated, miss, CALIBRATE, S).result.branch).toBe('same_after_miss')
  })

  it('a deload or empty first session leaves calibration pending', () => {
    const deloaded = evaluateSession(
      initialTrackState(),
      session('d', sets([50, 10]), { isDeload: true }),
      CALIBRATE,
      S,
    )
    expect(deloaded.state.calibrated).toBe(false)
    const empty = evaluateSession(initialTrackState(), session('e', []), CALIBRATE, S)
    expect(empty.state.calibrated).toBe(false)
    const { result } = evaluateSession(empty.state, session('c', sets([50, 10])), CALIBRATE, S)
    expect(result.branch).toBe('calibration')
  })

  it('treats a prescription of zero sets as one set', () => {
    const s = session('a', sets([100, 12], [100, 3]), {
      prescribed: { sets: 0, repMin: 8, repMax: 12 },
    })
    expect(evaluateSession(initialTrackState(), s, START, S).result).toMatchObject({
      branch: 'step',
      baseLb: 100,
    })
  })

  it('does not mutate its inputs', () => {
    const prev = deepFreeze(state({ lastBaseLb: 100, missStreak: 1, lastReps: [9, 8, 7] }))
    const s = deepFreeze(
      session('a', [
        { setIndex: 2, loadLb: 110, reps: 7 },
        { setIndex: 0, loadLb: 100, reps: 9 },
      ]),
    )
    expect(() => evaluateSession(prev, s, deepFreeze({ ...START }), S)).not.toThrow()
  })
})

describe('replayTrack', () => {
  it('replays in (date, startedAt) order and returns one result per session', () => {
    const first = session('first', sets([100, 9], [100, 8], [100, 7]), {
      date: parseLocalDate('2026-10-01'),
      startedAt: Date.UTC(2026, 9, 1, 9),
    })
    const second = session('second', sets([100, 9], [100, 8], [100, 7]), {
      date: parseLocalDate('2026-10-01'),
      startedAt: Date.UTC(2026, 9, 1, 18),
    })
    const third = session('third', sets([90, 12], [90, 12], [90, 12]), {
      date: parseLocalDate('2026-10-08'),
      startedAt: Date.UTC(2026, 9, 8, 7),
    })
    const history = deepFreeze([third, second, first])
    const { state: final, results } = replayTrack(deepFreeze({ ...START }), history, S)
    expect(results.map((r) => [r.sessionId, r.branch])).toEqual([
      ['first', 'same_after_miss'],
      ['second', 'drop'],
      ['third', 'step'],
    ])
    expect(final).toMatchObject({ lastBaseLb: 90, lastBranch: 'step', evaluatedCount: 3 })
    expect(history.map((h) => h.sessionId)).toEqual(['third', 'second', 'first'])
  })

  it('returns the initial state for an empty history', () => {
    expect(replayTrack(START, [], S)).toEqual({ state: initialTrackState(), results: [] })
  })
})
