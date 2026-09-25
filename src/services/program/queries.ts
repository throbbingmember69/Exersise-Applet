// Program editor reads, for `useLiveQuery`: the program overview (days, slots resolved for a gym,
// planned volume against the bands and the per-session cap), the exercise library, one exercise's
// detail, gyms and muscles. Read-only; every result is a plain serializable object.
import {
  muscleFlags,
  overSessionCap,
  plannedDayVolume,
  plannedWeeklyVolume,
  resolveBand,
  type MuscleVolume,
  type VolumeBand,
  type VolumeFlag,
} from '@/domain/volume'
import type {
  EpochMs,
  Exercise,
  Gym,
  GymScope,
  LoadType,
  LocalDate,
  Muscle,
  MuscleId,
  MuscleWeight,
  ProgramDay,
  ProgramSlot,
  Settings,
} from '@/domain/types'
import type { ServiceCtx } from '../context'
import { loadSettings } from '../settings'

type ReadCtx = Pick<ServiceCtx, 'db'>

export interface ExerciseRef {
  id: string
  name: string
}

export interface SlotExerciseView extends ExerciseRef {
  loadType: LoadType
  archived: boolean
}

export interface ProgramSlotView {
  slot: ProgramSlot
  archived: boolean
  /** The exercise filling the slot at the chosen gym: its override, else the slot default. */
  exercise: SlotExerciseView | null
  /** The gym swaps this slot to a different exercise. */
  isOverride: boolean
  defaultExercise: ExerciseRef | null
  /** Suggested swaps (archived exercises left out). */
  alternates: ExerciseRef[]
}

export interface MuscleSets {
  muscleId: MuscleId
  name: string
  sets: number
}

export interface PlannedVolumeView {
  /** Working sets, each counted once. */
  totalSets: number
  /** Fractional sets per muscle (sets × weight), in muscle order; muscles with none are absent. */
  byMuscle: MuscleSets[]
}

export interface ProgramDayView {
  day: ProgramDay
  archived: boolean
  /** Every slot of the day in order, archived ones included (flagged). */
  slots: ProgramSlotView[]
  /** Planned volume of one session of this day (active slots only). */
  volume: PlannedVolumeView
  /** Muscles strictly above the per-session cap. */
  overSessionCap: MuscleSets[]
}

export interface WeeklyMuscleView extends MuscleSets {
  band: VolumeBand
  /** The band comes from the global settings (the muscle has no band of its own). */
  bandIsDefault: boolean
  /** 'low' / 'ok' / 'high' against the band; null when 'low' is suppressed (exempt muscle). */
  flag: VolumeFlag | null
  exemptLow: boolean
  lagging: boolean
}

export interface ProgramOverview {
  /** The gym the slots are resolved for (null only if there are no gyms). */
  gym: { id: string; name: string; archived: boolean } | null
  /** Days in program order, archived ones included (flagged). */
  days: ProgramDayView[]
  /** Planned weekly volume of active days and slots. */
  weekly: { totalSets: number; muscles: WeeklyMuscleView[] }
  sessionCap: number
}

/**
 * The program as the editor shows it. Slots are resolved for `gymId` (default: the first active
 * gym). Weekly volume and flags use the planned program, so the week counts as complete.
 */
export async function getProgramOverview(
  ctx: ReadCtx,
  opts: { gymId?: string | null } = {},
): Promise<ProgramOverview> {
  const { db } = ctx
  const data = await db.transaction(
    'r',
    [
      db.settings,
      db.programDays,
      db.programSlots,
      db.exercises,
      db.gyms,
      db.gymSlotOverrides,
      db.muscles,
    ],
    async () => ({
      settings: await loadSettings(ctx),
      days: await db.programDays.toArray(),
      slots: await db.programSlots.toArray(),
      exercises: await db.exercises.toArray(),
      gyms: await db.gyms.toArray(),
      overrides: await db.gymSlotOverrides.toArray(),
      muscles: await db.muscles.toArray(),
    }),
  )
  const { settings } = data
  const gym = pickGym(data.gyms, opts.gymId ?? null)
  const exercises = new Map(data.exercises.map((e) => [e.id, e]))
  const overrides = new Map(
    data.overrides.filter((o) => o.gymId === gym?.id).map((o) => [o.slotId, o.exerciseId]),
  )
  const resolve = (slot: ProgramSlot) => resolveSlotExercise(slot, exercises, overrides)
  const muscles = sortMuscles(data.muscles)
  const muscleNames = new Map(muscles.map((m) => [m.id, m.name]))

  const days = byOrder(data.days).map((day): ProgramDayView => {
    const slots = byOrder(data.slots.filter((s) => s.programDayId === day.id))
    const volume = plannedDayVolume(slots, (s) => resolve(s).exercise)
    return {
      day,
      archived: day.archivedAt !== null,
      slots: slots.map((slot) => slotView(slot, resolve(slot), exercises)),
      volume: volumeView(volume.totalSets, volume.byMuscle, muscles),
      overSessionCap: overSessionCap(volume.byMuscle, settings.sessionCap).map((muscleId) => ({
        muscleId,
        name: muscleNames.get(muscleId) ?? muscleId,
        sets: volume.byMuscle.get(muscleId)!,
      })),
    }
  })

  const weekly = plannedWeeklyVolume(data.slots, (s) => resolve(s).exercise, data.days)
  return {
    gym: gym && { id: gym.id, name: gym.name, archived: gym.archivedAt !== null },
    days,
    weekly: {
      totalSets: weekly.totalSets,
      muscles: weeklyMuscles(weekly.byMuscle, muscles, settings),
    },
    sessionCap: settings.sessionCap,
  }
}

export interface MuscleWeightView {
  muscleId: MuscleId
  name: string
  weight: MuscleWeight
}

export interface SlotUsage {
  slotId: string
  label: string
  dayId: string
  dayName: string
  dayArchived: boolean
  /** default: the slot's exercise; alternate: a suggested swap; override: a gym's permanent swap. */
  role: 'default' | 'alternate' | 'override'
  /** The gym, for overrides. */
  gymId: string | null
  gymName: string | null
}

export interface LibraryExercise {
  exercise: Exercise
  archived: boolean
  /** Muscle weights in muscle order, main muscles first. */
  muscles: MuscleWeightView[]
  /** Where the active program uses it. */
  usedInSlots: SlotUsage[]
  /** Any set has ever been logged with it (so it can only be archived, never removed). */
  hasHistory: boolean
}

/** The exercise library: active exercises first, then by name. */
export async function getExerciseLibrary(ctx: ReadCtx): Promise<LibraryExercise[]> {
  const data = await readLibraryData(ctx)
  return data.exercises
    .map((e) => libraryItem(e, data))
    .sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) ||
        a.exercise.name.localeCompare(b.exercise.name, undefined, { sensitivity: 'base' }) ||
        compareIds(a.exercise.id, b.exercise.id),
    )
}

export interface GymStepView {
  gymId: string
  gymName: string
  stepLb: number
}

export interface TrackStartView {
  trackKey: string
  dayId: string
  dayName: string
  scope: GymScope
  /** The gym of a per-gym track (null for shared tracks). */
  gymName: string | null
  startLoadLb: number | null
  calibrate: boolean
  updatedAt: EpochMs
}

export interface ExerciseDetail extends LibraryExercise {
  /** Per-gym steps that override `exercise.stepLb`. */
  gymSteps: GymStepView[]
  /** Start loads of this exercise's progression tracks, in program-day order. */
  trackStarts: TrackStartView[]
  /** Finished, non-voided sessions that included it. */
  loggedSessionCount: number
  lastLoggedOn: LocalDate | null
}

export async function getExerciseDetail(ctx: ReadCtx, id: string): Promise<ExerciseDetail | null> {
  const { db } = ctx
  const data = await readLibraryData(ctx)
  const exercise = data.exercises.find((e) => e.id === id)
  if (!exercise) return null
  const extra = await db.transaction(
    'r',
    [db.gymExerciseSettings, db.trackStarts, db.sessionExercises, db.sessions],
    async () => {
      const sessionExercises = await db.sessionExercises.where('exerciseId').equals(id).toArray()
      const sessionIds = [...new Set(sessionExercises.map((se) => se.sessionId))]
      return {
        gymSettings: await db.gymExerciseSettings.toArray(),
        trackStarts: await db.trackStarts.where('exerciseId').equals(id).toArray(),
        sessions: (await db.sessions.bulkGet(sessionIds)).filter((s) => s !== undefined),
      }
    },
  )
  const gymName = new Map(data.gyms.map((g) => [g.id, g.name]))
  const days = new Map(data.days.map((d) => [d.id, d]))
  const counted = extra.sessions.filter((s) => s.status === 'finished' && s.voidedAt === null)
  return {
    ...libraryItem(exercise, data),
    gymSteps: extra.gymSettings
      .filter((g) => g.exerciseId === id && g.stepLb !== null)
      .map((g) => ({ gymId: g.gymId, gymName: gymName.get(g.gymId) ?? g.gymId, stepLb: g.stepLb! }))
      .sort((a, b) => a.gymName.localeCompare(b.gymName) || compareIds(a.gymId, b.gymId)),
    trackStarts: extra.trackStarts
      .map((t): TrackStartView => ({
        trackKey: t.trackKey,
        dayId: t.programDayId,
        dayName: days.get(t.programDayId)?.name ?? t.programDayId,
        scope: t.gymScope,
        gymName: gymName.get(t.gymScope) ?? null,
        startLoadLb: t.startLoadLb,
        calibrate: t.calibrate,
        updatedAt: t.updatedAt,
      }))
      .sort(
        (a, b) =>
          (days.get(a.dayId)?.order ?? Infinity) - (days.get(b.dayId)?.order ?? Infinity) ||
          compareIds(a.trackKey, b.trackKey),
      ),
    loggedSessionCount: counted.length,
    lastLoggedOn: counted.reduce<LocalDate | null>(
      (max, s) => (max === null || s.date > max ? s.date : max),
      null,
    ),
  }
}

export interface GymOverrideView {
  slotId: string
  slotLabel: string
  dayName: string
  exercise: ExerciseRef
}

export interface GymView {
  gym: Gym
  archived: boolean
  /** Slots this gym permanently swaps to another exercise. */
  overrides: GymOverrideView[]
  overrideCount: number
  /** Exercises with a gym-specific step. */
  stepOverrideCount: number
}

/** Gyms in their saved order, archived ones included (flagged). */
export async function getGyms(ctx: ReadCtx): Promise<GymView[]> {
  const { db } = ctx
  const data = await db.transaction(
    'r',
    [
      db.gyms,
      db.gymSlotOverrides,
      db.gymExerciseSettings,
      db.programSlots,
      db.programDays,
      db.exercises,
    ],
    async () => ({
      gyms: await db.gyms.toArray(),
      overrides: await db.gymSlotOverrides.toArray(),
      gymSettings: await db.gymExerciseSettings.toArray(),
      slots: await db.programSlots.toArray(),
      days: await db.programDays.toArray(),
      exercises: await db.exercises.toArray(),
    }),
  )
  const slots = new Map(data.slots.map((s) => [s.id, s]))
  const days = new Map(data.days.map((d) => [d.id, d]))
  const exerciseName = new Map(data.exercises.map((e) => [e.id, e.name]))
  const slotRank = (slotId: string): [dayOrder: number, slotOrder: number] => {
    const slot = slots.get(slotId)
    return slot
      ? [days.get(slot.programDayId)?.order ?? Number.MAX_SAFE_INTEGER, slot.order]
      : [Number.MAX_SAFE_INTEGER, 0]
  }
  return [...data.gyms]
    .sort((a, b) => a.sortOrder - b.sortOrder || compareIds(a.id, b.id))
    .map((gym): GymView => {
      const overrides = data.overrides
        .filter((o) => o.gymId === gym.id)
        .sort((a, b) => {
          const [aDay, aSlot] = slotRank(a.slotId)
          const [bDay, bSlot] = slotRank(b.slotId)
          return aDay - bDay || aSlot - bSlot || compareIds(a.id, b.id)
        })
        .map((o): GymOverrideView => {
          const slot = slots.get(o.slotId)
          return {
            slotId: o.slotId,
            slotLabel: slot?.label ?? o.slotId,
            dayName: (slot && days.get(slot.programDayId)?.name) ?? '',
            exercise: { id: o.exerciseId, name: exerciseName.get(o.exerciseId) ?? o.exerciseId },
          }
        })
      return {
        gym,
        archived: gym.archivedAt !== null,
        overrides,
        overrideCount: overrides.length,
        stepOverrideCount: data.gymSettings.filter((g) => g.gymId === gym.id && g.stepLb !== null)
          .length,
      }
    })
}

export interface MuscleView {
  muscle: Muscle
  archived: boolean
  /** The band flags use: the muscle's own limits where set, else the global settings. */
  band: VolumeBand
  bandIsDefault: boolean
}

/** Muscles in their saved order, archived ones included (flagged). */
export async function getMuscles(ctx: ReadCtx): Promise<MuscleView[]> {
  const { db } = ctx
  const { settings, muscles } = await db.transaction('r', [db.settings, db.muscles], async () => ({
    settings: await loadSettings(ctx),
    muscles: await db.muscles.toArray(),
  }))
  return sortMuscles(muscles).map((muscle) => ({
    muscle,
    archived: muscle.archivedAt !== null,
    band: resolveBand(muscle, settings),
    bandIsDefault: muscle.bandMin === null && muscle.bandMax === null,
  }))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ResolvedSlot {
  exercise: Exercise | null
  isOverride: boolean
}

/**
 * Same rule as TrainingModel.resolveSlotExercise: the gym's override when it names another
 * existing exercise, else the slot default.
 */
function resolveSlotExercise(
  slot: ProgramSlot,
  exercises: ReadonlyMap<string, Exercise>,
  overrides: ReadonlyMap<string, string>,
): ResolvedSlot {
  const overrideId = overrides.get(slot.id)
  const override = overrideId === undefined ? undefined : exercises.get(overrideId)
  if (override && override.id !== slot.defaultExerciseId) {
    return { exercise: override, isOverride: true }
  }
  return { exercise: exercises.get(slot.defaultExerciseId) ?? null, isOverride: false }
}

function slotView(
  slot: ProgramSlot,
  resolved: ResolvedSlot,
  exercises: ReadonlyMap<string, Exercise>,
): ProgramSlotView {
  const { exercise } = resolved
  const defaultExercise = exercises.get(slot.defaultExerciseId)
  return {
    slot,
    archived: slot.archivedAt !== null,
    exercise: exercise && {
      id: exercise.id,
      name: exercise.name,
      loadType: exercise.loadType,
      archived: exercise.archivedAt !== null,
    },
    isOverride: resolved.isOverride,
    defaultExercise: defaultExercise ? ref(defaultExercise) : null,
    alternates: slot.alternateExerciseIds.flatMap((id) => {
      const e = exercises.get(id)
      return e && e.archivedAt === null ? [ref(e)] : []
    }),
  }
}

function ref(e: Exercise): ExerciseRef {
  return { id: e.id, name: e.name }
}

function pickGym(gyms: readonly Gym[], gymId: string | null): Gym | null {
  const chosen = gymId === null ? undefined : gyms.find((g) => g.id === gymId)
  if (chosen) return chosen
  const sorted = [...gyms].sort((a, b) => a.sortOrder - b.sortOrder || compareIds(a.id, b.id))
  return sorted.find((g) => g.archivedAt === null) ?? sorted[0] ?? null
}

function volumeView(
  totalSets: number,
  byMuscle: MuscleVolume,
  muscles: readonly Muscle[],
): PlannedVolumeView {
  return { totalSets, byMuscle: orderedMuscleSets(byMuscle, muscles) }
}

/** Volume entries in muscle order; ids the muscle list doesn't know go last, by id. */
function orderedMuscleSets(byMuscle: MuscleVolume, muscles: readonly Muscle[]): MuscleSets[] {
  const known = muscles
    .filter((m) => byMuscle.has(m.id))
    .map((m) => ({ muscleId: m.id, name: m.name, sets: byMuscle.get(m.id)! }))
  const ids = new Set(muscles.map((m) => m.id))
  const unknown = [...byMuscle]
    .filter(([id]) => !ids.has(id))
    .sort(([a], [b]) => compareIds(a, b))
    .map(([muscleId, sets]) => ({ muscleId, name: muscleId, sets }))
  return [...known, ...unknown]
}

function weeklyMuscles(
  byMuscle: MuscleVolume,
  muscles: readonly Muscle[],
  settings: Settings,
): WeeklyMuscleView[] {
  const flags = muscleFlags(byMuscle, muscles, settings, { weekComplete: true, deloadWeek: false })
  const active = muscles
    .filter((m) => m.archivedAt === null)
    .map((m): WeeklyMuscleView => ({
      muscleId: m.id,
      name: m.name,
      sets: byMuscle.get(m.id) ?? 0,
      band: resolveBand(m, settings),
      bandIsDefault: m.bandMin === null && m.bandMax === null,
      flag: flags.get(m.id) ?? null,
      exemptLow: m.exemptLow,
      lagging: m.lagging,
    }))
  // Volume on archived or unknown muscles is still shown, without a verdict.
  const shown = new Set(active.map((m) => m.muscleId))
  const extra = orderedMuscleSets(byMuscle, muscles)
    .filter((m) => !shown.has(m.muscleId))
    .map((m): WeeklyMuscleView => ({
      ...m,
      band: { min: settings.weeklyVolumeMin, max: settings.weeklyVolumeMax },
      bandIsDefault: true,
      flag: null,
      exemptLow: false,
      lagging: false,
    }))
  return [...active, ...extra]
}

interface LibraryData {
  exercises: Exercise[]
  muscles: Muscle[]
  days: ProgramDay[]
  slots: ProgramSlot[]
  gyms: Gym[]
  overrides: { gymId: string; slotId: string; exerciseId: string }[]
  loggedExerciseIds: Set<string>
}

async function readLibraryData(ctx: ReadCtx): Promise<LibraryData> {
  const { db } = ctx
  return db.transaction(
    'r',
    [
      db.exercises,
      db.muscles,
      db.programDays,
      db.programSlots,
      db.gyms,
      db.gymSlotOverrides,
      db.setLogs,
    ],
    async () => ({
      exercises: await db.exercises.toArray(),
      muscles: sortMuscles(await db.muscles.toArray()),
      days: await db.programDays.toArray(),
      slots: byOrder(await db.programSlots.toArray()),
      gyms: await db.gyms.toArray(),
      overrides: await db.gymSlotOverrides.toArray(),
      loggedExerciseIds: new Set(
        (await db.setLogs.orderBy('exerciseId').uniqueKeys()).map((k) => String(k)),
      ),
    }),
  )
}

function libraryItem(exercise: Exercise, data: LibraryData): LibraryExercise {
  const days = new Map(data.days.map((d) => [d.id, d]))
  const gymName = new Map(data.gyms.map((g) => [g.id, g.name]))
  const slots = new Map(data.slots.map((s) => [s.id, s]))
  const usage = (
    slot: ProgramSlot,
    role: SlotUsage['role'],
    gymId: string | null = null,
  ): SlotUsage => {
    const day = days.get(slot.programDayId)
    return {
      slotId: slot.id,
      label: slot.label,
      dayId: slot.programDayId,
      dayName: day?.name ?? slot.programDayId,
      dayArchived: day ? day.archivedAt !== null : false,
      role,
      gymId,
      gymName: gymId === null ? null : (gymName.get(gymId) ?? gymId),
    }
  }
  const activeSlots = data.slots.filter((s) => s.archivedAt === null)
  const usedInSlots = [
    ...activeSlots.flatMap((s) => {
      if (s.defaultExerciseId === exercise.id) return [usage(s, 'default')]
      if (s.alternateExerciseIds.includes(exercise.id)) return [usage(s, 'alternate')]
      return []
    }),
    ...data.overrides.flatMap((o) => {
      const slot = slots.get(o.slotId)
      return o.exerciseId === exercise.id && slot && slot.archivedAt === null
        ? [usage(slot, 'override', o.gymId)]
        : []
    }),
  ]
  const muscleOrder = new Map(data.muscles.map((m, i) => [m.id, i]))
  const muscleName = new Map(data.muscles.map((m) => [m.id, m.name]))
  const muscles = Object.entries(exercise.muscleWeights)
    .map(([muscleId, weight]) => ({ muscleId, name: muscleName.get(muscleId) ?? muscleId, weight }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        (muscleOrder.get(a.muscleId) ?? Infinity) - (muscleOrder.get(b.muscleId) ?? Infinity) ||
        compareIds(a.muscleId, b.muscleId),
    )
  return {
    exercise,
    archived: exercise.archivedAt !== null,
    muscles,
    usedInSlots,
    hasHistory: data.loggedExerciseIds.has(exercise.id),
  }
}

function sortMuscles(muscles: readonly Muscle[]): Muscle[] {
  return [...muscles].sort((a, b) => a.sortOrder - b.sortOrder || compareIds(a.id, b.id))
}

function byOrder<T extends { id: string; order: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.order - b.order || compareIds(a.id, b.id))
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
