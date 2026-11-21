import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { ProgramSlot } from '@/domain/types'
import { overSessionCap, plannedDayVolume, plannedWeeklyVolume } from '@/domain/volume'
import { NOVEMBER_SEED, OCTOBER_SEED } from './index'
import { type ProgramTables } from './update2026-10'
import { applyUpdate2026_11, NOVEMBER_SWAPS } from './update2026-11'

const tablesOf = (s: ProgramTables): ProgramTables => ({
  gyms: s.gyms,
  exercises: s.exercises,
  programDays: s.programDays,
  programSlots: s.programSlots,
  gymSlotOverrides: s.gymSlotOverrides,
  trackStarts: s.trackStarts,
})

const dayOf = (t: ProgramTables, dayId: string) =>
  t.programSlots
    .filter((s) => s.programDayId === dayId && s.archivedAt === null)
    .sort((a, b) => a.order - b.order)

const slot = (t: ProgramTables, id: string) => t.programSlots.find((s) => s.id === id)!

describe('applyUpdate2026_11 on the October program', () => {
  const before = tablesOf(OCTOBER_SEED)
  const after = applyUpdate2026_11(before)

  it('swaps five slots, keeping the old exercise first among the alternates', () => {
    expect(slot(after, 'slot-lower-b-1')).toMatchObject({
      defaultExerciseId: 'ex-rdl',
      label: 'Romanian deadlift (or deadlift)',
      alternateExerciseIds: ['ex-deadlift'],
      sets: 3,
      repMin: 5,
      repMax: 8,
    })
    expect(slot(after, 'slot-pull-3')).toMatchObject({
      defaultExerciseId: 'ex-neutral-pulldown',
      label: 'Neutral-grip pulldown',
    })
    expect(slot(after, 'slot-pull-3').alternateExerciseIds[0]).toBe('ex-rocking-pulldown')
    expect(slot(after, 'slot-pull-7')).toMatchObject({
      defaultExerciseId: 'ex-bayesian-curl',
      label: 'Bayesian cable curl',
    })
    expect(slot(after, 'slot-pull-7').alternateExerciseIds[0]).toBe('ex-db-hammer-curl')
    expect(slot(after, 'slot-upper-6')).toMatchObject({
      defaultExerciseId: 'ex-overhead-rope-extension',
      label: 'Overhead rope triceps extension',
    })
    expect(slot(after, 'slot-push-shrug')).toMatchObject({
      defaultExerciseId: 'ex-db-shrug',
      label: 'DB shrug',
    })
    expect(slot(after, 'slot-push-shrug').alternateExerciseIds).toEqual([
      'ex-barbell-shrug',
      'ex-cable-shrug',
    ])
    // A slot never lists its own default.
    for (const s of after.programSlots)
      expect(s.alternateExerciseIds, s.id).not.toContain(s.defaultExerciseId)
  })

  it('adds a back extension after the leg curl on Lower A, and a rear delt fly on Upper', () => {
    expect(dayOf(after, 'day-lower-a').map((s) => s.defaultExerciseId)).toEqual([
      'ex-smith-squat',
      'ex-leg-extension',
      'ex-seated-leg-curl',
      'ex-back-extension',
      'ex-hip-thrust',
      'ex-hip-abduction',
      'ex-standing-calf-raise',
      'ex-cable-crunch',
    ])
    expect(slot(after, 'slot-lower-a-back-extension')).toMatchObject({
      sets: 3,
      repMin: 10,
      repMax: 15,
      rirMin: 1,
      rirMax: 2,
      alternateExerciseIds: ['ex-db-rdl'],
    })
    const upper = dayOf(after, 'day-upper').map((s) => s.defaultExerciseId)
    expect(upper.indexOf('ex-cable-rear-delt-fly')).toBe(upper.indexOf('ex-cable-shrug') + 1)
    expect(slot(after, 'slot-upper-rear-delt-fly')).toMatchObject({
      sets: 2,
      repMin: 12,
      repMax: 20,
    })
    // Orders stay a dense 0..n-1 sequence per day.
    for (const d of after.programDays)
      expect(dayOf(after, d.id).map((s) => s.order)).toEqual(dayOf(after, d.id).map((_, i) => i))
  })

  it('gives the Push lateral raise a fourth set', () => {
    expect(slot(before, 'slot-push-5').sets).toBe(3)
    expect(slot(after, 'slot-push-5').sets).toBe(4)
    expect(slot(after, 'slot-upper-4').sets).toBe(4)
  })

  it('starts each new or switched track as calibration, one per gym for machines and cables', () => {
    const added = after.trackStarts.filter((t) => !before.trackStarts.includes(t))
    expect(added.map((t) => t.trackKey).sort()).toEqual(
      [
        'day-lower-a|ex-back-extension|*',
        'day-lower-b|ex-rdl|*',
        'day-pull|ex-bayesian-curl|gym-1',
        'day-pull|ex-neutral-pulldown|gym-1',
        'day-push|ex-db-shrug|*',
        'day-upper|ex-cable-rear-delt-fly|gym-1',
        'day-upper|ex-overhead-rope-extension|gym-1',
      ].sort(),
    )
    for (const t of added) expect(t).toMatchObject({ startLoadLb: null, calibrate: true })
  })

  it('plans 116 sets a week: hamstrings 12, rear delts 10, side delts 9.5, nothing over the session cap', () => {
    const exercises = new Map(after.exercises.map((e) => [e.id, e]))
    const resolve = (s: ProgramSlot) => exercises.get(s.defaultExerciseId)
    const planned = plannedWeeklyVolume(after.programSlots, resolve, after.programDays)
    expect(planned.totalSets).toBe(116)
    expect(Object.fromEntries(planned.byMuscle)).toMatchObject({
      hamstrings: 12,
      glutes: 17.5,
      rear_delts: 10,
      side_delts: 9.5,
      traps: 6,
      quads: 13.5,
      chest: 14,
      biceps: 15.5,
      triceps: 16,
    })
    for (const day of after.programDays) {
      const slots = after.programSlots.filter((s) => s.programDayId === day.id)
      expect(
        overSessionCap(plannedDayVolume(slots, resolve).byMuscle, DEFAULT_SETTINGS.sessionCap),
        day.id,
      ).toEqual([])
    }
  })

  it('is idempotent, copies only the rows it changes, and is what a first launch writes', () => {
    expect(applyUpdate2026_11(after)).toEqual(after)
    const again = applyUpdate2026_11(after)
    again.programSlots.forEach((s, i) => expect(s).toBe(after.programSlots[i]))
    // Untouched slots keep their identity (so a Dexie upgrade writes only what changed).
    const unchanged = after.programSlots.filter((s) => before.programSlots.includes(s))
    expect(unchanged.some((s) => s.id === 'slot-pull-1')).toBe(true)
    expect(tablesOf(NOVEMBER_SEED)).toEqual(after)
  })
})

describe('applyUpdate2026_11 respects what the user already changed', () => {
  const base = tablesOf(OCTOBER_SEED)

  it('leaves a swapped slot alone when its default is no longer the seed’s', () => {
    const mine = {
      ...base,
      programSlots: base.programSlots.map((s) =>
        s.id === 'slot-pull-7' ? { ...s, defaultExerciseId: 'ex-cable-curl', label: 'My curl' } : s,
      ),
    }
    const after = applyUpdate2026_11(mine)
    expect(slot(after, 'slot-pull-7')).toBe(slot(mine, 'slot-pull-7'))
    expect(after.trackStarts.some((t) => t.trackKey.includes('ex-bayesian-curl'))).toBe(false)
  })

  it('keeps a renamed label, and the user’s alternates after the old default', () => {
    const mine = {
      ...base,
      programSlots: base.programSlots.map((s) =>
        s.id === 'slot-lower-b-1'
          ? { ...s, label: 'Hinge', alternateExerciseIds: ['ex-rdl', 'ex-db-rdl'] }
          : s,
      ),
    }
    expect(slot(applyUpdate2026_11(mine), 'slot-lower-b-1')).toMatchObject({
      defaultExerciseId: 'ex-rdl',
      label: 'Hinge',
      alternateExerciseIds: ['ex-deadlift', 'ex-db-rdl'],
    })
  })

  it('keeps a lateral-raise set count the user changed', () => {
    const mine = {
      ...base,
      programSlots: base.programSlots.map((s) => (s.id === 'slot-push-5' ? { ...s, sets: 5 } : s)),
    }
    expect(slot(applyUpdate2026_11(mine), 'slot-push-5').sets).toBe(5)
  })

  it('skips archived slots and days, archived exercises, and exercises the day already has', () => {
    const mine: ProgramTables = {
      ...base,
      programDays: base.programDays.map((d) =>
        d.id === 'day-upper' ? { ...d, archivedAt: 1 } : d,
      ),
      exercises: base.exercises.map((e) => (e.id === 'ex-rdl' ? { ...e, archivedAt: 1 } : e)),
      programSlots: [
        ...base.programSlots.map((s) => (s.id === 'slot-pull-3' ? { ...s, archivedAt: 1 } : s)),
        {
          ...slot(base, 'slot-lower-a-3'),
          id: 'slot-mine',
          order: 99,
          defaultExerciseId: 'ex-back-extension',
          alternateExerciseIds: [],
        },
      ],
    }
    const after = applyUpdate2026_11(mine)
    expect(slot(after, 'slot-lower-b-1').defaultExerciseId).toBe('ex-deadlift')
    expect(slot(after, 'slot-pull-3').defaultExerciseId).toBe('ex-rocking-pulldown')
    expect(slot(after, 'slot-upper-6').defaultExerciseId).toBe('ex-straight-bar-pushdown')
    expect(after.programSlots.some((s) => s.id === 'slot-upper-rear-delt-fly')).toBe(false)
    expect(after.programSlots.some((s) => s.id === 'slot-lower-a-back-extension')).toBe(false)
    // The other swaps still happen.
    expect(slot(after, 'slot-pull-7').defaultExerciseId).toBe('ex-bayesian-curl')
  })

  it('names only library exercises', () => {
    const ids = new Set(base.exercises.map((e) => e.id))
    for (const w of NOVEMBER_SWAPS) {
      expect(ids.has(w.from), w.from).toBe(true)
      expect(ids.has(w.to), w.to).toBe(true)
    }
  })
})
