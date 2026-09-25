// Weekly check-in (findings #32–#34, #48; DECISIONS "Check-ins"). Check-ins are due every 7 days
// from the phase start and are evaluated as of the due date. The first checkinNoChangeWeeks weeks
// never change calories (water and glycogen shift) and never count as misses. A change needs
// checkinMissesRequired consecutive misses in the same direction; an accepted or manual target
// change resets the streak, a skip does not.
// Sign convention: bands are stored with minPct < maxPct numerically (cut −0.75 < −0.5), so for
// every phase a rate below the band is 'low' and above it is 'high'. 'low' always suggests
// +step (a bulk gaining too slowly, a cut losing too fast, maintenance losing) and 'high' −step (a
// bulk gaining too fast, a cut losing too slowly, maintenance gaining). A cut losing too slowly
// also offers extra daily steps instead.
import { addDays, compareLocalDate, daysBetween } from '@/domain/dates'
import type { RateBand } from '@/domain/nutritionTargets'
import type {
  CheckInSuggestionType,
  LocalDate,
  MissDirection,
  PhaseType,
  Settings,
} from '@/domain/types'

const DAYS_PER_WEEK = 7

export interface CheckinWeek {
  /** 1-based week of the phase that ends on `dueDate`. */
  weekIndex: number
  dueDate: LocalDate
}

/** Reserved for diet breaks (not in v1). */
export interface CheckinPause {
  startDate: LocalDate
  endDate: LocalDate
}

export interface WeekMiss {
  weekIndex: number
  direction: MissDirection | null
}

export interface MissStreak {
  direction: MissDirection | null
  count: number
}

export interface CheckinInput {
  phaseType: PhaseType
  band: RateBand
  weekIndex: number
  /** `weeklyRatePct(trend, dueDate)`; null when the trend doesn't cover the week. */
  ratePct: number | null
  /**
   * Earlier weeks of this phase. Entries at or after `weekIndex` are ignored (an entry for
   * `weekIndex` is replaced by this evaluation), so a full phase history can be passed.
   */
  priorWeeks: readonly WeekMiss[]
  /** Weeks up to this index are ignored: the last accepted or manual target change. 0 if none. */
  lastResetWeekIndex: number
}

export interface CheckinEvaluation {
  suggestionType: CheckInSuggestionType
  /** Signed kcal/day (0 when no change is suggested). */
  suggestedKcalChange: number
  stepsAlternative: number | null
  missDirection: MissDirection | null
  missStreak: number
}

/** Due check-ins up to `asOf`: week k is due on phaseStart + 7k. */
export function checkinSchedule(
  phaseStart: LocalDate,
  asOf: LocalDate,
  pauses: readonly CheckinPause[] = [],
): CheckinWeek[] {
  if (pauses.length > 0) throw new RangeError('Check-in pauses (diet breaks) are not supported yet')
  const out: CheckinWeek[] = []
  for (let k = 1; ; k++) {
    const dueDate = addDays(phaseStart, DAYS_PER_WEEK * k)
    if (compareLocalDate(dueDate, asOf) > 0) return out
    out.push({ weekIndex: k, dueDate })
  }
}

/** 'low' below the band, 'high' above it, null inside it (edges count as inside). */
export function missDirection(ratePct: number, band: RateBand): MissDirection | null {
  if (ratePct < Math.min(band.minPct, band.maxPct)) return 'low'
  if (ratePct > Math.max(band.minPct, band.maxPct)) return 'high'
  return null
}

/**
 * Consecutive same-direction misses ending at the latest week, ignoring the no-change weeks and
 * weeks up to `lastResetWeekIndex`. An in-band or no-data week, or a missing week, breaks it.
 */
export function missStreak(
  weeks: readonly WeekMiss[],
  lastResetWeekIndex: number,
  s: Settings,
): MissStreak {
  const floor = Math.max(s.checkinNoChangeWeeks, lastResetWeekIndex)
  const sorted = [...weeks].sort((a, b) => b.weekIndex - a.weekIndex)
  const latest = sorted[0]
  if (!latest || latest.weekIndex <= floor || latest.direction === null) {
    return { direction: null, count: 0 }
  }
  let count = 0
  let expected = latest.weekIndex
  for (const w of sorted) {
    if (w.weekIndex <= floor || w.weekIndex !== expected || w.direction !== latest.direction) break
    count++
    expected--
  }
  return { direction: latest.direction, count }
}

/**
 * The reset index for a target change effective on `effectiveDate`: the last check-in week with
 * any day before the change. A change accepted at week k (effective the next day) gives k.
 */
export function resetWeekIndex(phaseStart: LocalDate, effectiveDate: LocalDate): number {
  return Math.max(0, Math.ceil((daysBetween(phaseStart, effectiveDate) - 1) / DAYS_PER_WEEK))
}

function kcalStep(type: PhaseType, direction: MissDirection, s: Settings): number {
  const step = type === 'maintenance' ? s.checkinMaintStepKcal : s.checkinStepKcal
  return direction === 'low' ? step : -step
}

/** The check-in suggestion for one week of a phase. */
export function evaluateCheckin(input: CheckinInput, s: Settings): CheckinEvaluation {
  const { phaseType, band, weekIndex, ratePct } = input
  const direction = ratePct === null ? null : missDirection(ratePct, band)
  const none = (suggestionType: CheckInSuggestionType, streak = 0): CheckinEvaluation => ({
    suggestionType,
    suggestedKcalChange: 0,
    stepsAlternative: null,
    missDirection: direction,
    missStreak: streak,
  })

  if (weekIndex <= s.checkinNoChangeWeeks) return none('none_first_week')
  if (ratePct === null) return none('none_insufficient')
  if (direction === null) return none('none_in_band')

  const weeks = [
    ...input.priorWeeks.filter((w) => w.weekIndex < weekIndex),
    { weekIndex, direction },
  ]
  const streak = missStreak(weeks, input.lastResetWeekIndex, s).count
  if (streak < s.checkinMissesRequired) return none('none_streak', streak)

  return {
    suggestionType: 'kcal_change',
    suggestedKcalChange: kcalStep(phaseType, direction, s),
    stepsAlternative: phaseType === 'cut' && direction === 'high' ? s.cutStepsAlternative : null,
    missDirection: direction,
    missStreak: streak,
  }
}
