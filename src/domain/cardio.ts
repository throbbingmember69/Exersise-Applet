// Post-workout cardio: the ramping target and the suggested machine. Pure, replayed from history
// each time (nothing is stored), like the progression engine.
//
// Target: cardioStartMin (10) minutes to begin with. After each completed training week (weeks
// start on trainingWeekStartDay) in which at least cardioAdvanceSessions (3) counted workouts had
// cardio totalling that week's target or more, the next week's target rises by cardioStepMin (5),
// up to cardioMaxMin (30). A week short of that holds the target; it never drops.
//
// Machine: easy, low-impact cardio done after lifting. Cycling interfered least with leg growth in
// concurrent-training studies (Wilson 2012), so a day whose planned sets are mostly lower body
// (cardioBikeLegSharePct) suggests the bike; other days suggest the machine used last time, or an
// incline walk.
import { addDays, compareLocalDate, weekStart } from './dates'
import type { Settings } from './settings/registry'
import type { CardioLog, CardioModality, LocalDate, MuscleId, Session, Weekday } from './types'

export const CARDIO_MODALITIES: readonly CardioModality[] = [
  'bike',
  'incline_walk',
  'elliptical',
  'rower',
  'stair',
  'run',
  'other',
]

/** Muscles whose share of a day's planned sets makes it a leg day. */
export const LOWER_BODY_MUSCLES: ReadonlySet<MuscleId> = new Set([
  'quads',
  'hamstrings',
  'glutes',
  'calves',
])

export interface CardioTarget {
  /** Minutes to aim for after each workout this week. */
  minutes: number
  /** First day of the training week `date` falls in. */
  weekStart: LocalDate
  /** Counted workouts this week (so far) whose cardio met `minutes`. */
  sessionsAtTarget: number
  /** How many such workouts this week raise next week's target. */
  sessionsNeeded: number
  /** Next week's target if this week qualifies. */
  nextMinutes: number
  atMax: boolean
}

type CardioSession = Pick<Session, 'id' | 'date' | 'status' | 'voidedAt'>

/** Total cardio minutes per counted (finished, not voided) session, with each session's date. */
function minutesBySession(
  sessions: readonly CardioSession[],
  logs: readonly Pick<CardioLog, 'sessionId' | 'minutes' | 'voidedAt'>[],
): Map<string, { date: LocalDate; minutes: number }> {
  const counted = new Map(
    sessions
      .filter((s) => s.status === 'finished' && s.voidedAt === null)
      .map((s) => [s.id, s.date] as const),
  )
  const out = new Map<string, { date: LocalDate; minutes: number }>()
  for (const log of logs) {
    if (log.voidedAt !== null) continue
    const date = counted.get(log.sessionId)
    if (date === undefined) continue
    const cur = out.get(log.sessionId)
    out.set(log.sessionId, { date, minutes: (cur?.minutes ?? 0) + log.minutes })
  }
  return out
}

/** This week's cardio target for `date`, replayed from every earlier week's cardio. */
export function cardioTarget(
  input: {
    sessions: readonly CardioSession[]
    logs: readonly Pick<CardioLog, 'sessionId' | 'minutes' | 'voidedAt'>[]
  },
  date: LocalDate,
  s: Pick<
    Settings,
    | 'cardioStartMin'
    | 'cardioStepMin'
    | 'cardioMaxMin'
    | 'cardioAdvanceSessions'
    | 'trainingWeekStartDay'
  >,
): CardioTarget {
  const startDay = s.trainingWeekStartDay as Weekday
  const max = Math.max(s.cardioStartMin, s.cardioMaxMin)
  const thisWeek = weekStart(date, startDay)
  // Minutes per session, grouped by training week.
  const byWeek = new Map<LocalDate, number[]>()
  for (const { date: d, minutes } of minutesBySession(input.sessions, input.logs).values()) {
    const w = weekStart(d, startDay)
    const list = byWeek.get(w) ?? []
    list.push(minutes)
    byWeek.set(w, list)
  }
  const atTarget = (week: LocalDate, target: number) =>
    (byWeek.get(week) ?? []).filter((m) => m >= target).length

  let minutes = Math.min(s.cardioStartMin, max)
  const weeks = [...byWeek.keys()].sort(compareLocalDate)
  const first = weeks[0]
  if (first !== undefined) {
    for (let w = first; compareLocalDate(w, thisWeek) < 0; w = addDays(w, 7)) {
      if (atTarget(w, minutes) >= s.cardioAdvanceSessions) {
        minutes = Math.min(max, minutes + s.cardioStepMin)
      }
    }
  }
  return {
    minutes,
    weekStart: thisWeek,
    sessionsAtTarget: atTarget(thisWeek, minutes),
    sessionsNeeded: s.cardioAdvanceSessions,
    nextMinutes: Math.min(max, minutes + s.cardioStepMin),
    atMax: minutes >= max,
  }
}

/** Share (%) of a day's planned sets that train the lower body; null for an empty day. */
export function lowerBodySharePct(dayVolume: ReadonlyMap<MuscleId, number>): number | null {
  let total = 0
  let lower = 0
  for (const [muscle, sets] of dayVolume) {
    total += sets
    if (LOWER_BODY_MUSCLES.has(muscle)) lower += sets
  }
  return total > 0 ? (lower / total) * 100 : null
}

/** A day whose planned sets are at least `cardioBikeLegSharePct` lower body. */
export function isLegDay(
  dayVolume: ReadonlyMap<MuscleId, number> | null,
  s: Pick<Settings, 'cardioBikeLegSharePct'>,
): boolean {
  const share = dayVolume ? lowerBodySharePct(dayVolume) : null
  return share !== null && share >= s.cardioBikeLegSharePct
}

/**
 * The machine to suggest after a workout: the bike on a leg day (see isLegDay), else the last
 * machine used, else an incline walk.
 */
export function suggestedCardioModality(
  dayVolume: ReadonlyMap<MuscleId, number> | null,
  lastModality: CardioModality | null,
  s: Pick<Settings, 'cardioBikeLegSharePct'>,
): CardioModality {
  if (isLegDay(dayVolume, s)) return 'bike'
  return lastModality ?? 'incline_walk'
}
