import { describe, expect, it } from 'vitest'
import { addDays, parseLocalDate } from '@/domain/dates'
import { epley } from '@/domain/e1rm'
import { DEFAULT_SETTINGS, resolveSettings, type Settings } from '@/domain/settings/registry'
import type { LocalDate } from '@/domain/types'
import { mainLiftSlide as mainLiftSlideRaw, type StrengthSeries } from './strength'

/** Recursively freezes a test input so any mutation throws (proves the function is pure). */
function deepFreeze<T>(x: T, seen = new WeakSet<object>()): T {
  if (x !== null && typeof x === 'object' && !seen.has(x)) {
    seen.add(x)
    for (const v of Object.values(x)) deepFreeze(v, seen)
    Object.freeze(x)
  }
  return x
}

/** mainLiftSlide on frozen inputs. */
const mainLiftSlide = (series: StrengthSeries[], asOf: LocalDate, settings: Settings) =>
  mainLiftSlideRaw(deepFreeze(series), asOf, deepFreeze(settings))

const AS_OF = parseLocalDate('2026-10-30')
const S = DEFAULT_SETTINGS

/** A point `daysAgo` before AS_OF (negative = after it). */
const pt = (daysAgo: number, totalLb: number) => ({ date: addDays(AS_OF, -daysAgo), totalLb })

describe('mainLiftSlide', () => {
  it('compares the last 7 days with the 7 days ending 21 days earlier', () => {
    const r = mainLiftSlide([], AS_OF, S)
    expect(r.windows).toEqual({
      recent: ['2026-10-24', '2026-10-30'],
      earlier: ['2026-10-03', '2026-10-09'],
    })
    expect(r).toMatchObject({ meanChangePct: null, perLift: [], triggered: false })
  })

  it('triggers when the mean change across lifts is below −5%, skipping lifts without data', () => {
    const series: StrengthSeries[] = [
      { key: 'ex-smith-squat|*', points: [pt(25, 290), pt(22, 300), pt(10, 310), pt(3, 282)] },
      { key: 'ex-ohp|*', points: [pt(24, 200), pt(1, 190)] },
      { key: 'ex-deadlift|*', points: [pt(23, 400)] }, // nothing recent: skipped
    ]
    const r = mainLiftSlide(series, AS_OF, S)
    expect(r.perLift).toEqual([
      { key: 'ex-smith-squat|*', earlierBestLb: 300, recentBestLb: 282, changePct: -6 },
      { key: 'ex-ohp|*', earlierBestLb: 200, recentBestLb: 190, changePct: -5 },
      { key: 'ex-deadlift|*', earlierBestLb: 400, recentBestLb: null, changePct: null },
    ])
    expect(r.meanChangePct).toBeCloseTo(-5.5, 9)
    expect(r.triggered).toBe(true)
  })

  it('does not trigger at exactly −5%', () => {
    const r = mainLiftSlide([{ key: 'a', points: [pt(21, 200), pt(0, 190)] }], AS_OF, S)
    expect(r.meanChangePct).toBeCloseTo(-5, 9)
    expect(r.triggered).toBe(false)
  })

  it('includes both ends of each window and nothing outside them', () => {
    // Each window's best sits on one of its ends; every heavier point is one day outside a window
    // (before, between or after them), so an off-by-one at any of the four bounds changes a best.
    const outside = [pt(28, 500), pt(20, 500), pt(7, 500), pt(-1, 500)]
    const edges = mainLiftSlide(
      [
        { key: 'lower-ends', points: [...outside, pt(27, 100), pt(6, 90)] },
        { key: 'upper-ends', points: [...outside, pt(21, 100), pt(0, 90)] },
      ],
      AS_OF,
      S,
    )
    expect(edges.perLift).toEqual([
      { key: 'lower-ends', earlierBestLb: 100, recentBestLb: 90, changePct: -10 },
      { key: 'upper-ends', earlierBestLb: 100, recentBestLb: 90, changePct: -10 },
    ])
  })

  it('chin-ups use total-load e1RM, so bodyweight loss alone stays well under the trigger', () => {
    // Same +50 × 6 while bodyweight falls 165 → 162 over three weeks.
    const chin = [
      { key: 'ex-chin-up|*', points: [pt(21, epley(165 + 50, 6)), pt(0, epley(162 + 50, 6))] },
    ]
    const r = mainLiftSlide(chin, AS_OF, S)
    expect(r.meanChangePct).toBeCloseTo(-1.395, 3)
    expect(r.triggered).toBe(false)
  })

  it('uses the configured threshold and windows', () => {
    const s = resolveSettings({
      cutStrengthDropPct: 2,
      strengthLookbackDays: 14,
      strengthWindowDays: 3,
    })
    // Heavier points one day outside each 3-day window are ignored.
    const r = mainLiftSlide(
      [
        {
          key: 'a',
          points: [pt(17, 500), pt(16, 200), pt(13, 300), pt(3, 500), pt(2, 196), pt(-1, 500)],
        },
      ],
      AS_OF,
      s,
    )
    expect(r.windows).toEqual({
      recent: ['2026-10-28', '2026-10-30'],
      earlier: ['2026-10-14', '2026-10-16'],
    })
    expect(r.perLift[0]).toMatchObject({ earlierBestLb: 200, recentBestLb: 196, changePct: -2 })
    expect(r.triggered).toBe(false)
    expect(
      mainLiftSlide([{ key: 'a', points: [pt(16, 200), pt(2, 195)] }], AS_OF, s).triggered,
    ).toBe(true)
  })

  it('skips a lift whose earlier best is not positive', () => {
    const r = mainLiftSlide([{ key: 'a', points: [pt(21, 0), pt(0, 100)] }], AS_OF, S)
    expect(r.perLift[0]?.changePct).toBeNull()
    expect(r.meanChangePct).toBeNull()
  })
})
