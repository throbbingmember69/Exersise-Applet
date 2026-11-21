// The November 21 2026 smaller-muscles update (user request after a literature search on the
// muscle groups the program misses, abdominals first), as one pure transform of the muscle,
// library and program tables. Like the earlier updates it builds the fresh seed and upgrades
// existing databases (schema migration v4 → v5) the same way, and it only adds and adjusts rows:
// history isn't an input. Each step is skipped when already done or when the user changed that
// row, so running it twice changes nothing.
//
//  1. Slots: every slot gets `optional: false` (the field is new in schema v5).
//  2. Muscles: **Obliques** and **Neck** join, tracked from the update day and exempt from "low"
//     (all their work is optional). **Abs** stops being exempt from "low" (user decision).
//  3. Library: ab wheel rollout (abs 1, obliques ½), cable woodchop (obliques 1, abs ½), and neck
//     extension and flexion (neck 1). A user's same-named exercise stands in for a new one.
//  4. Program: all new slots are **optional** (they count when done, never required): ab wheel
//     rollout 3 × 8–15 on Push and Upper; cable woodchop 2 × 10–15 on Pull and Lower B; neck
//     extension and flexion 2 × 12–20 each on Lower A and Lower B. Each goes last in its day and
//     calibrates its first session.
//
// Evidence (docs/EXERCISE-EVIDENCE.md, "Smaller muscle groups"): crunches thicken the rectus
// abdominis most and rollouts give some of the highest abdominal and oblique activation with
// little hip-flexor work; squats and deadlifts barely activate it. Direct neck training grew the
// neck 13% in 12 weeks where a program without it grew it 0% (Conley 1997).
import { gymScope, trackKey } from '@/domain/progression/keys'
import type {
  Exercise,
  LocalDate,
  Muscle,
  MuscleWeights,
  ProgramSlot,
  Regime,
} from '@/domain/types'
import { type BackFocusTables } from './update2026-10b'

export const SMALL_MUSCLES_MS = Date.UTC(2026, 10, 21, 18)
/** Obliques and Neck count (and could flag) from this training week on. */
export const SMALL_MUSCLES_TRACKED_FROM = '2026-11-23' as LocalDate

const ABS = 'abs'
export const OBLIQUES = 'obliques'
export const NECK = 'neck'

const r = (
  sets: number,
  [repMin, repMax]: readonly [number, number],
  [rirMin, rirMax]: readonly [number, number],
  [restMinSec, restMaxSec]: readonly [number, number],
): Regime => ({ sets, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec })

const ROLLOUT = r(3, [8, 15], [1, 2], [90, 90])
const WOODCHOP = r(2, [10, 15], [1, 2], [90, 90])
const NECK_REGIME = r(2, [12, 20], [1, 2], [60, 90])

function exercise(
  id: string,
  name: string,
  loadType: Exercise['loadType'],
  stepLb: number,
  muscleWeights: MuscleWeights,
  regime: Regime,
  notes: string,
  unilateral = false,
): Exercise {
  return {
    id,
    name,
    loadType,
    equipmentSpecific: loadType === 'machine' || loadType === 'cable',
    unilateral,
    perHand: loadType === 'dumbbell',
    stepLb,
    defaultRegime: { ...regime },
    muscleWeights,
    isMainLift: false,
    isFinisher: false,
    notes,
    formUrl: null,
    archivedAt: null,
    createdAt: SMALL_MUSCLES_MS,
    updatedAt: SMALL_MUSCLES_MS,
  }
}

export const SMALL_MUSCLE_EXERCISES: readonly Exercise[] = [
  exercise(
    'ex-ab-wheel-rollout',
    'Ab wheel rollout',
    'bodyweight_plus',
    5,
    { [ABS]: 1, [OBLIQUES]: 0.5 },
    ROLLOUT,
    'Loads the abs in their stretched position; rollouts gave some of the highest abdominal and oblique activation with little hip-flexor work (EMG). Start from the knees. Log added load (0 for bodyweight).',
  ),
  exercise(
    'ex-cable-woodchop',
    'Cable woodchop',
    'cable',
    2.5,
    { [OBLIQUES]: 1, [ABS]: 0.5 },
    WOODCHOP,
    'Rotation against a cable for the obliques. Evidence is activation only (no growth trials). Log the weaker side’s reps.',
    true,
  ),
  exercise(
    'ex-neck-extension',
    'Neck extension',
    'machine',
    2.5,
    { [NECK]: 1 },
    NECK_REGIME,
    'Plate on a towel or a neck harness, or a neck machine. Direct head-extension training grew the neck 13% in 12 weeks; the same program without it grew it 0% (Conley 1997). Start light.',
  ),
  exercise(
    'ex-neck-flexion',
    'Neck flexion',
    'machine',
    2.5,
    { [NECK]: 1 },
    NECK_REGIME,
    'Lying face up with a plate on the forehead (on a towel), or a neck machine. Pairs with neck extension for balanced neck work. Start light.',
  ),
]

interface NewSlot {
  id: string
  programDayId: string
  exerciseId: string
  regime: Regime
  alternates: readonly string[]
}

/** The optional slots, in the order they're appended to each day. */
export const SMALL_MUSCLE_SLOTS: readonly NewSlot[] = [
  {
    id: 'slot-lower-a-neck-extension',
    programDayId: 'day-lower-a',
    exerciseId: 'ex-neck-extension',
    regime: NECK_REGIME,
    alternates: [],
  },
  {
    id: 'slot-lower-a-neck-flexion',
    programDayId: 'day-lower-a',
    exerciseId: 'ex-neck-flexion',
    regime: NECK_REGIME,
    alternates: [],
  },
  {
    id: 'slot-push-ab-wheel',
    programDayId: 'day-push',
    exerciseId: 'ex-ab-wheel-rollout',
    regime: ROLLOUT,
    alternates: ['ex-hanging-leg-raise'],
  },
  {
    id: 'slot-pull-woodchop',
    programDayId: 'day-pull',
    exerciseId: 'ex-cable-woodchop',
    regime: WOODCHOP,
    alternates: [],
  },
  {
    id: 'slot-lower-b-woodchop',
    programDayId: 'day-lower-b',
    exerciseId: 'ex-cable-woodchop',
    regime: WOODCHOP,
    alternates: [],
  },
  {
    id: 'slot-lower-b-neck-extension',
    programDayId: 'day-lower-b',
    exerciseId: 'ex-neck-extension',
    regime: NECK_REGIME,
    alternates: [],
  },
  {
    id: 'slot-lower-b-neck-flexion',
    programDayId: 'day-lower-b',
    exerciseId: 'ex-neck-flexion',
    regime: NECK_REGIME,
    alternates: [],
  },
  {
    id: 'slot-upper-ab-wheel',
    programDayId: 'day-upper',
    exerciseId: 'ex-ab-wheel-rollout',
    regime: ROLLOUT,
    alternates: ['ex-hanging-leg-raise'],
  },
]

const norm = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '')

export interface SmallMusclesOptions {
  /** The day the update runs (upgrade or restore): Obliques and Neck count from it. */
  trackedFrom?: LocalDate
}

/** Apply the smaller-muscles update (pure; see the header for exactly what changes). */
export function applyUpdate2026_11b(
  t: BackFocusTables,
  opts: SmallMusclesOptions = {},
): BackFocusTables {
  const at = SMALL_MUSCLES_MS
  const from = opts.trackedFrom ?? SMALL_MUSCLES_TRACKED_FROM

  // 1. Every slot has the new field.
  let slots: ProgramSlot[] = t.programSlots.map((s) =>
    typeof (s as Partial<ProgramSlot>).optional === 'boolean' ? s : { ...s, optional: false },
  )

  // 2. Muscles.
  let muscles: Muscle[] = t.muscles.map((m) =>
    m.id === ABS && m.exemptLow ? { ...m, exemptLow: false } : m,
  )
  const sortOf = (id: string) => muscles.find((m) => m.id === id)?.sortOrder
  const maxSort = Math.max(-1, ...muscles.map((m) => m.sortOrder))
  const addMuscle = (id: string, name: string, sortOrder: number) => {
    if (muscles.some((m) => m.id === id)) return
    muscles = [
      ...muscles,
      {
        id,
        name,
        sortOrder,
        bandMin: null,
        bandMax: null,
        exemptLow: true,
        lagging: false,
        trackedFrom: from,
        archivedAt: null,
      },
    ]
  }
  addMuscle(OBLIQUES, 'Obliques', (sortOf(ABS) ?? maxSort) + 0.5)
  addMuscle(NECK, 'Neck', maxSort + 1)

  // 3. Library: a user's same-named exercise stands in for a new one, so nothing is duplicated.
  let exercises: Exercise[] = [...t.exercises]
  const ids = new Set(exercises.map((e) => e.id))
  const byName = new Map(exercises.map((e) => [norm(e.name), e.id]))
  const names = new Map(SMALL_MUSCLE_EXERCISES.map((e) => [e.id, e.name]))
  const resolveId = (id: string): string => {
    if (ids.has(id)) return id
    const name = names.get(id)
    return (name !== undefined ? byName.get(norm(name)) : undefined) ?? id
  }
  for (const e of SMALL_MUSCLE_EXERCISES) {
    if (ids.has(e.id) || byName.has(norm(e.name))) continue
    exercises = [
      ...exercises,
      { ...e, defaultRegime: { ...e.defaultRegime }, muscleWeights: { ...e.muscleWeights } },
    ]
    ids.add(e.id)
    byName.set(norm(e.name), e.id)
  }
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const isActive = (id: string) => byId.get(id)?.archivedAt === null
  const activeDays = new Set(t.programDays.filter((d) => d.archivedAt === null).map((d) => d.id))

  // 4. Program: optional slots, last in their day.
  const added: ProgramSlot[] = []
  for (const n of SMALL_MUSCLE_SLOTS) {
    const exerciseId = resolveId(n.exerciseId)
    if (!activeDays.has(n.programDayId) || slots.some((s) => s.id === n.id)) continue
    if (!isActive(exerciseId)) continue
    const daySlots = slots.filter((s) => s.programDayId === n.programDayId)
    // The user already has this exercise on the day.
    if (daySlots.some((s) => s.archivedAt === null && s.defaultExerciseId === exerciseId)) continue
    const slot: ProgramSlot = {
      id: n.id,
      programDayId: n.programDayId,
      order: Math.max(-1, ...daySlots.map((s) => s.order)) + 1,
      label: byId.get(exerciseId)!.name,
      defaultExerciseId: exerciseId,
      alternateExerciseIds: n.alternates
        .map(resolveId)
        .filter((id) => isActive(id) && id !== exerciseId),
      ...n.regime,
      optional: true,
      note: '',
      archivedAt: null,
    }
    const after = slots.map((s) => s.programDayId).lastIndexOf(n.programDayId)
    slots = [...slots.slice(0, after + 1), slot, ...slots.slice(after + 1)]
    added.push(slot)
  }

  // Track starts (no load: the first session calibrates) for the new slots.
  const gyms = t.gyms.filter((g) => g.archivedAt === null)
  const keys = new Set(t.trackStarts.map((s) => s.trackKey))
  const trackStarts = [...t.trackStarts]
  for (const slot of added) {
    const e = byId.get(slot.defaultExerciseId)!
    const scopes = e.equipmentSpecific
      ? gyms.map((g) => gymScope(true, g.id))
      : [gymScope(false, '')]
    for (const scope of scopes) {
      const key = trackKey(slot.programDayId, e.id, scope)
      if (keys.has(key)) continue
      keys.add(key)
      trackStarts.push({
        trackKey: key,
        programDayId: slot.programDayId,
        exerciseId: e.id,
        gymScope: scope,
        startLoadLb: null,
        calibrate: true,
        updatedAt: at,
      })
    }
  }

  return { ...t, muscles, exercises, programSlots: slots, trackStarts }
}
