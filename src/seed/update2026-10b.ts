// The back-focus update (2026-10-18, user request: lats and traps under-developed), as one pure
// transform of the muscle, library and program tables. Like the October 10 update it builds the
// fresh seed and upgrades existing databases (schema migration v2 → v3) the same way, and it only
// adds and adjusts rows: history isn't an input. Each step is skipped when already done or when
// the user changed that row themselves, so running it twice changes nothing.
//
//  1. Muscles: "Back" (id 'back', kept so past weeks keep their sets) becomes **Lats**, marked
//     lagging; a new **Upper back** (mid traps, rhomboids, teres, infraspinatus) joins it; Traps
//     (shrugs for the upper fibres, Y-raises for the lower) stops being exempt from "low", gets a
//     6–16 band and is marked lagging. Upper back and Traps count from the next training week.
//  2. Muscle weights (only where still the previous seed's): vertical pulls train lats 1, upper
//     back ½; tucked rows lats 1 and upper back 1; the user's wide-grip machine barbell row and the
//     flared upper-day row upper back 1, lats ½; face pull adds upper back ½; Hyper Y-W becomes
//     upper back 1, traps ½, rear delts ½. Evidence in docs/DECISIONS.md.
//  3. Library: incline DB Y-raise, cable Y-raise and cable shrug; the barbell shrug stops being a
//     finisher (it now progresses in a program slot).
//  4. Program (+10 working sets a week): Push gets a barbell shrug 2 × 8–12 after lateral raises;
//     Pull's rocking pulldown goes 2 → 3 sets and an incline DB Y-raise 2 × 12–20 follows it;
//     Upper gets a lat pulldown 3 × 8–12 after the incline Smith press and a cable shrug 2 × 12–20
//     after lateral raises. New slots get calibration track starts.
import { gymScope, trackKey } from '@/domain/progression/keys'
import type {
  Exercise,
  LocalDate,
  Muscle,
  MuscleWeights,
  ProgramSlot,
  Regime,
} from '@/domain/types'
import { CATALOG_2026_10 } from './catalog'
import { type ProgramTables } from './update2026-10'

export const BACK_FOCUS_MS = Date.UTC(2026, 9, 18, 12)
/** Upper back and Traps count (and can flag 'low') from this training week on. */
export const BACK_FOCUS_TRACKED_FROM = '2026-10-19' as LocalDate

export interface BackFocusTables extends ProgramTables {
  muscles: readonly Muscle[]
}

const LATS = 'back'
const UPPER_BACK = 'upper_back'
const TRAPS = 'traps'

const r = (
  sets: number,
  [repMin, repMax]: readonly [number, number],
  [rirMin, rirMax]: readonly [number, number],
  [restMinSec, restMaxSec]: readonly [number, number],
): Regime => ({ sets, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec })

const HIGH_REP = r(3, [12, 20], [0, 1], [90, 90])

function exercise(
  id: string,
  name: string,
  loadType: Exercise['loadType'],
  stepLb: number,
  muscleWeights: MuscleWeights,
  notes: string,
): Exercise {
  return {
    id,
    name,
    loadType,
    equipmentSpecific: loadType === 'machine' || loadType === 'cable',
    unilateral: false,
    perHand: loadType === 'dumbbell',
    stepLb,
    defaultRegime: { ...HIGH_REP },
    muscleWeights,
    isMainLift: false,
    isFinisher: false,
    notes,
    formUrl: null,
    archivedAt: null,
    createdAt: BACK_FOCUS_MS,
    updatedAt: BACK_FOCUS_MS,
  }
}

export const BACK_FOCUS_EXERCISES: readonly Exercise[] = [
  exercise(
    'ex-incline-db-y-raise',
    'Incline DB Y-raise',
    'dumbbell',
    2.5,
    { [TRAPS]: 1, [UPPER_BACK]: 0.5 },
    'Lower and mid traps: the prone Y gave the highest lower-trap activity of the scapular exercises tested (Ekstrom 2003). Light weights, thumbs up, no shrugging.',
  ),
  exercise(
    'ex-cable-y-raise',
    'Cable Y-raise',
    'cable',
    2.5,
    { [TRAPS]: 1, [UPPER_BACK]: 0.5 },
    'The cable keeps tension overhead, where the lower traps work hardest.',
  ),
  exercise(
    'ex-cable-shrug',
    'Cable shrug',
    'cable',
    5,
    { [TRAPS]: 1 },
    'Upward-rotation shrug: arms about 30° out to the sides raised upper- and lower-trap activity over a standard shrug (Pizzari 2014). Use two low pulleys close to your hands.',
  ),
]

const VERTICAL_OLD: MuscleWeights = { [LATS]: 1, biceps: 0.5 }
const VERTICAL_NEW: MuscleWeights = { [LATS]: 1, [UPPER_BACK]: 0.5, biceps: 0.5 }
const ROW_OLD: MuscleWeights = { [LATS]: 1, biceps: 0.5, rear_delts: 0.5 }
const ROW_TUCKED: MuscleWeights = { [LATS]: 1, [UPPER_BACK]: 1, biceps: 0.5, rear_delts: 0.5 }
const ROW_FLARED: MuscleWeights = { [UPPER_BACK]: 1, [LATS]: 0.5, biceps: 0.5, rear_delts: 0.5 }

/** Exercise → [weights it had in the previous seed, new weights]. */
const REWEIGHT: Readonly<Record<string, readonly [MuscleWeights, MuscleWeights]>> = {
  'ex-weighted-chin-up': [VERTICAL_OLD, VERTICAL_NEW],
  'ex-pull-up': [VERTICAL_OLD, VERTICAL_NEW],
  'ex-rocking-pulldown': [VERTICAL_OLD, VERTICAL_NEW],
  'ex-lat-pulldown': [VERTICAL_OLD, VERTICAL_NEW],
  'ex-neutral-pulldown': [VERTICAL_OLD, VERTICAL_NEW],
  // The user rows wide on this machine (asked 2026-10-18): upper-back biased.
  'ex-machine-barbell-row': [ROW_OLD, ROW_FLARED],
  'ex-machine-row-upper': [ROW_OLD, ROW_FLARED],
  'ex-seated-cable-row': [ROW_OLD, ROW_TUCKED],
  'ex-chest-supported-tbar-row': [ROW_OLD, ROW_TUCKED],
  'ex-one-arm-db-row': [ROW_OLD, ROW_TUCKED],
  'ex-hyper-y-w': [
    { rear_delts: 1, [LATS]: 0.5 },
    { [UPPER_BACK]: 1, [TRAPS]: 0.5, rear_delts: 0.5 },
  ],
  'ex-face-pull': [{ rear_delts: 1 }, { rear_delts: 1, [UPPER_BACK]: 0.5 }],
}

const SHRUG_FINISHER_NOTE = 'Optional finisher (the spec’s shrug ladder).'

interface NewSlot {
  id: string
  programDayId: string
  /** Inserted after this slot (or last in the day when it's gone). */
  after: string
  exerciseId: string
  regime: Regime
  alternates: readonly string[]
  /** Skip when the day already has an active slot like this (ids resolved to stand-ins). */
  hasAlready: (exercise: Exercise | undefined, resolveId: (id: string) => string) => boolean
}

const trainsTrapsDirectly = (e: Exercise | undefined) => e?.muscleWeights[TRAPS] === 1
const VERTICAL_PULLS = new Set([
  'ex-lat-pulldown',
  'ex-neutral-pulldown',
  'ex-pull-up',
  'ex-weighted-chin-up',
  'ex-rocking-pulldown',
])

const NEW_SLOTS: readonly NewSlot[] = [
  {
    id: 'slot-push-shrug',
    programDayId: 'day-push',
    after: 'slot-push-5',
    exerciseId: 'ex-barbell-shrug',
    regime: r(2, [8, 12], [0, 1], [120, 120]),
    alternates: ['ex-db-shrug', 'ex-cable-shrug'],
    hasAlready: trainsTrapsDirectly,
  },
  {
    id: 'slot-pull-y-raise',
    programDayId: 'day-pull',
    after: 'slot-pull-3',
    exerciseId: 'ex-incline-db-y-raise',
    regime: r(2, [12, 20], [0, 1], [90, 90]),
    alternates: ['ex-cable-y-raise'],
    hasAlready: (e) => !!e && (trainsTrapsDirectly(e) || /y[-\s]?raise/i.test(e.name)),
  },
  {
    id: 'slot-upper-lat-pulldown',
    programDayId: 'day-upper',
    after: 'slot-upper-1',
    exerciseId: 'ex-lat-pulldown',
    regime: r(3, [8, 12], [1, 2], [120, 120]),
    alternates: ['ex-neutral-pulldown', 'ex-pull-up'],
    hasAlready: (e, resolveId) => !!e && [...VERTICAL_PULLS].some((id) => resolveId(id) === e.id),
  },
  {
    id: 'slot-upper-shrug',
    programDayId: 'day-upper',
    after: 'slot-upper-4',
    exerciseId: 'ex-cable-shrug',
    regime: r(2, [12, 20], [0, 1], [90, 90]),
    alternates: ['ex-db-shrug', 'ex-barbell-shrug'],
    hasAlready: trainsTrapsDirectly,
  },
]

function sameWeights(a: MuscleWeights | undefined, b: MuscleWeights): boolean {
  if (!a || typeof a !== 'object') return false
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

const alternatesOf = (s: ProgramSlot): string[] =>
  Array.isArray(s.alternateExerciseIds) ? s.alternateExerciseIds : []

const norm = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '')

/** Names of the exercises the October updates add, for finding a user's same-named stand-in. */
const CATALOG_NAMES = new Map(
  [...CATALOG_2026_10, ...BACK_FOCUS_EXERCISES].map((e) => [e.id, e.name]),
)

export interface BackFocusOptions {
  /**
   * The day the update runs (upgrade or restore): Lats, Upper back and Traps count from it, and
   * the first ramp prompt is due `rampEveryWeeks` later. Default: the update's planned date.
   */
  trackedFrom?: LocalDate
}

/** Apply the back-focus update (pure; see the header for exactly what changes). */
export function applyUpdate2026_10b(
  t: BackFocusTables,
  opts: BackFocusOptions = {},
): BackFocusTables {
  const at = BACK_FOCUS_MS
  const from = opts.trackedFrom ?? BACK_FOCUS_TRACKED_FROM

  // 1. Muscles.
  let muscles: Muscle[] = t.muscles.map((m) =>
    (m as Partial<Muscle>).trackedFrom === undefined ? { ...m, trackedFrom: null } : m,
  )
  muscles = muscles.map((m) => {
    if (m.id === LATS) {
      // Redefined by the split (rows now count partly as upper back), and the ramp's first
      // prompt counts from here rather than from the bulk's start.
      const name = m.name === 'Back' ? 'Lats' : m.name
      const trackedFrom = m.trackedFrom ?? from
      return name === m.name && m.lagging && trackedFrom === m.trackedFrom
        ? m
        : { ...m, name, lagging: true, trackedFrom }
    }
    if (m.id === TRAPS) {
      // While Traps was exempt from "low" its band had no effect (the muscle form saves the
      // global band anyway), so the new 6-16 replaces it; a band set after that is kept.
      const inert = m.exemptLow
      const next: Muscle = {
        ...m,
        exemptLow: false,
        lagging: true,
        bandMin: inert ? 6 : (m.bandMin ?? 6),
        bandMax: inert ? 16 : (m.bandMax ?? 16),
        trackedFrom: m.trackedFrom ?? from,
      }
      const same = (Object.keys(next) as (keyof Muscle)[]).every((k) => next[k] === m[k])
      return same ? m : next
    }
    return m
  })
  if (!muscles.some((m) => m.id === UPPER_BACK)) {
    const lats = muscles.find((m) => m.id === LATS)
    muscles.push({
      id: UPPER_BACK,
      name: 'Upper back',
      sortOrder: (lats?.sortOrder ?? muscles.length) + 0.5,
      bandMin: null,
      bandMax: null,
      exemptLow: false,
      lagging: false,
      trackedFrom: from,
      archivedAt: null,
    })
  }

  // 2-3. Library.
  let exercises: Exercise[] = t.exercises.map((e) => {
    const rule = REWEIGHT[e.id]
    let next = e
    if (rule && sameWeights(e.muscleWeights, rule[0])) {
      next = { ...next, muscleWeights: { ...rule[1] }, updatedAt: at }
    }
    if (e.id === 'ex-barbell-shrug' && e.isFinisher && e.notes === SHRUG_FINISHER_NOTE) {
      next = {
        ...next,
        isFinisher: false,
        notes:
          'Heavy shrug for the upper traps: straight up, a short pause at the top. Straps are fine.',
        updatedAt: at,
      }
    }
    return next
  })
  // A catalog id resolves to the user's own same-named exercise when the catalog entry was never
  // added (the October 10 update let such exercises stand in), so nothing is duplicated.
  const ids = new Set(exercises.map((e) => e.id))
  const byName = new Map(exercises.map((e) => [norm(e.name), e.id]))
  const resolveId = (id: string): string => {
    if (ids.has(id)) return id
    const name = CATALOG_NAMES.get(id)
    return (name !== undefined ? byName.get(norm(name)) : undefined) ?? id
  }
  for (const e of BACK_FOCUS_EXERCISES) {
    if (ids.has(e.id) || byName.has(norm(e.name))) continue
    exercises = [
      ...exercises,
      { ...e, defaultRegime: { ...e.defaultRegime }, muscleWeights: { ...e.muscleWeights } },
    ]
    ids.add(e.id)
    byName.set(norm(e.name), e.id)
  }
  let byId = new Map(exercises.map((e) => [e.id, e]))
  const isActive = (id: string) => byId.get(id)?.archivedAt === null

  // 4. Program.
  let slots: ProgramSlot[] = t.programSlots.map((s) =>
    s.id === 'slot-pull-3' &&
    s.archivedAt === null &&
    s.defaultExerciseId === 'ex-rocking-pulldown' &&
    s.sets === 2
      ? { ...s, sets: 3 }
      : s,
  )
  const added: ProgramSlot[] = []
  for (const n of NEW_SLOTS) {
    const exerciseId = resolveId(n.exerciseId)
    const day = t.programDays.find((d) => d.id === n.programDayId)
    if (!day || day.archivedAt !== null || slots.some((s) => s.id === n.id)) continue
    if (!isActive(exerciseId)) continue
    const daySlots = slots.filter((s) => s.programDayId === n.programDayId)
    const live = daySlots.filter((s) => s.archivedAt === null)
    if (live.some((s) => n.hasAlready(byId.get(s.defaultExerciseId), resolveId))) continue
    const anchor = live.find((s) => s.id === n.after)
    const order = anchor ? anchor.order + 1 : Math.max(-1, ...daySlots.map((s) => s.order)) + 1
    slots = slots.map((s) =>
      s.programDayId === n.programDayId && s.order >= order ? { ...s, order: s.order + 1 } : s,
    )
    const alternates = [...new Set(n.alternates.map(resolveId))]
    const slot: ProgramSlot = {
      id: n.id,
      programDayId: n.programDayId,
      order,
      label: byId.get(exerciseId)!.name,
      defaultExerciseId: exerciseId,
      alternateExerciseIds: alternates.filter((id) => isActive(id) && id !== exerciseId),
      ...n.regime,
      optional: false,
      note: '',
      archivedAt: null,
    }
    const after = anchor
      ? slots.findIndex((s) => s.id === anchor.id)
      : slots.map((s) => s.programDayId).lastIndexOf(n.programDayId)
    slots.splice(after + 1, 0, slot)
    added.push(slot)
  }
  // Keep alternates valid: a slot never lists its own default.
  slots = slots.map((s) =>
    alternatesOf(s).includes(s.defaultExerciseId)
      ? { ...s, alternateExerciseIds: alternatesOf(s).filter((id) => id !== s.defaultExerciseId) }
      : s,
  )

  // An exercise that now fills a program slot must progress: it can't stay a finisher.
  const promote = new Set(
    added.map((s) => s.defaultExerciseId).filter((id) => byId.get(id)?.isFinisher === true),
  )
  if (promote.size > 0) {
    exercises = exercises.map((e) =>
      promote.has(e.id) ? { ...e, isFinisher: false, updatedAt: at } : e,
    )
    byId = new Map(exercises.map((e) => [e.id, e]))
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
