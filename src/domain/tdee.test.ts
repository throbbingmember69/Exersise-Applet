import { describe, expect, it } from 'vitest'
import { addDays, parseLocalDate } from '@/domain/dates'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import { emaTrend, type TrendPoint } from '@/domain/trend'
import type { LocalDate, NutritionEntry, Settings } from '@/domain/types'
import {
  formulaTdee,
  loggingCoverage,
  measuredTdee,
  nextTdeeEstimate,
  phaseStartMaintenance,
  tdeeTimeline,
  type MeasuredTdeeInput,
  type TdeeCheckpoint,
} from './tdee'

const s = DEFAULT_SETTINGS
const day0 = parseLocalDate('2026-10-01')
const day = (n: number): LocalDate => addDays(day0, n)
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    Object.values(x).forEach(deepFreeze)
    Object.freeze(x)
  }
  return x
}

function intake(days: number[], kcal: number | null = 2500, updatedAt = 0): NutritionEntry[] {
  return days.map((n) => ({
    date: day(n),
    kcal,
    proteinG: null,
    carbsG: null,
    fatG: null,
    steps: null,
    updatedAt,
  }))
}

/** A straight-line trend: 180 lb on day 0, +0.05 lb/day. */
function linearTrend(from: number, to: number): TrendPoint[] {
  return range(from, to).map((n) => {
    const lb = 180 + 0.05 * n
    return { date: day(n), weightLb: lb, trendLb: lb, interpolated: false }
  })
}

// 31 days (day 0–30) fully logged: 2,500 kcal/day while the trend gains 0.05 lb/day.
// Over the 21-day window ΔT = T(30) − T(9) = 1.05 lb, so TDEE = 2500 − 3500 × 1.05 / 21 = 2325.
function full(overrides: Partial<MeasuredTdeeInput> = {}): MeasuredTdeeInput {
  return {
    asOf: day(30),
    intake: intake(range(0, 30)),
    weighInDates: range(0, 30).map(day),
    trend: linearTrend(0, 30),
    disruptions: [],
    ...overrides,
  }
}

describe('formulaTdee', () => {
  const seed = { trendLb: 163, heightIn: 71, age: 22, sex: 'male' as const }

  it('averages Katch-McArdle and Mifflin-St Jeor × activity factor', () => {
    const f = formulaTdee({ ...seed, bodyFatPct: 14.3 }, s)
    expect(f.method).toBe('avg')
    expect(f.katchMcArdle).toBeCloseTo(1738.636, 3)
    expect(f.mifflinStJeor).toBeCloseTo(1761.481, 3)
    expect(f.kcal).toBeCloseTo(2712.59, 3)
  })

  it('uses Mifflin-St Jeor alone when body fat is unknown', () => {
    const f = formulaTdee({ ...seed, bodyFatPct: null }, s)
    expect(f).toMatchObject({ method: 'mifflin_only', katchMcArdle: null })
    expect(f.kcal).toBeCloseTo(1761.4806 * 1.55, 3)
  })

  it('follows the activity factor setting', () => {
    const f = formulaTdee({ ...seed, bodyFatPct: 14.3 }, { ...s, activityFactor: 1.2 })
    expect(f.kcal).toBeCloseTo(1750.0582 * 1.2, 3)
  })
})

describe('measuredTdee', () => {
  it('is mean kcal − kcalPerLb × ΔT / L over the longest window', () => {
    const m = measuredTdee(deepFreeze(full()), s)
    expect(m).not.toBeNull()
    expect(m?.windowDays).toBe(21)
    expect(m?.startDate).toBe(day(10))
    expect(m?.intakePct).toBe(100)
    expect(m?.weighInPct).toBe(100)
    expect(m?.meanIntakeKcal).toBe(2500)
    expect(m?.trendChangeLb).toBeCloseTo(1.05, 9)
    expect(m?.trendDays).toBe(21)
    expect(m?.kcal).toBeCloseTo(2325, 6)
  })

  it('shortens the window until at least 80% of days have intake', () => {
    // No intake on days 10–14: 21 days → 16/21 = 76% (fails); 20 days → 16/20 = 80% (qualifies).
    const m = measuredTdee(full({ intake: intake([...range(0, 9), ...range(15, 30)]) }), s)
    expect(m?.windowDays).toBe(20)
    expect(m?.startDate).toBe(day(11))
    expect(m?.intakePct).toBe(80)
    expect(m?.kcal).toBeCloseTo(2325, 6)
  })

  it('also requires 80% of days with a weigh-in', () => {
    const gappy = range(0, 30)
      .filter((n) => n < 10 || n > 14)
      .map(day)
    expect(measuredTdee(full({ weighInDates: gappy }), s)?.windowDays).toBe(20)
    const everyOther = range(0, 30)
      .filter((n) => n % 2 === 0)
      .map(day)
    expect(measuredTdee(full({ weighInDates: everyOther }), s)).toBeNull()
  })

  it('does not count days whose kcal is empty, and takes the latest entry per date', () => {
    const blanks = [
      ...intake(range(0, 9)),
      ...intake(range(10, 14), null),
      ...intake(range(15, 30)),
    ]
    expect(measuredTdee(full({ intake: blanks }), s)?.windowDays).toBe(20)

    // Day 30 corrected to 4,600: mean = (20 × 2500 + 4600) / 21 = 2600.
    const corrected = [...intake(range(0, 30)), ...intake([30], 4600, 5)]
    expect(measuredTdee(full({ intake: corrected }), s)?.kcal).toBeCloseTo(2425, 6)
    expect(measuredTdee(full({ intake: [...corrected].reverse() }), s)?.kcal).toBeCloseTo(2425, 6)
  })

  it('starts the window at least 7 days after every phase start', () => {
    expect(measuredTdee(full({ disruptions: [day(3)] }), s)?.windowDays).toBe(21)
    expect(measuredTdee(full({ disruptions: [day(0), day(4)] }), s)?.windowDays).toBe(20)
    expect(measuredTdee(full({ disruptions: [day(17)] }), s)).toBeNull()
    expect(measuredTdee(full({ disruptions: [day(31)] }), s)?.windowDays).toBe(21)
  })

  it('starts ΔT at T0 when the trend begins inside the window', () => {
    // Weigh-ins (and the trend) begin on day 12: 19/21 days weighed in, so the 21-day window
    // (days 10–30) qualifies. ΔT = T(30) − T(12) = 0.9 lb over the 18 days it spans.
    const m = measuredTdee(
      full({ weighInDates: range(12, 30).map(day), trend: linearTrend(12, 30) }),
      s,
    )
    expect(m?.windowDays).toBe(21)
    expect(m?.startDate).toBe(day(10))
    expect(m?.trendChangeLb).toBeCloseTo(0.9, 9)
    expect(m?.trendDays).toBe(18)
    expect(m?.kcal).toBeCloseTo(2325, 6)
  })

  it('qualifies a fully logged window that starts on the first weigh-in', () => {
    // Logging starts on day 0: 14 logged days by day 13, and ΔT = T(13) − T(0) spans 13 days.
    const firstDays = (disruptions: LocalDate[]): MeasuredTdeeInput =>
      full({
        asOf: day(13),
        intake: intake(range(0, 13)),
        weighInDates: range(0, 13).map(day),
        trend: linearTrend(0, 13),
        disruptions,
      })
    // A phase start on day −7 pins the window to days 0–13: the 14-day minimum, fully logged.
    const pinned = measuredTdee(firstDays([day(-7)]), s)
    expect(pinned?.windowDays).toBe(14)
    expect(pinned?.startDate).toBe(day(0))
    expect(pinned?.intakePct).toBe(100)
    expect(pinned?.trendChangeLb).toBeCloseTo(0.65, 9)
    expect(pinned?.trendDays).toBe(13)
    expect(pinned?.kcal).toBeCloseTo(2325, 6)
    // With nothing to exclude, the longest window with 80% logged is 17 days (14/17 = 82%).
    const open = measuredTdee(firstDays([]), s)
    expect(open?.windowDays).toBe(17)
    expect(open?.startDate).toBe(day(-3))
    expect(open?.trendDays).toBe(13)
    expect(open?.kcal).toBeCloseTo(2325, 6)
  })

  it('ends ΔT at the last reading when the latest days have no weigh-in yet', () => {
    // No weigh-in on day 30: T(29) − T(9) = 1.0 lb over 20 days → 2325, not 2500 − 3500 / 21.
    const m = measuredTdee(
      full({ weighInDates: range(0, 29).map(day), trend: linearTrend(0, 29) }),
      s,
    )
    expect(m?.windowDays).toBe(21)
    expect(m?.weighInPct).toBeCloseTo((20 / 21) * 100, 9)
    expect(m?.trendChangeLb).toBeCloseTo(1, 9)
    expect(m?.trendDays).toBe(20)
    expect(m?.kcal).toBeCloseTo(2325, 6)

    // Four days without a weigh-in (17/21 = 81% still qualifies): T(26) − T(9) over 17 days.
    const late = measuredTdee(
      full({ weighInDates: range(0, 26).map(day), trend: linearTrend(0, 26) }),
      s,
    )
    expect(late?.windowDays).toBe(21)
    expect(late?.trendDays).toBe(17)
    expect(late?.kcal).toBeCloseTo(2325, 6)
  })

  it('does not bias an EMA trend toward intake when the last weigh-ins are missing', () => {
    // 3,000 kcal/day while weight rises 0.1 lb/day (true TDEE 2,650), EMA α 0.1.
    const emaTo = (last: number): TrendPoint[] =>
      emaTrend(
        range(0, last).map((n) => ({ date: day(n), weightLb: 180 + 0.1 * n, interpolated: false })),
        s.trendAlpha,
      )
    const probe = (lastWeighIn: number) =>
      measuredTdee(
        {
          asOf: day(39),
          intake: intake(range(0, 39), 3000),
          weighInDates: range(0, lastWeighIn).map(day),
          trend: emaTo(lastWeighIn),
          disruptions: [],
        },
        s,
      )
    const everyDay = probe(39)
    const stale = probe(35) // 17/21 days weighed in
    expect(everyDay?.kcal).toBeCloseTo(2670.05, 1)
    expect(stale?.windowDays).toBe(21)
    expect(stale?.trendDays).toBe(17)
    expect(stale?.kcal).toBeCloseTo(2673.17, 1) // ΔT / 21 would give 2,735
  })

  it('returns null without enough data', () => {
    expect(measuredTdee(full({ intake: [] }), s)).toBeNull()
    expect(measuredTdee(full({ trend: [] }), s)).toBeNull()
    const lenient: Settings = { ...s, tdeeMinLoggedPct: 0 }
    expect(measuredTdee(full({ intake: [] }), lenient)).toBeNull()
    // Under one day of trend inside the window: ending before it, or only on the as-of day.
    expect(measuredTdee(full({ trend: linearTrend(0, 5) }), lenient)).toBeNull()
    expect(measuredTdee(full({ trend: linearTrend(30, 30) }), lenient)).toBeNull()
    expect(measuredTdee(full({ trend: linearTrend(31, 40) }), lenient)).toBeNull()
  })

  it('follows the window settings, even when min and max are swapped', () => {
    const swapped: Settings = { ...s, tdeeWindowMinDays: 21, tdeeWindowMaxDays: 14 }
    expect(measuredTdee(full(), swapped)?.windowDays).toBe(21)
    const short: Settings = { ...s, tdeeWindowMinDays: 7, tdeeWindowMaxDays: 7 }
    const m = measuredTdee(full(), short)
    expect(m?.windowDays).toBe(7)
    expect(m?.kcal).toBeCloseTo(2325, 6)
  })
})

describe('loggingCoverage', () => {
  it('reports the share of days with intake and with a weigh-in', () => {
    const c = loggingCoverage({
      from: day(0),
      to: day(6),
      intake: intake(range(0, 4)),
      weighInDates: range(0, 6).map(day),
    })
    expect(c).toEqual({
      days: 7,
      intakeDays: 5,
      weighInDays: 7,
      intakePct: (5 / 7) * 100,
      weighInPct: 100,
    })
  })

  it('is all zero for an empty range', () => {
    const c = loggingCoverage({ from: day(6), to: day(0), intake: [], weighInDates: [] })
    expect(c).toEqual({ days: 0, intakeDays: 0, weighInDays: 0, intakePct: 0, weighInPct: 0 })
  })
})

describe('tdeeTimeline', () => {
  const cp = (n: number, measuredKcal: number | null, formulaKcal = 2700): TdeeCheckpoint => ({
    date: day(7 * n),
    measuredKcal,
    formulaKcal,
  })

  it('uses the formula until the first measurement, which replaces it uncapped', () => {
    const t = tdeeTimeline([cp(1, null, 2700), cp(2, null, 2710), cp(3, 2900, 2710)], s)
    expect(t.map((p) => [p.kcal, p.source, p.capped])).toEqual([
      [2700, 'formula', false],
      [2710, 'formula', false],
      [2900, 'measured', false],
    ])
  })

  it('caps later changes at ±150 of the previous estimate and keeps it when data is short', () => {
    const t = tdeeTimeline(
      [cp(3, 2900), cp(4, 3200), cp(5, null), cp(6, 2800), cp(7, 3050), cp(8, 3000)],
      s,
    )
    expect(t.map((p) => [p.kcal, p.source, p.capped, p.measuredKcal])).toEqual([
      [2900, 'measured', false, 2900],
      [3050, 'measured', true, 3200],
      [3050, 'insufficient_data', false, null],
      [2900, 'measured', true, 2800],
      [3050, 'measured', false, 3050], // exactly +150: not clamped
      [3000, 'measured', false, 3000],
    ])
  })

  it('orders checkpoints by date and can continue from an earlier estimate', () => {
    const t = tdeeTimeline([cp(2, 3000), cp(1, 2500)], s, {
      kcal: 2600,
      source: 'measured',
      capped: false,
    })
    expect(t.map((p) => [p.date, p.kcal, p.capped])).toEqual([
      [day(7), 2500, false],
      [day(14), 2650, true],
    ])
  })

  it('follows the cap setting', () => {
    const prev = { kcal: 2900, source: 'measured' as const, capped: false }
    expect(nextTdeeEstimate(prev, 2600, 2700, { ...s, tdeeMaxWeeklyChangeKcal: 100 })).toEqual({
      kcal: 2800,
      source: 'measured',
      capped: true,
    })
    expect(nextTdeeEstimate(null, 3400, 2700, s)).toEqual({
      kcal: 3400,
      source: 'measured',
      capped: false,
    })
  })
})

describe('phaseStartMaintenance', () => {
  it('prefers the last valid measured estimate, else the formula', () => {
    expect(phaseStartMaintenance(null, 2712.6)).toEqual({ kcal: 2712.6, source: 'formula' })
    expect(phaseStartMaintenance({ kcal: 2700, source: 'formula', capped: false }, 2712.6)).toEqual(
      { kcal: 2712.6, source: 'formula' },
    )
    expect(phaseStartMaintenance({ kcal: 2950, source: 'measured', capped: true }, 2712.6)).toEqual(
      { kcal: 2950, source: 'measured' },
    )
    expect(
      phaseStartMaintenance({ kcal: 2950, source: 'insufficient_data', capped: false }, 2712.6),
    ).toEqual({ kcal: 2950, source: 'measured' })
  })
})
