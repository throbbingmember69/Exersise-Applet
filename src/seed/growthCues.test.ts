import { describe, expect, it } from 'vitest'
import { GROWTH_CUES, growthCuesFor } from './growthCues'
import { SEED } from './index'

describe('growth cues', () => {
  it('cover the default exercise of every active program slot', () => {
    const activeDays = new Set(
      SEED.programDays.filter((d) => d.archivedAt === null).map((d) => d.id),
    )
    const defaults = SEED.programSlots
      .filter((s) => s.archivedAt === null && activeDays.has(s.programDayId))
      .map((s) => s.defaultExerciseId)
    for (const id of defaults) expect(growthCuesFor(id).length, id).toBeGreaterThan(0)
  })

  it('cover the program exercises a swap replaced, which stay as alternates', () => {
    for (const id of [
      'ex-deadlift',
      'ex-db-hammer-curl',
      'ex-rocking-pulldown',
      'ex-straight-bar-pushdown',
      'ex-barbell-shrug',
    ])
      expect(growthCuesFor(id).length, id).toBeGreaterThan(0)
  })

  it('are short, give a reason, and only name library exercises', () => {
    const ids = new Set(SEED.exercises.map((e) => e.id))
    for (const [id, cues] of Object.entries(GROWTH_CUES)) {
      expect(ids.has(id), id).toBe(true)
      expect(cues.length, id).toBeLessThanOrEqual(2)
      for (const { cue, why } of cues) {
        expect(cue.length, cue).toBeLessThanOrEqual(100)
        expect(why.length, why).toBeGreaterThan(20)
        expect(why.length, why).toBeLessThanOrEqual(140)
      }
    }
    expect(growthCuesFor('ex-user-1')).toEqual([])
  })
})
