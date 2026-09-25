import { describe, expect, it } from 'vitest'
import { addDays, parseLocalDate } from '@/domain/dates'
import { epley, type MetricValue } from '@/domain/e1rm'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { WorkingSet } from '@/domain/types'
import { detectStall, seriesPoints, type MetricPoint, type SeriesSession } from './stall'

const DAY0 = parseLocalDate('2026-09-28')
const WINDOW = DEFAULT_SETTINGS.stallWindow

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x)) deepFreeze(v)
  }
  return x
}

const sets = (loadLb: number, ...reps: number[]): WorkingSet[] =>
  reps.map((r, setIndex) => ({ setIndex, loadLb, reps: r }))

function seriesSession(
  i: number,
  workingSets: WorkingSet[],
  extra: Partial<SeriesSession> = {},
): SeriesSession {
  return {
    sessionId: `s${i}`,
    date: addDays(DAY0, 7 * i),
    startedAt: Date.UTC(2026, 8, 28 + 7 * i, 17),
    isDeload: false,
    isCalibration: false,
    branch: 'same_plus_rep',
    bodyweightLb: null,
    sets: workingSets,
    ...extra,
  }
}

/** Points with the given total e1RMs, one session a week. */
const e1rmPoints = (...totals: number[]): MetricPoint[] =>
  totals.map((totalLb, i) => ({
    sessionId: `s${i}`,
    date: addDays(DAY0, 7 * i),
    startedAt: Date.UTC(2026, 8, 28 + 7 * i, 17),
    value: { kind: 'e1rm', totalLb, displayLb: totalLb },
  }))

const e1rmOf = (p: MetricPoint | null): number | null =>
  p?.value.kind === 'e1rm' ? p.value.totalLb : null

describe('seriesPoints', () => {
  it('takes each session’s best set and orders points by date, then start time', () => {
    const sessions = deepFreeze([
      seriesSession(2, sets(230, 8, 7, 7)),
      seriesSession(0, sets(220, 10, 9, 8)),
      seriesSession(1, sets(220, 10, 10, 9), {
        date: addDays(DAY0, 0),
        startedAt: Date.UTC(2026, 8, 28, 20),
      }),
    ])
    const points = seriesPoints(sessions, 'e1rm', { loadType: 'machine' }, 6)
    expect(points.map((p) => p.sessionId)).toEqual(['s0', 's1', 's2'])
    expect(points[2]?.value).toEqual<MetricValue>({
      kind: 'e1rm',
      totalLb: epley(230, 8),
      displayLb: epley(230, 8),
    })
  })

  it('excludes deload, calibration and post-drop sessions and sessions with no qualifying set', () => {
    const sessions = [
      seriesSession(0, sets(220, 10)),
      seriesSession(1, sets(200, 12), { isDeload: true }),
      seriesSession(2, sets(180, 12), { isCalibration: true }),
      seriesSession(3, sets(200, 10), { branch: 'drop' }),
      seriesSession(4, sets(220, 0)),
      seriesSession(5, []),
      seriesSession(6, sets(220, 9)),
    ]
    const points = seriesPoints(sessions, 'e1rm', { loadType: 'machine' }, 6)
    expect(points.map((p) => p.sessionId)).toEqual(['s0', 's6'])
  })

  it('uses each session’s bodyweight for chin-ups and skips sessions without one', () => {
    const sessions = [
      seriesSession(0, sets(50, 6), { bodyweightLb: 163 }),
      seriesSession(1, sets(50, 6), { bodyweightLb: null }),
      seriesSession(2, sets(50, 6), { bodyweightLb: 160 }),
    ]
    const points = seriesPoints(sessions, 'e1rm', { loadType: 'bodyweight_plus' }, 6)
    expect(points.map((p) => p.sessionId)).toEqual(['s0', 's2'])
    expect(e1rmOf(points[0] ?? null)).toBeCloseTo(255.6, 9)
    expect(e1rmOf(points[1] ?? null)).toBeCloseTo(252, 9)
  })

  it('reps-at-load only counts sets with reps ≥ repMin', () => {
    const sessions = [seriesSession(0, sets(45, 9)), seriesSession(1, sets(42.5, 14))]
    const points = seriesPoints(sessions, 'repsAtLoad', { loadType: 'machine' }, 10)
    expect(points).toHaveLength(1)
    expect(points[0]?.value).toEqual({ kind: 'repsAtLoad', loadLb: 42.5, reps: 14 })
  })
})

describe('detectStall', () => {
  it('needs at least window + 1 points', () => {
    expect(detectStall(e1rmPoints(300, 290, 280), WINDOW)).toEqual({
      stalled: false,
      bestBefore: null,
      bestRecent: null,
      sinceSessionId: null,
    })
    expect(detectStall(e1rmPoints(300, 290, 280, 270), WINDOW).stalled).toBe(true)
    expect(detectStall(e1rmPoints(300), 0).stalled).toBe(false)
  })

  it('stalls when the best of the last 3 sessions is no higher than the earlier best', () => {
    const r = detectStall(e1rmPoints(290, 300, 295, 300, 298), WINDOW)
    expect(r.stalled).toBe(true)
    expect(r.bestBefore?.sessionId).toBe('s1')
    expect(e1rmOf(r.bestBefore)).toBe(300)
    expect(r.bestRecent?.sessionId).toBe('s3')
    expect(r.sinceSessionId).toBe('s2')
  })

  it('does not stall while the window beats the earlier best, and clears on the next gain', () => {
    expect(detectStall(e1rmPoints(290, 300, 295, 301, 298), WINDOW).stalled).toBe(false)
    const stalled = e1rmPoints(290, 300, 295, 300, 298)
    expect(detectStall(stalled, WINDOW).stalled).toBe(true)
    expect(detectStall(e1rmPoints(290, 300, 295, 300, 298, 305), WINDOW).stalled).toBe(false)
  })

  it('treats e1RMs equal within the load tolerance as no gain', () => {
    // epley(250, 2) is a rounding error above epley(200, 10): the same e1RM, so still no gain.
    const points = e1rmPoints(epley(200, 10), 250, 255, epley(250, 2))
    expect(detectStall(points, WINDOW).stalled).toBe(true)
  })

  it('reps-at-load: more reps at the same load, or any heavier qualifying load, is a gain', () => {
    const at = (entries: [number, number][]): MetricPoint[] =>
      entries.map(([loadLb, reps], i) => ({
        sessionId: `s${i}`,
        date: addDays(DAY0, 7 * i),
        startedAt: i,
        value: { kind: 'repsAtLoad', loadLb, reps },
      }))
    expect(
      detectStall(
        at([
          [40, 15],
          [40, 14],
          [40, 15],
          [40, 15],
        ]),
        WINDOW,
      ).stalled,
    ).toBe(true)
    expect(
      detectStall(
        at([
          [40, 15],
          [40, 14],
          [40, 16],
          [40, 15],
        ]),
        WINDOW,
      ).stalled,
    ).toBe(false)
    expect(
      detectStall(
        at([
          [40, 20],
          [40, 14],
          [42.5, 10],
          [40, 15],
        ]),
        WINDOW,
      ).stalled,
    ).toBe(false)
  })

  it('uses the configured window', () => {
    expect(detectStall(e1rmPoints(300, 290, 280), 2).stalled).toBe(true)
    expect(detectStall(e1rmPoints(300, 290, 280, 301), 2).stalled).toBe(false)
  })
})
