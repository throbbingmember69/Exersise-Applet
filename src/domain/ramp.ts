// Volume ramp for lagging muscles (spec: on a bulk, add a set to a lagging muscle every 3–4
// weeks): when the next +1 set is due, and which program slot takes it. Pure; the service reads
// the phase, the suggestion log and the program, and writes the accepted change.
import { addDays, compareLocalDate } from './dates'
import type { LocalDate, MuscleId, MuscleWeights } from './types'

export interface RampSlot {
  slotId: string
  programDayId: string
  sets: number
  /** Weights of the exercise the slot resolves to at the gym. */
  weights: MuscleWeights
}

export interface RampPick {
  slotId: string
  fromSets: number
}

/**
 * The slot that takes a lagging muscle's next set: one whose exercise trains the muscle as its
 * main muscle (weight 1) and has fewer than `maxSets` sets, where one more set keeps every muscle
 * that exercise trains at or under the per-session `cap` that day. Preference: the day where the
 * muscle has the least volume (spreads it out), then the slot with fewer sets, then program order.
 * `slots` are the active slots of active days, in program order. null when no slot has room.
 */
export function pickRampSlot(
  muscleId: MuscleId,
  slots: readonly RampSlot[],
  opts: { cap: number; maxSets: number },
): RampPick | null {
  const dayVolume = new Map<string, Map<MuscleId, number>>()
  for (const s of slots) {
    const day = dayVolume.get(s.programDayId) ?? new Map<MuscleId, number>()
    for (const [m, w] of Object.entries(s.weights)) day.set(m, (day.get(m) ?? 0) + s.sets * w)
    dayVolume.set(s.programDayId, day)
  }
  let best: RampPick | null = null
  let bestKey: readonly number[] = []
  slots.forEach((s, index) => {
    if (s.weights[muscleId] !== 1 || s.sets >= opts.maxSets) return
    const day = dayVolume.get(s.programDayId)!
    const fits = Object.entries(s.weights).every(([m, w]) => (day.get(m) ?? 0) + w <= opts.cap)
    if (!fits) return
    const key = [day.get(muscleId) ?? 0, s.sets, index]
    if (best === null || lexLess(key, bestKey)) {
      best = { slotId: s.slotId, fromSets: s.sets }
      bestKey = key
    }
  })
  return best
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!
  }
  return false
}

/**
 * When the next ramp set is due: `everyWeeks` after the latest of the bulk's start, the day the
 * muscle started being tracked, and the last answered ramp prompt for it.
 */
export function rampDueDate(input: {
  phaseStart: LocalDate
  trackedFrom: LocalDate | null
  lastAnswered: LocalDate | null
  everyWeeks: number
}): LocalDate {
  let base = input.phaseStart
  for (const d of [input.trackedFrom, input.lastAnswered]) {
    if (d !== null && compareLocalDate(d, base) > 0) base = d
  }
  return addDays(base, Math.round(input.everyWeeks * 7))
}
