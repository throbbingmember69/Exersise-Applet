// Main-lift strength slide, used to prompt ending a cut.
//
// Per main-lift series, the best total e1RM in the last `strengthWindowDays` days (ending asOf) is
// compared with the best in a window of the same length ending `strengthLookbackDays` earlier
// (defaults: [asOf−6, asOf] vs [asOf−27, asOf−21]). Lifts missing data in either window are
// skipped; a variant swap is a different series, so it is skipped too. The slide triggers when the
// mean change across the remaining lifts is below −cutStrengthDropPct. Chin-ups use total-load
// e1RM (bodyweight + added), so bodyweight loss alone moves them only slightly.
import { addDays, dayNumber } from '@/domain/dates'
import { mean } from '@/domain/rounding'
import type { Settings } from '@/domain/settings/registry'
import type { LocalDate } from '@/domain/types'

export interface StrengthPoint {
  date: LocalDate
  /** The session's best total e1RM (bodyweight + added for bodyweight_plus). */
  totalLb: number
}

/** One main lift's points, e.g. from `seriesPoints(…, 'e1rm', …)` (deload/calibration/post-drop excluded). */
export interface StrengthSeries {
  key: string
  points: readonly StrengthPoint[]
}

export interface LiftChange {
  key: string
  earlierBestLb: number | null
  recentBestLb: number | null
  /** null when either window has no data (the lift is skipped). */
  changePct: number | null
}

export interface MainLiftSlide {
  /** Mean change across lifts with data in both windows; null when there are none. */
  meanChangePct: number | null
  perLift: LiftChange[]
  triggered: boolean
  windows: { recent: [LocalDate, LocalDate]; earlier: [LocalDate, LocalDate] }
}

/** Compare recent best e1RMs with those a lookback earlier and flag a mean drop past the threshold. */
export function mainLiftSlide(
  series: readonly StrengthSeries[],
  asOf: LocalDate,
  settings: Settings,
): MainLiftSlide {
  const span = Math.max(1, settings.strengthWindowDays) - 1
  const recent: [LocalDate, LocalDate] = [addDays(asOf, -span), asOf]
  const earlierEnd = addDays(asOf, -settings.strengthLookbackDays)
  const earlier: [LocalDate, LocalDate] = [addDays(earlierEnd, -span), earlierEnd]

  const perLift = series.map((s): LiftChange => {
    const recentBestLb = bestIn(s.points, recent)
    const earlierBestLb = bestIn(s.points, earlier)
    const changePct =
      recentBestLb !== null && earlierBestLb !== null && earlierBestLb > 0
        ? ((recentBestLb - earlierBestLb) / earlierBestLb) * 100
        : null
    return { key: s.key, earlierBestLb, recentBestLb, changePct }
  })

  const meanChangePct = mean(perLift.flatMap((l) => (l.changePct === null ? [] : [l.changePct])))
  return {
    meanChangePct,
    perLift,
    triggered: meanChangePct !== null && meanChangePct < -settings.cutStrengthDropPct,
    windows: { recent, earlier },
  }
}

function bestIn(
  points: readonly StrengthPoint[],
  [from, to]: [LocalDate, LocalDate],
): number | null {
  const lo = dayNumber(from)
  const hi = dayNumber(to)
  let best: number | null = null
  for (const p of points) {
    const d = dayNumber(p.date)
    if (d >= lo && d <= hi && (best === null || p.totalLb > best)) best = p.totalLb
  }
  return best
}
