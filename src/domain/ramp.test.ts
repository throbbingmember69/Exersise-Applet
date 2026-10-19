import { describe, expect, it } from 'vitest'
import { pickRampSlot, rampDueDate, type RampSlot } from './ramp'
import type { LocalDate, MuscleWeights } from './types'

const d = (s: string) => s as LocalDate
const PULL: MuscleWeights = { back: 1, upper_back: 0.5, biceps: 0.5 }

// Shaped like the back-focus program: Pull carries 7.5 lat sets, Upper 4.5.
const SLOTS: RampSlot[] = [
  { slotId: 'pull-chin', programDayId: 'pull', sets: 3, weights: PULL },
  { slotId: 'pull-row', programDayId: 'pull', sets: 3, weights: { upper_back: 1, back: 0.5 } },
  { slotId: 'pull-rocking', programDayId: 'pull', sets: 3, weights: PULL },
  { slotId: 'pull-curl', programDayId: 'pull', sets: 3, weights: { biceps: 1 } },
  { slotId: 'upper-pulldown', programDayId: 'upper', sets: 3, weights: PULL },
  { slotId: 'upper-row', programDayId: 'upper', sets: 3, weights: { upper_back: 1, back: 0.5 } },
]

describe('pickRampSlot', () => {
  it('adds to the day where the muscle has the least volume', () => {
    expect(pickRampSlot('back', SLOTS, { cap: 11, maxSets: 5 })).toEqual({
      slotId: 'upper-pulldown',
      fromSets: 3,
    })
  })

  it('only uses exercises that train the muscle as their main muscle', () => {
    // The rows train lats at ½: never chosen for lats, even with room.
    const rowsOnly = SLOTS.filter((s) => s.slotId.endsWith('row'))
    expect(pickRampSlot('back', rowsOnly, { cap: 11, maxSets: 5 })).toBeNull()
  })

  it('respects the most sets per exercise, then falls back to another day', () => {
    const full = SLOTS.map((s) => (s.slotId === 'upper-pulldown' ? { ...s, sets: 5 } : s))
    expect(pickRampSlot('back', full, { cap: 11, maxSets: 5 })).toEqual({
      slotId: 'pull-chin',
      fromSets: 3,
    })
  })

  it('never pushes any muscle the exercise trains past the session cap', () => {
    // Pull biceps: 1.5 + 1.5 + 3 = 6; with a cap of 6.4 another pulldown set (+0.5) won't fit.
    const capped = SLOTS.filter((s) => s.programDayId === 'pull')
    expect(pickRampSlot('back', capped, { cap: 6.4, maxSets: 5 })).toBeNull()
    expect(pickRampSlot('back', capped, { cap: 11, maxSets: 5 })?.slotId).toBe('pull-chin')
  })
})

describe('rampDueDate', () => {
  it('counts from the latest of the bulk start, tracking start and last answer', () => {
    const base = {
      phaseStart: d('2026-10-01'),
      trackedFrom: null,
      lastAnswered: null,
      everyWeeks: 3,
    }
    expect(rampDueDate(base)).toBe('2026-10-22')
    expect(rampDueDate({ ...base, trackedFrom: d('2026-10-19') })).toBe('2026-11-09')
    expect(rampDueDate({ ...base, lastAnswered: d('2026-11-15') })).toBe('2026-12-06')
    expect(rampDueDate({ ...base, trackedFrom: d('2026-09-01') })).toBe('2026-10-22')
  })
})
