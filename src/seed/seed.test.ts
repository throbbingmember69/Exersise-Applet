import { describe, expect, it } from 'vitest'
import { parseTrackKey, trackKey } from '@/domain/progression/keys'
import type { Exercise, LoadType, ProgramSlot, Regime } from '@/domain/types'
import {
  SEED,
  SEED_BODY_ENTRY,
  SEED_EPOCH_MS,
  SEED_EXERCISES,
  SEED_GYM_ID,
  SEED_GYMS,
  SEED_MUSCLE_IDS,
  SEED_MUSCLES,
  SEED_PROFILE,
  SEED_PROGRAM_DAYS,
  SEED_PROGRAM_SLOTS,
  SEED_TRACK_STARTS,
  SEED_VERSION,
} from './index'

type SpecRow = readonly [
  exercise: string,
  setsReps: string,
  rir: string,
  rest: string,
  startLoad: string,
  step: string,
]

// Copied verbatim from the spec's "Training program" tables.
// prettier-ignore
const SPEC_PROGRAM: Readonly<Record<string, readonly SpecRow[]>> = {
  'day-lower-a': [
    ['Smith machine squat', '4 × 6–10', '1–2', '2–3 min', '220', '10'],
    ['Leg extension', '3 × 10–15', '0–1', '90 s', '170', '5'],
    ['Seated leg curl', '3 × 10–15', '0–1', '90 s', '95', '5'],
    ['Hip thrust', '2 × 8–12', '1–2', '2 min', '200', '10'],
    ['Standing calf raise', '3 × 10–15', '0–1', '90 s', '350', '10'],
    ['Cable crunch', '3 × 10–15', '0–1', '90 s', '160', '5'],
  ],
  'day-push': [
    ['Incline DB bench press', '3 × 6–10', '1–2', '2–3 min', '70 per hand', '5'],
    ['Flat machine or DB press (new)', '3 × 8–12', '1–2', '2 min', 'Set in week 1', '5'],
    ['Machine fly', '2 × 10–15', '0–1', '90 s', '205', '5'],
    ['Overhead shoulder press', '3 × 6–10', '1–2', '2–3 min', '170', '5'],
    ['Lateral raise (machine)', '3 × 10–20', '0–1', '90 s', '40', '2.5'],
    ['Single-arm overhead cable triceps extension', '3 × 10–15', '0–1', '90 s', '30', '2.5'],
    ['Dip machine', '2 × 8–12', '1–2', '2 min', '200', '10'],
  ],
  'day-pull': [
    ['Weighted chin-up', '3 × 6–8', '1–2', '2–3 min', '+50 added', '5'],
    ['Machine barbell row', '3 × 8–12', '1–2', '2 min', '170', '10'],
    ['Rocking pulldown', '2 × 10–12', '1–2', '2 min', '165', '5'],
    ['Rear delt fly', '3 × 12–20', '0–1', '90 s', '120', '5'],
    ['Face pull', '2 × 12–15', '0–1', '90 s', '120', '5'],
    ['Preacher curl', '3 × 8–12', '0–1', '90 s', '80', '5'],
    ['DB hammer curl', '2 × 10–12', '0–1', '90 s', '45 per hand', '5'],
  ],
  'day-lower-b': [
    ['Deadlift (or Romanian deadlift)', '3 × 5–8', '2–3', '3 min', '315', '10'],
    ['Bulgarian split squat or leg press (new)', '3 × 8–12', '1–2', '2 min', 'Set in week 1', '5–10'],
    ['Seated leg curl', '3 × 10–15', '0–1', '90 s', '95', '5'],
    ['Hip thrust', '3 × 8–12', '1–2', '2 min', '200', '10'],
    ['Leg extension', '2 × 12–15', '0–1', '90 s', '170', '5'],
    ['Standing calf raise', '3 × 10–15', '0–1', '90 s', '350', '10'],
    ['Cable crunch', '2 × 10–15', '0–1', '90 s', '160', '5'],
  ],
  'day-upper': [
    ['Incline cable press', '3 × 8–12', '1–2', '2 min', '53', '5'],
    ['Cable crossover', '2 × 10–15', '0–1', '90 s', '60', '5'],
    ['Machine row (upper)', '3 × 8–12', '1–2', '2 min', '160', '5'],
    ['Lateral raise (machine)', '4 × 10–20', '0–1', '90 s', '40', '2.5'],
    ['Incline DB biceps curl (machine)', '3 × 10–15', '0–1', '90 s', '40', '2.5'],
    ['Straight-bar triceps pushdown', '3 × 10–15', '0–1', '90 s', '130', '5'],
    ['Machine triceps extension', '2 × 12–15', '0–1', '90 s', '75', '5'],
  ],
}

/** "X or Y" rows: [default, alternate] exercise names (the first-named variant is the default). */
const OR_ROWS: Readonly<Record<string, readonly [string, string]>> = {
  'Flat machine or DB press (new)': ['Flat machine press', 'Flat DB press'],
  'Deadlift (or Romanian deadlift)': ['Deadlift', 'Romanian deadlift'],
  'Bulgarian split squat or leg press (new)': ['Bulgarian split squat', 'Leg press'],
}

/** Steps that follow the variant (audit finding #9); the others come from the table's step column. */
const VARIANT_STEPS: Readonly<Record<string, number>> = {
  'Bulgarian split squat': 5,
  'Leg press': 10,
  'Romanian deadlift': 10,
  'Flat DB press': 5,
}

// The spec's "Volume accounting" table (split rows list every variant), plus the finishers.
const SPEC_WEIGHTS: readonly (readonly [
  exercises: string[],
  primary: string,
  assisting: string[],
])[] = [
  [['Smith machine squat'], 'Quads', ['Glutes']],
  [['Bulgarian split squat', 'Leg press'], 'Quads', ['Glutes']],
  [['Leg extension'], 'Quads', []],
  [['Deadlift', 'Romanian deadlift'], 'Hamstrings', ['Glutes', 'Quads']],
  [['Seated leg curl'], 'Hamstrings', []],
  [['Hip thrust'], 'Glutes', []],
  [['Standing calf raise'], 'Calves', []],
  [['Cable crunch'], 'Abs', []],
  [['Incline DB bench press'], 'Chest', ['Front delts', 'Triceps']],
  [['Flat machine press', 'Flat DB press'], 'Chest', ['Front delts', 'Triceps']],
  [['Incline cable press'], 'Chest', ['Front delts', 'Triceps']],
  [['Machine fly'], 'Chest', []],
  [['Cable crossover'], 'Chest', []],
  [['Overhead shoulder press'], 'Front delts', ['Side delts', 'Triceps']],
  [['Lateral raise (machine)'], 'Side delts', []],
  [['Dip machine'], 'Triceps', ['Chest', 'Front delts']],
  [['Single-arm overhead cable triceps extension'], 'Triceps', []],
  [['Straight-bar triceps pushdown'], 'Triceps', []],
  [['Machine triceps extension'], 'Triceps', []],
  [['Weighted chin-up'], 'Back', ['Biceps']],
  [['Rocking pulldown'], 'Back', ['Biceps']],
  [['Machine barbell row'], 'Back', ['Biceps', 'Rear delts']],
  [['Machine row (upper)'], 'Back', ['Biceps', 'Rear delts']],
  [['Rear delt fly'], 'Rear delts', []],
  [['Face pull'], 'Rear delts', []],
  [['Preacher curl'], 'Biceps', []],
  [['Incline DB biceps curl (machine)'], 'Biceps', []],
  [['DB hammer curl'], 'Biceps', []],
  [['Barbell shrug'], 'Traps', []],
  [['Hyper Y-W'], 'Rear delts', ['Back']],
]

// Audit finding #45's recommended mapping, extended to the split variants and finishers.
const LOAD_TYPES: Readonly<Record<LoadType, readonly string[]>> = {
  dumbbell: [
    'Incline DB bench press',
    'Flat DB press',
    'DB hammer curl',
    'Bulgarian split squat',
    'Hyper Y-W',
  ],
  bodyweight_plus: ['Weighted chin-up'],
  barbell: ['Deadlift', 'Romanian deadlift', 'Barbell shrug'],
  cable: [
    'Incline cable press',
    'Cable crossover',
    'Single-arm overhead cable triceps extension',
    'Straight-bar triceps pushdown',
    'Cable crunch',
    'Face pull',
    'Rocking pulldown',
  ],
  machine: [
    'Smith machine squat',
    'Leg extension',
    'Seated leg curl',
    'Hip thrust',
    'Standing calf raise',
    'Flat machine press',
    'Machine fly',
    'Overhead shoulder press',
    'Lateral raise (machine)',
    'Dip machine',
    'Machine barbell row',
    'Machine row (upper)',
    'Rear delt fly',
    'Preacher curl',
    'Incline DB biceps curl (machine)',
    'Machine triceps extension',
    'Leg press',
  ],
}

const FINISHER_REGIME: Regime = {
  sets: 3,
  repMin: 8,
  repMax: 12,
  rirMin: 0,
  rirMax: 1,
  restMinSec: 90,
  restMaxSec: 90,
}

const exerciseById = new Map(SEED_EXERCISES.map((e) => [e.id, e]))
const exerciseByName = new Map(SEED_EXERCISES.map((e) => [e.name, e]))
const muscleIdByName = new Map(SEED_MUSCLES.map((m) => [m.name.toLowerCase(), m.id]))

function exercise(id: string): Exercise {
  const e = exerciseById.get(id)
  if (!e) throw new Error(`No seed exercise ${id}`)
  return e
}

function named(name: string): Exercise {
  const e = exerciseByName.get(name)
  if (!e) throw new Error(`No seed exercise named ${name}`)
  return e
}

function muscleId(name: string): string {
  const id = muscleIdByName.get(name.toLowerCase())
  if (!id) throw new Error(`No seed muscle named ${name}`)
  return id
}

function slotsOf(dayId: string): ProgramSlot[] {
  return SEED_PROGRAM_SLOTS.filter((s) => s.programDayId === dayId)
}

function names(exercises: readonly Exercise[]): string[] {
  return exercises.map((e) => e.name).sort()
}

function match(re: RegExp, s: string): RegExpExecArray {
  const m = re.exec(s)
  if (!m) throw new Error(`Unparseable spec cell ${JSON.stringify(s)}`)
  return m
}

/** "4 × 6–10" → [4, 6, 10]. */
function parseSetsReps(s: string): [number, number, number] {
  const m = match(/^(\d+) × (\d+)–(\d+)$/, s)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** "1–2" → [1, 2]. */
function parseRange(s: string): [number, number] {
  const m = match(/^(\d+)–(\d+)$/, s)
  return [Number(m[1]), Number(m[2])]
}

/** "90 s" → [90, 90]; "2–3 min" → [120, 180]; "3 min" → [180, 180]. */
function parseRest(s: string): [number, number] {
  const sec = /^(\d+) s$/.exec(s)
  if (sec) return [Number(sec[1]), Number(sec[1])]
  const m = match(/^(\d+)(?:–(\d+))? min$/, s)
  return [Number(m[1]) * 60, Number(m[2] ?? m[1]) * 60]
}

/** "220" / "70 per hand" / "+50 added" → the number; "Set in week 1" → null. */
function parseStartLoad(s: string): number | null {
  if (s === 'Set in week 1') return null
  return Number(match(/^\+?(\d+(?:\.\d+)?)(?: per hand| added)?$/, s)[1])
}

function specRows(): { dayId: string; index: number; row: SpecRow }[] {
  return Object.entries(SPEC_PROGRAM).flatMap(([dayId, rows]) =>
    rows.map((row, index) => ({ dayId, index, row })),
  )
}

describe('seed ids and referential integrity', () => {
  it('has the expected table sizes', () => {
    expect(SEED_MUSCLES).toHaveLength(13)
    expect(SEED_GYMS).toHaveLength(1)
    expect(SEED_EXERCISES).toHaveLength(33)
    expect(SEED_PROGRAM_DAYS).toHaveLength(5)
    expect(SEED_PROGRAM_SLOTS).toHaveLength(34)
    expect(SEED_TRACK_STARTS).toHaveLength(34)
  })

  it('uses unique, deterministic slug ids that never contain "|"', () => {
    const ids = [
      ...SEED_MUSCLES.map((m) => m.id),
      ...SEED_GYMS.map((g) => g.id),
      ...SEED_EXERCISES.map((e) => e.id),
      ...SEED_PROGRAM_DAYS.map((d) => d.id),
      ...SEED_PROGRAM_SLOTS.map((s) => s.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_-]+$/)
    expect(new Set(SEED_TRACK_STARTS.map((t) => t.trackKey)).size).toBe(SEED_TRACK_STARTS.length)
  })

  it('points every slot at an existing day and exercises', () => {
    const dayIds = new Set(SEED_PROGRAM_DAYS.map((d) => d.id))
    for (const slot of SEED_PROGRAM_SLOTS) {
      expect(dayIds.has(slot.programDayId)).toBe(true)
      expect(exerciseById.has(slot.defaultExerciseId)).toBe(true)
      for (const alt of slot.alternateExerciseIds) {
        expect(exerciseById.has(alt)).toBe(true)
        expect(alt).not.toBe(slot.defaultExerciseId)
      }
    }
  })

  it('weights only seed muscles, at 1.0 or 0.5, with exactly one primary muscle', () => {
    const muscleIds = new Set<string>(SEED_MUSCLE_IDS)
    for (const e of SEED_EXERCISES) {
      const entries = Object.entries(e.muscleWeights)
      for (const [m, w] of entries) {
        expect(muscleIds.has(m)).toBe(true)
        expect([0.5, 1]).toContain(w)
      }
      expect(entries.filter(([, w]) => w === 1)).toHaveLength(1)
    }
  })

  it('matches every track start to a slot and its default exercise', () => {
    SEED_PROGRAM_SLOTS.forEach((slot, i) => {
      const start = SEED_TRACK_STARTS[i]
      expect(start?.programDayId).toBe(slot.programDayId)
      expect(start?.exerciseId).toBe(slot.defaultExerciseId)
    })
    for (const t of SEED_TRACK_STARTS) {
      expect(t.trackKey).toBe(trackKey(t.programDayId, t.exerciseId, t.gymScope))
      expect(parseTrackKey(t.trackKey)).toEqual({
        programDayId: t.programDayId,
        exerciseId: t.exerciseId,
        scope: t.gymScope,
      })
    }
  })

  it('uses every program exercise in some slot, and no finisher in any', () => {
    const used = new Set(
      SEED_PROGRAM_SLOTS.flatMap((s) => [s.defaultExerciseId, ...s.alternateExerciseIds]),
    )
    for (const e of SEED_EXERCISES) expect(used.has(e.id)).toBe(!e.isFinisher)
  })

  it('stamps every seed row with the fixed seed timestamp', () => {
    for (const e of SEED_EXERCISES) {
      expect(e.createdAt).toBe(SEED_EPOCH_MS)
      expect(e.updatedAt).toBe(SEED_EPOCH_MS)
    }
    for (const t of SEED_TRACK_STARTS) expect(t.updatedAt).toBe(SEED_EPOCH_MS)
    expect(SEED_GYMS[0]?.createdAt).toBe(SEED_EPOCH_MS)
  })

  it('archives nothing', () => {
    const rows = [
      ...SEED_MUSCLES,
      ...SEED_GYMS,
      ...SEED_EXERCISES,
      ...SEED_PROGRAM_DAYS,
      ...SEED_PROGRAM_SLOTS,
    ]
    for (const r of rows) expect(r.archivedAt).toBeNull()
  })
})

describe('seed muscles', () => {
  it('lists the 12 muscles of the weekly totals table plus traps, in sort order', () => {
    expect(SEED_MUSCLES.map((m) => m.id)).toEqual([
      'quads',
      'hamstrings',
      'glutes',
      'calves',
      'abs',
      'chest',
      'front_delts',
      'side_delts',
      'rear_delts',
      'back',
      'biceps',
      'triceps',
      'traps',
    ])
    expect(SEED_MUSCLES.map((m) => m.sortOrder)).toEqual([...Array(13).keys()])
    expect(SEED_MUSCLES.find((m) => m.id === 'side_delts')?.name).toBe('Side delts')
  })

  it('inherits the global band and exempts only front delts, calves and abs from "low"', () => {
    for (const m of SEED_MUSCLES) {
      expect(m.bandMin).toBeNull()
      expect(m.bandMax).toBeNull()
      expect(m.lagging).toBe(false)
    }
    expect(SEED_MUSCLES.filter((m) => m.exemptLow).map((m) => m.id)).toEqual([
      'calves',
      'abs',
      'front_delts',
    ])
  })
})

describe('seed gym and program days', () => {
  it('has one default gym', () => {
    expect(SEED_GYMS).toEqual([
      { id: 'gym-1', name: 'Gym 1', sortOrder: 0, archivedAt: null, createdAt: SEED_EPOCH_MS },
    ])
    expect(SEED_GYM_ID).toBe('gym-1')
  })

  it('trains Mon Lower A, Tue Push, Wed Pull, Fri Lower B, Sat Upper (Thu and Sun off)', () => {
    expect(SEED_PROGRAM_DAYS.map((d) => [d.id, d.name, d.weekday, d.order])).toEqual([
      ['day-lower-a', 'Lower A', 1, 0],
      ['day-push', 'Push', 2, 1],
      ['day-pull', 'Pull', 3, 2],
      ['day-lower-b', 'Lower B', 5, 3],
      ['day-upper', 'Upper', 6, 4],
    ])
  })

  it('has 6/7/7/7/7 slots per day, ordered and numbered like the tables', () => {
    expect(SEED_PROGRAM_DAYS.map((d) => slotsOf(d.id).length)).toEqual([6, 7, 7, 7, 7])
    for (const d of SEED_PROGRAM_DAYS) {
      slotsOf(d.id).forEach((slot, i) => {
        expect(slot.order).toBe(i)
        expect(slot.id).toBe(`slot-${d.id.slice('day-'.length)}-${i + 1}`)
      })
    }
    expect(slotsOf('day-lower-a')[0]?.id).toBe('slot-lower-a-1')
  })
})

describe('seed slots match the spec tables', () => {
  it.each(specRows())('$dayId #$index', ({ dayId, index, row }) => {
    const [label, setsReps, rir, rest] = row
    const slot = slotsOf(dayId)[index]
    const [sets, repMin, repMax] = parseSetsReps(setsReps)
    const [rirMin, rirMax] = parseRange(rir)
    const [restMinSec, restMaxSec] = parseRest(rest)
    expect(slot).toMatchObject({
      label,
      sets,
      repMin,
      repMax,
      rirMin,
      rirMax,
      restMinSec,
      restMaxSec,
    })

    const [defaultName, alternateName] = OR_ROWS[label] ?? [label, undefined]
    expect(exercise(slot?.defaultExerciseId ?? '').name).toBe(defaultName)
    expect(slot?.alternateExerciseIds.map((id) => exercise(id).name)).toEqual(
      alternateName ? [alternateName] : [],
    )
  })

  it('covers every slot', () => {
    expect(specRows()).toHaveLength(SEED_PROGRAM_SLOTS.length)
  })

  it('splits the three "or" rows into default + alternate', () => {
    const withAlternates = SEED_PROGRAM_SLOTS.filter((s) => s.alternateExerciseIds.length > 0)
    expect(withAlternates.map((s) => [s.id, s.defaultExerciseId, s.alternateExerciseIds])).toEqual([
      ['slot-push-2', 'ex-flat-machine-press', ['ex-flat-db-press']],
      ['slot-lower-b-1', 'ex-deadlift', ['ex-rdl']],
      ['slot-lower-b-2', 'ex-bss', ['ex-leg-press']],
    ])
  })
})

describe('seed exercises', () => {
  it('copies the volume accounting weights, sharing them across "or" variants', () => {
    const covered = SPEC_WEIGHTS.flatMap(([exercises]) => exercises)
    expect(covered.sort()).toEqual(names(SEED_EXERCISES))
    for (const [exercises, primary, assisting] of SPEC_WEIGHTS) {
      const expected = Object.fromEntries([
        [muscleId(primary), 1],
        ...assisting.map((m) => [muscleId(m), 0.5]),
      ])
      for (const name of exercises) expect(named(name).muscleWeights).toEqual(expected)
    }
  })

  it('maps load types per audit finding #45', () => {
    const covered = Object.values(LOAD_TYPES).flat()
    expect([...covered].sort()).toEqual(names(SEED_EXERCISES))
    for (const [loadType, exercises] of Object.entries(LOAD_TYPES)) {
      for (const name of exercises) expect(named(name).loadType).toBe(loadType)
    }
  })

  it('derives equipment-specific (machine/cable) and per-hand (dumbbell) from the load type', () => {
    for (const e of SEED_EXERCISES) {
      expect(e.equipmentSpecific).toBe(e.loadType === 'machine' || e.loadType === 'cable')
      expect(e.perHand).toBe(e.loadType === 'dumbbell')
    }
  })

  it('flags unilateral work, main lifts and finishers', () => {
    expect(names(SEED_EXERCISES.filter((e) => e.unilateral))).toEqual([
      'Bulgarian split squat',
      'Single-arm overhead cable triceps extension',
    ])
    expect(names(SEED_EXERCISES.filter((e) => e.isMainLift))).toEqual([
      'Deadlift',
      'Incline DB bench press',
      'Overhead shoulder press',
      'Smith machine squat',
      'Weighted chin-up',
    ])
    expect(names(SEED_EXERCISES.filter((e) => e.isFinisher))).toEqual([
      'Barbell shrug',
      'Hyper Y-W',
    ])
  })

  it('takes steps from the program tables, following the variant for "or" rows', () => {
    for (const { dayId, index, row } of specRows()) {
      const slot = slotsOf(dayId)[index]
      for (const id of [slot?.defaultExerciseId ?? '', ...(slot?.alternateExerciseIds ?? [])]) {
        const e = exercise(id)
        expect(e.stepLb).toBe(VARIANT_STEPS[e.name] ?? Number(row[5]))
      }
    }
    expect(named('Barbell shrug').stepLb).toBe(5)
    expect(named('Hyper Y-W').stepLb).toBe(5)
  })

  it("uses the regime of the exercise's first program slot as its default", () => {
    for (const e of SEED_EXERCISES.filter((x) => !x.isFinisher)) {
      const first = SEED_PROGRAM_SLOTS.find(
        (s) => s.defaultExerciseId === e.id || s.alternateExerciseIds.includes(e.id),
      )
      expect(e.defaultRegime).toEqual({
        sets: first?.sets,
        repMin: first?.repMin,
        repMax: first?.repMax,
        rirMin: first?.rirMin,
        rirMax: first?.rirMax,
        restMinSec: first?.restMinSec,
        restMaxSec: first?.restMaxSec,
      })
    }
    // Two-day exercises take the first day's regime.
    expect(named('Leg extension').defaultRegime).toMatchObject({ sets: 3, repMin: 10, repMax: 15 })
    expect(named('Lateral raise (machine)').defaultRegime).toMatchObject({ sets: 3, repMax: 20 })
    // Alternates take their slot's regime.
    expect(named('Romanian deadlift').defaultRegime).toEqual(named('Deadlift').defaultRegime)
    expect(named('Romanian deadlift').defaultRegime).toMatchObject({
      repMin: 5,
      repMax: 8,
      rirMin: 2,
      rirMax: 3,
      restMinSec: 180,
      restMaxSec: 180,
    })
    expect(named('Leg press').defaultRegime).toMatchObject({ sets: 3, repMin: 8, repMax: 12 })
  })

  it('gives finishers 3 × 8–12 @ RIR 0–1 with 90 s rest', () => {
    for (const e of SEED_EXERCISES.filter((x) => x.isFinisher)) {
      expect(e.defaultRegime).toEqual(FINISHER_REGIME)
    }
  })

  it('does not share mutable objects between exercises', () => {
    expect(named('Deadlift').muscleWeights).not.toBe(named('Romanian deadlift').muscleWeights)
    expect(named('Barbell shrug').defaultRegime).not.toBe(named('Hyper Y-W').defaultRegime)
  })
})

describe('seed track starts', () => {
  it('takes start loads from the spec (per hand, added load, blank for "Set in week 1")', () => {
    for (const { dayId, index, row } of specRows()) {
      const slot = slotsOf(dayId)[index]
      const start = SEED_TRACK_STARTS.find(
        (t) => t.programDayId === dayId && t.exerciseId === slot?.defaultExerciseId,
      )
      expect(start?.startLoadLb).toBe(parseStartLoad(row[4]))
    }
    const byExercise = (id: string) => SEED_TRACK_STARTS.find((t) => t.exerciseId === id)
    expect(byExercise('ex-weighted-chin-up')?.startLoadLb).toBe(50)
    expect(byExercise('ex-incline-db-bench')?.startLoadLb).toBe(70)
    expect(byExercise('ex-incline-cable-press')?.startLoadLb).toBe(53)
    expect(byExercise('ex-flat-machine-press')?.startLoadLb).toBeNull()
    expect(byExercise('ex-bss')?.startLoadLb).toBeNull()
  })

  it('calibrates the "Set in week 1" slots and the six exercises whose rep ranges changed', () => {
    const calibrating = SEED_PROGRAM_SLOTS.filter((_, i) => SEED_TRACK_STARTS[i]?.calibrate)
    expect(calibrating.map((s) => s.id).sort()).toEqual(
      [
        'slot-push-2', // flat press, Set in week 1
        'slot-lower-b-2', // Bulgarian split squat, Set in week 1
        'slot-push-3', // machine fly
        'slot-push-5', // lateral raise (Push)
        'slot-upper-4', // lateral raise (Upper)
        'slot-pull-4', // rear delt fly
        'slot-pull-5', // face pull
        'slot-push-7', // dip machine
        'slot-lower-b-1', // deadlift
      ].sort(),
    )
    const recalibrating = SEED_TRACK_STARTS.filter((t) => t.calibrate && t.startLoadLb !== null)
    expect(recalibrating).toHaveLength(7)
  })

  it('scopes machine and cable tracks to Gym 1 and shares free-weight tracks', () => {
    for (const t of SEED_TRACK_STARTS) {
      expect(t.gymScope).toBe(exercise(t.exerciseId).equipmentSpecific ? SEED_GYM_ID : '*')
    }
    expect(SEED_TRACK_STARTS.find((t) => t.exerciseId === 'ex-deadlift')?.trackKey).toBe(
      'day-lower-b|ex-deadlift|*',
    )
    expect(SEED_TRACK_STARTS.find((t) => t.exerciseId === 'ex-smith-squat')?.trackKey).toBe(
      'day-lower-a|ex-smith-squat|gym-1',
    )
  })

  it('keeps an exercise on two days as two tracks with the same start load', () => {
    const legExt = SEED_TRACK_STARTS.filter((t) => t.exerciseId === 'ex-leg-extension')
    expect(legExt.map((t) => t.trackKey)).toEqual([
      'day-lower-a|ex-leg-extension|gym-1',
      'day-lower-b|ex-leg-extension|gym-1',
    ])
    expect(legExt.map((t) => t.startLoadLb)).toEqual([170, 170])
  })
})

describe('seed bundle', () => {
  it('bundles every seeded table', () => {
    expect(SEED_VERSION).toBe(1)
    expect(SEED.profile).toBe(SEED_PROFILE)
    expect(SEED.bodyEntries).toEqual([SEED_BODY_ENTRY])
    expect(SEED.muscles).toBe(SEED_MUSCLES)
    expect(SEED.gyms).toBe(SEED_GYMS)
    expect(SEED.exercises).toBe(SEED_EXERCISES)
    expect(SEED.programDays).toBe(SEED_PROGRAM_DAYS)
    expect(SEED.programSlots).toBe(SEED_PROGRAM_SLOTS)
    expect(SEED.trackStarts).toBe(SEED_TRACK_STARTS)
    expect(SEED.gymSlotOverrides).toEqual([])
    expect(SEED.gymExerciseSettings).toEqual([])
  })
})
