// The October 2026 program update (user request, see docs/DECISIONS.md), as one pure transform of
// the library and program tables. Fresh installs get it applied to the spec seed, and existing
// databases get exactly the same change once, through schema migration v1 → v2 (Dexie upgrade and
// old-backup restore alike). It only adds and adjusts library/program rows: history (sessions,
// sets, body, food, phases) isn't an input and can't change.
//
// What it does, each step skipped when already done (so running it twice changes nothing):
//  1. every exercise gets `formUrl: null` (the field is new in schema v2);
//  2. the catalog (seed/catalog.ts) is added by id; an exercise of the user's with the same name
//     stands in for a catalog entry instead of a duplicate being added;
//  3. the incline cable press (not possible at the user's gym) is archived, never deleted: it
//     leaves slot alternates and gym overrides, and active slots defaulting to it switch to the
//     incline Smith press (with its label, unless the user renamed the slot);
//  4. hip abduction slots (3 × 12–20 @ RIR 0–1, 90 s) go into Lower A and Lower B right after hip
//     thrust (or last), unless the day is archived or already has an abduction exercise;
//  5. seed slots still holding their seed default get relevant catalog alternates;
//  6. the new and switched slots get track starts with no load (calibration), one per active gym
//     for machine and cable exercises.
import { gymScope, trackKey } from '@/domain/progression/keys'
import type {
  Exercise,
  Gym,
  GymSlotOverride,
  ProgramDay,
  ProgramSlot,
  Regime,
  TrackStartRow,
} from '@/domain/types'
import {
  CATALOG_2026_10,
  CATALOG_2026_10_MS,
  HIP_ABDUCTION_ID,
  INCLINE_SMITH_PRESS_ID,
} from './catalog'

export interface ProgramTables {
  gyms: readonly Gym[]
  exercises: readonly Exercise[]
  programDays: readonly ProgramDay[]
  programSlots: readonly ProgramSlot[]
  gymSlotOverrides: readonly GymSlotOverride[]
  trackStarts: readonly TrackStartRow[]
}

export const INCLINE_CABLE_PRESS_ID = 'ex-incline-cable-press'
const HIP_THRUST_ID = 'ex-hip-thrust'

export const ABDUCTION_SLOTS = [
  { id: 'slot-lower-a-abduction', programDayId: 'day-lower-a' },
  { id: 'slot-lower-b-abduction', programDayId: 'day-lower-b' },
] as const

const ABDUCTION_REGIME: Regime = {
  sets: 3,
  repMin: 12,
  repMax: 20,
  rirMin: 0,
  rirMax: 1,
  restMinSec: 90,
  restMaxSec: 90,
}

/** Catalog alternates for seed slots, added while the slot still has this default. */
const NEW_ALTERNATES: Readonly<Record<string, { whenDefault: string; add: readonly string[] }>> = {
  'slot-lower-a-1': { whenDefault: 'ex-smith-squat', add: ['ex-hack-squat'] },
  'slot-lower-a-3': { whenDefault: 'ex-seated-leg-curl', add: ['ex-lying-leg-curl'] },
  'slot-lower-a-4': { whenDefault: HIP_THRUST_ID, add: ['ex-cable-glute-kickback'] },
  'slot-lower-a-5': { whenDefault: 'ex-standing-calf-raise', add: ['ex-leg-press-calf-raise'] },
  'slot-lower-a-6': { whenDefault: 'ex-cable-crunch', add: ['ex-machine-crunch'] },
  'slot-push-1': { whenDefault: 'ex-incline-db-bench', add: [INCLINE_SMITH_PRESS_ID] },
  'slot-push-2': { whenDefault: 'ex-flat-machine-press', add: ['ex-barbell-bench'] },
  'slot-push-3': { whenDefault: 'ex-machine-fly', add: ['ex-low-high-cable-fly'] },
  'slot-push-4': { whenDefault: 'ex-overhead-press', add: ['ex-seated-db-shoulder-press'] },
  'slot-push-5': {
    whenDefault: 'ex-lateral-raise',
    add: ['ex-cable-lateral-raise', 'ex-db-lateral-raise'],
  },
  'slot-push-6': {
    whenDefault: 'ex-overhead-cable-triceps-extension',
    add: ['ex-overhead-rope-extension'],
  },
  'slot-push-7': { whenDefault: 'ex-dip-machine', add: ['ex-weighted-dip'] },
  'slot-pull-1': { whenDefault: 'ex-weighted-chin-up', add: ['ex-pull-up'] },
  'slot-pull-2': {
    whenDefault: 'ex-machine-barbell-row',
    add: ['ex-chest-supported-tbar-row', 'ex-seated-cable-row'],
  },
  'slot-pull-3': {
    whenDefault: 'ex-rocking-pulldown',
    add: ['ex-lat-pulldown', 'ex-neutral-pulldown'],
  },
  'slot-pull-4': { whenDefault: 'ex-rear-delt-fly', add: ['ex-cable-rear-delt-fly'] },
  'slot-pull-6': { whenDefault: 'ex-preacher-curl', add: ['ex-bayesian-curl', 'ex-ez-bar-curl'] },
  'slot-lower-b-2': { whenDefault: 'ex-bss', add: ['ex-hack-squat', 'ex-db-walking-lunge'] },
  'slot-lower-b-3': { whenDefault: 'ex-seated-leg-curl', add: ['ex-lying-leg-curl'] },
  'slot-lower-b-4': { whenDefault: HIP_THRUST_ID, add: ['ex-cable-glute-kickback'] },
  'slot-lower-b-6': { whenDefault: 'ex-standing-calf-raise', add: ['ex-leg-press-calf-raise'] },
  'slot-lower-b-7': { whenDefault: 'ex-cable-crunch', add: ['ex-machine-crunch'] },
  'slot-upper-1': { whenDefault: INCLINE_SMITH_PRESS_ID, add: ['ex-incline-machine-press'] },
  'slot-upper-2': {
    whenDefault: 'ex-cable-crossover',
    add: ['ex-low-high-cable-fly', 'ex-machine-fly'],
  },
  'slot-upper-3': {
    whenDefault: 'ex-machine-row-upper',
    add: ['ex-chest-supported-tbar-row', 'ex-one-arm-db-row'],
  },
  'slot-upper-4': {
    whenDefault: 'ex-lateral-raise',
    add: ['ex-cable-lateral-raise', 'ex-db-lateral-raise'],
  },
  'slot-upper-5': { whenDefault: 'ex-incline-db-biceps-curl', add: ['ex-bayesian-curl'] },
  'slot-upper-6': { whenDefault: 'ex-straight-bar-pushdown', add: ['ex-rope-pushdown'] },
  'slot-upper-7': {
    whenDefault: 'ex-machine-triceps-extension',
    add: ['ex-overhead-rope-extension', 'ex-ez-skull-crusher'],
  },
}

const norm = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '')
const alternatesOf = (s: ProgramSlot): string[] =>
  Array.isArray(s.alternateExerciseIds) ? s.alternateExerciseIds : []

function copyExercise(e: Exercise): Exercise {
  return { ...e, defaultRegime: { ...e.defaultRegime }, muscleWeights: { ...e.muscleWeights } }
}

/** Apply the October 2026 update (pure; see the header for exactly what changes). */
export function applyUpdate2026_10(t: ProgramTables): ProgramTables {
  const at = CATALOG_2026_10_MS

  // 1–2. Exercises: the new field, then the catalog by id (or the user's same-named exercise).
  const exercises: Exercise[] = t.exercises.map((e) =>
    (e as Partial<Exercise>).formUrl === undefined ? { ...e, formUrl: null } : e,
  )
  const ids = new Set(exercises.map((e) => e.id))
  const byName = new Map(exercises.map((e) => [norm(e.name), e.id]))
  const standIn = new Map<string, string>()
  for (const c of CATALOG_2026_10) {
    const id = ids.has(c.id) ? c.id : (byName.get(norm(c.name)) ?? null)
    if (id !== null) {
      standIn.set(c.id, id)
      continue
    }
    exercises.push(copyExercise(c))
    ids.add(c.id)
    standIn.set(c.id, c.id)
  }
  const resolveId = (id: string) => standIn.get(id) ?? id

  // 3. Archive the incline cable press.
  const cableIndex = exercises.findIndex((e) => e.id === INCLINE_CABLE_PRESS_ID)
  const cable = cableIndex >= 0 ? exercises[cableIndex]! : undefined
  if (cable && cable.archivedAt === null) {
    exercises[cableIndex] = { ...cable, archivedAt: at, updatedAt: at }
  }
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const isActive = (id: string) => byId.get(id)?.archivedAt === null
  const smithId = resolveId(INCLINE_SMITH_PRESS_ID)
  const smith = byId.get(smithId)

  const switched: ProgramSlot[] = []
  let slots: ProgramSlot[] = t.programSlots.map((s) => {
    let next = s
    if (alternatesOf(s).includes(INCLINE_CABLE_PRESS_ID)) {
      next = {
        ...next,
        alternateExerciseIds: alternatesOf(s).filter((id) => id !== INCLINE_CABLE_PRESS_ID),
      }
    }
    if (s.archivedAt === null && s.defaultExerciseId === INCLINE_CABLE_PRESS_ID && smith) {
      next = {
        ...next,
        defaultExerciseId: smithId,
        label: cable && norm(s.label) === norm(cable.name) ? smith.name : s.label,
        alternateExerciseIds: alternatesOf(next).filter((id) => id !== smithId),
      }
      switched.push(next)
    }
    return next
  })

  // 4. Hip abduction after hip thrust on the lower days.
  const abductionId = resolveId(HIP_ABDUCTION_ID)
  const abduction = byId.get(abductionId)
  const added: ProgramSlot[] = []
  for (const { id, programDayId } of ABDUCTION_SLOTS) {
    const day = t.programDays.find((d) => d.id === programDayId)
    if (!abduction || !day || day.archivedAt !== null || slots.some((s) => s.id === id)) continue
    const daySlots = slots.filter((s) => s.programDayId === programDayId)
    const live = daySlots.filter((s) => s.archivedAt === null)
    const hasAbduction = live.some(
      (s) =>
        s.defaultExerciseId === abductionId ||
        /abduct/i.test(byId.get(s.defaultExerciseId)?.name ?? ''),
    )
    if (hasAbduction) continue
    const thrust = live.find((s) => s.defaultExerciseId === HIP_THRUST_ID)
    const order = thrust ? thrust.order + 1 : Math.max(-1, ...daySlots.map((s) => s.order)) + 1
    slots = slots.map((s) =>
      s.programDayId === programDayId && s.order >= order ? { ...s, order: s.order + 1 } : s,
    )
    const kickback = resolveId('ex-cable-glute-kickback')
    const slot: ProgramSlot = {
      id,
      programDayId,
      order,
      label: abduction.name,
      defaultExerciseId: abductionId,
      alternateExerciseIds: isActive(kickback) && kickback !== abductionId ? [kickback] : [],
      ...ABDUCTION_REGIME,
      note: '',
      archivedAt: null,
    }
    // Keep the array in day-then-order sequence: insert after the slot it follows.
    const after = thrust
      ? slots.findIndex((s) => s.id === thrust.id)
      : slots.map((s) => s.programDayId).lastIndexOf(programDayId)
    slots.splice(after + 1, 0, slot)
    added.push(slot)
  }

  // 5. Catalog alternates on untouched seed slots.
  slots = slots.map((s) => {
    const rule = NEW_ALTERNATES[s.id]
    if (!rule || s.archivedAt !== null || s.defaultExerciseId !== resolveId(rule.whenDefault))
      return s
    const current = alternatesOf(s)
    const extra = rule.add
      .map(resolveId)
      .filter((id) => isActive(id) && id !== s.defaultExerciseId && !current.includes(id))
    return extra.length > 0 ? { ...s, alternateExerciseIds: [...current, ...extra] } : s
  })

  // Gym overrides that chose the archived press go; those slots fall back to their default.
  const gymSlotOverrides = t.gymSlotOverrides.filter((o) => o.exerciseId !== INCLINE_CABLE_PRESS_ID)

  // 6. Track starts (no load: the first session calibrates) for new and switched slots.
  const gyms = t.gyms.filter((g) => g.archivedAt === null)
  const keys = new Set(t.trackStarts.map((s) => s.trackKey))
  const trackStarts = [...t.trackStarts]
  for (const slot of [...switched, ...added]) {
    const exercise = byId.get(slot.defaultExerciseId)
    if (!exercise) continue
    const scopes = exercise.equipmentSpecific
      ? gyms.map((g) => gymScope(true, g.id))
      : [gymScope(false, '')]
    for (const scope of scopes) {
      const key = trackKey(slot.programDayId, exercise.id, scope)
      if (keys.has(key)) continue
      keys.add(key)
      trackStarts.push({
        trackKey: key,
        programDayId: slot.programDayId,
        exerciseId: exercise.id,
        gymScope: scope,
        startLoadLb: null,
        calibrate: true,
        updatedAt: at,
      })
    }
  }

  return { ...t, exercises, programSlots: slots, gymSlotOverrides, trackStarts }
}
