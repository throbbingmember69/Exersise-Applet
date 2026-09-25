// Program editor commands: days, slots, the exercise library, gyms (per-gym exercise swaps and
// machine steps), track start loads and muscles.
//
// Edits change only what FUTURE sessions see: a session snapshots its prescription, exercise
// name, load type and muscle weights when it starts (sessionExercises), so past sessions, their
// progression results and their logged volume never move. Days, slots and exercises that may
// have history are archived, never deleted.
//
// Every command validates its input and throws ServiceError(code, readable message). Checks that
// need the database run inside the command's single read-write transaction, so a failed check
// writes nothing.
import { trackKey } from '@/domain/progression/keys'
import { resolveBand } from '@/domain/volume'
import {
  SHARED_GYM_SCOPE,
  type Exercise,
  type GymScope,
  type LoadType,
  type Muscle,
  type MuscleId,
  type MuscleWeight,
  type ProgramDay,
  type ProgramSlot,
  type Regime,
  type Weekday,
} from '@/domain/types'
import type { ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { loadSettings } from '../settings'
import { loadTrainingModel } from '../training/model'

/** Input bounds for the editor (the UI uses them for stepper limits). */
export const PROGRAM_LIMITS = {
  setsMin: 1,
  setsMax: 10,
  repsMin: 1,
  repsMax: 50,
  rirMin: 0,
  rirMax: 5,
  restMinSec: 0,
  restMaxSec: 900,
} as const

export const LOAD_TYPES: readonly LoadType[] = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight_plus',
]

/** Machine and cable loads aren't comparable between gyms, so their tracks split per gym. */
export function defaultEquipmentSpecific(loadType: LoadType): boolean {
  return loadType === 'machine' || loadType === 'cable'
}

/** Dumbbell loads are recorded per hand. */
export function defaultPerHand(loadType: LoadType): boolean {
  return loadType === 'dumbbell'
}

// ── Days ─────────────────────────────────────────────────────────────────────

export async function createDay(
  ctx: ServiceCtx,
  name: string,
  weekday: Weekday | null = null,
): Promise<string> {
  const cleanName = requireName(name, 'A program day')
  checkWeekday(weekday)
  const { db } = ctx
  const id = ctx.newId()
  await db.transaction('rw', db.programDays, async () => {
    const order = nextOrder(await db.programDays.toArray())
    await db.programDays.add({
      id,
      name: cleanName,
      weekday,
      order,
      note: '',
      archivedAt: null,
    })
  })
  return id
}

export interface DayPatch {
  name?: string
  weekday?: Weekday | null
  note?: string
}

export async function updateDay(ctx: ServiceCtx, id: string, patch: DayPatch): Promise<void> {
  const changes: Partial<ProgramDay> = {}
  if (patch.name !== undefined) changes.name = requireName(patch.name, 'A program day')
  if (patch.weekday !== undefined) {
    checkWeekday(patch.weekday)
    changes.weekday = patch.weekday
  }
  if (patch.note !== undefined) changes.note = requireText(patch.note, 'The note')
  const { db } = ctx
  await db.transaction('rw', db.programDays, async () => {
    await requireRow(db.programDays.get(id), 'program day', id)
    await db.programDays.update(id, changes)
  })
}

/**
 * Put days in the given order. `ids` must list every active day once; archived days may be
 * listed too, and any that aren't keep their relative order after the listed ones.
 */
export async function reorderDays(ctx: ServiceCtx, ids: readonly string[]): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.programDays, async () => {
    const days = byOrder(await db.programDays.toArray())
    await writeOrder(applyOrder(days, ids, 'day'), (id, order) =>
      db.programDays.update(id, { order }),
    )
  })
}

export async function archiveDay(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.programDays, async () => {
    const day = await requireRow(db.programDays.get(id), 'program day', id)
    if (day.archivedAt === null) await db.programDays.update(id, { archivedAt: ctx.now() })
  })
}

export async function restoreDay(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.programDays, async () => {
    await requireRow(db.programDays.get(id), 'program day', id)
    await db.programDays.update(id, { archivedAt: null })
  })
}

// ── Slots ────────────────────────────────────────────────────────────────────

export interface SlotInput extends Regime {
  exerciseId: string
  /** Defaults to the exercise's name. */
  label?: string
  alternateExerciseIds?: readonly string[]
  note?: string
}

export async function createSlot(
  ctx: ServiceCtx,
  dayId: string,
  input: SlotInput,
): Promise<string> {
  const regime = checkRegime(pickRegime(input))
  const label = input.label === undefined ? '' : requireText(input.label, 'The label').trim()
  const note = input.note === undefined ? '' : requireText(input.note, 'The note')
  const { db } = ctx
  const id = ctx.newId()
  await db.transaction('rw', [db.programDays, db.programSlots, db.exercises], async () => {
    const day = await requireRow(db.programDays.get(dayId), 'program day', dayId)
    if (day.archivedAt !== null) {
      throw new ServiceError('day_archived', `${day.name} is archived. Restore it to add slots.`)
    }
    const exercises = await exerciseMap(ctx)
    const exercise = requireActiveExercise(exercises, input.exerciseId)
    const alternates = checkAlternates(input.alternateExerciseIds ?? [], exercise.id, exercises, [])
    const order = nextOrder(await db.programSlots.where('programDayId').equals(dayId).toArray())
    await db.programSlots.add({
      id,
      programDayId: dayId,
      order,
      label: label || exercise.name,
      defaultExerciseId: exercise.id,
      alternateExerciseIds: alternates,
      ...regime,
      note,
      archivedAt: null,
    })
  })
  return id
}

export interface SlotPatch extends Partial<Regime> {
  label?: string
  note?: string
  /**
   * The slot's permanent exercise. Promoting one of the alternates swaps it with the old default
   * (unless `alternateExerciseIds` is also given).
   */
  defaultExerciseId?: string
  alternateExerciseIds?: readonly string[]
}

export async function updateSlot(ctx: ServiceCtx, id: string, patch: SlotPatch): Promise<void> {
  const label = patch.label === undefined ? undefined : requireText(patch.label, 'The label').trim()
  const note = patch.note === undefined ? undefined : requireText(patch.note, 'The note')
  const { db } = ctx
  await db.transaction('rw', [db.programSlots, db.exercises], async () => {
    const slot = await requireRow(db.programSlots.get(id), 'program slot', id)
    const regime = checkRegime({ ...pickRegime(slot), ...definedRegimeFields(patch) })
    const exercises = await exerciseMap(ctx)
    let defaultId = slot.defaultExerciseId
    let alternates = slot.alternateExerciseIds
    if (patch.defaultExerciseId !== undefined && patch.defaultExerciseId !== defaultId) {
      const promoted = requireActiveExercise(exercises, patch.defaultExerciseId)
      alternates = alternates.map((a) => (a === promoted.id ? defaultId : a))
      defaultId = promoted.id
    }
    if (patch.alternateExerciseIds !== undefined) alternates = [...patch.alternateExerciseIds]
    alternates = checkAlternates(alternates, defaultId, exercises, slot.alternateExerciseIds)
    const changes: Partial<ProgramSlot> = {
      ...regime,
      defaultExerciseId: defaultId,
      alternateExerciseIds: alternates,
    }
    if (label !== undefined) changes.label = label || exercises.get(defaultId)!.name
    if (note !== undefined) changes.note = note
    await db.programSlots.update(id, changes)
  })
}

/** Order a day's slots. `ids` must list every active slot of the day once (see reorderDays). */
export async function reorderSlots(
  ctx: ServiceCtx,
  dayId: string,
  ids: readonly string[],
): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', [db.programDays, db.programSlots], async () => {
    await requireRow(db.programDays.get(dayId), 'program day', dayId)
    const slots = byOrder(await db.programSlots.where('programDayId').equals(dayId).toArray())
    await writeOrder(applyOrder(slots, ids, 'slot'), (id, order) =>
      db.programSlots.update(id, { order }),
    )
  })
}

export async function archiveSlot(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.programSlots, async () => {
    const slot = await requireRow(db.programSlots.get(id), 'program slot', id)
    if (slot.archivedAt === null) await db.programSlots.update(id, { archivedAt: ctx.now() })
  })
}

export async function restoreSlot(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', [db.programSlots, db.exercises], async () => {
    const slot = await requireRow(db.programSlots.get(id), 'program slot', id)
    if (slot.archivedAt === null) return
    const exercise = await db.exercises.get(slot.defaultExerciseId)
    if (exercise && exercise.archivedAt !== null) {
      throw new ServiceError(
        'exercise_archived',
        `${exercise.name} is archived. Restore it, or restore the slot and pick another exercise.`,
      )
    }
    await db.programSlots.update(id, { archivedAt: null })
  })
}

// ── Exercises ────────────────────────────────────────────────────────────────

export interface ExerciseInput {
  name: string
  loadType: LoadType
  stepLb: number
  /** Used when the exercise is added ad hoc or to a new slot. */
  defaultRegime: Regime
  muscleWeights: Readonly<Record<MuscleId, MuscleWeight>>
  /** Default: machine and cable loads are separate per gym. */
  equipmentSpecific?: boolean
  /** Default: dumbbell loads are per hand. */
  perHand?: boolean
  unilateral?: boolean
  isMainLift?: boolean
  isFinisher?: boolean
  notes?: string
}

export async function createExercise(ctx: ServiceCtx, input: ExerciseInput): Promise<string> {
  const name = requireName(input.name, 'An exercise')
  const loadType = checkLoadType(input.loadType)
  const stepLb = checkStep(input.stepLb)
  const defaultRegime = checkRegime(pickRegime(input.defaultRegime ?? ({} as Regime)))
  const flags = {
    equipmentSpecific: optionalBool(input.equipmentSpecific, 'equipmentSpecific'),
    perHand: optionalBool(input.perHand, 'perHand'),
    unilateral: optionalBool(input.unilateral, 'unilateral') ?? false,
    isMainLift: optionalBool(input.isMainLift, 'isMainLift') ?? false,
    isFinisher: optionalBool(input.isFinisher, 'isFinisher') ?? false,
  }
  const notes = input.notes === undefined ? '' : requireText(input.notes, 'Notes')
  const { db } = ctx
  const id = ctx.newId()
  await db.transaction('rw', [db.exercises, db.muscles], async () => {
    const exercises = await db.exercises.toArray()
    checkUniqueName(name, exercises, null, 'exercise')
    const muscleWeights = checkMuscleWeights(input.muscleWeights, await db.muscles.toArray())
    const now = ctx.now()
    await db.exercises.add({
      id,
      name,
      loadType,
      equipmentSpecific: flags.equipmentSpecific ?? defaultEquipmentSpecific(loadType),
      unilateral: flags.unilateral,
      perHand: flags.perHand ?? defaultPerHand(loadType),
      stepLb,
      defaultRegime,
      muscleWeights,
      isMainLift: flags.isMainLift,
      isFinisher: flags.isFinisher,
      notes,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
  })
  return id
}

export type ExercisePatch = Partial<Omit<ExerciseInput, 'defaultRegime'>> & {
  /** Only the given fields change. */
  defaultRegime?: Partial<Regime>
}

/**
 * Edit a library exercise. Past sessions keep the name, load type and muscle weights they were
 * logged with. Changing the load type also moves `equipmentSpecific` / `perHand` to the new
 * type's defaults, unless the patch sets them or they had been set away from the old defaults.
 * Toggling `equipmentSpecific` regroups existing history into per-gym or shared tracks.
 */
export async function updateExercise(
  ctx: ServiceCtx,
  id: string,
  patch: ExercisePatch,
): Promise<void> {
  const name = patch.name === undefined ? undefined : requireName(patch.name, 'An exercise')
  const loadType = patch.loadType === undefined ? undefined : checkLoadType(patch.loadType)
  const stepLb = patch.stepLb === undefined ? undefined : checkStep(patch.stepLb)
  const notes = patch.notes === undefined ? undefined : requireText(patch.notes, 'Notes')
  const flags = {
    equipmentSpecific: optionalBool(patch.equipmentSpecific, 'equipmentSpecific'),
    perHand: optionalBool(patch.perHand, 'perHand'),
    unilateral: optionalBool(patch.unilateral, 'unilateral'),
    isMainLift: optionalBool(patch.isMainLift, 'isMainLift'),
    isFinisher: optionalBool(patch.isFinisher, 'isFinisher'),
  }
  const { db } = ctx
  await db.transaction('rw', [db.exercises, db.muscles], async () => {
    const current = await requireRow(db.exercises.get(id), 'exercise', id)
    if (name !== undefined) checkUniqueName(name, await db.exercises.toArray(), id, 'exercise')
    const next: Exercise = { ...current, updatedAt: ctx.now() }
    if (name !== undefined) next.name = name
    if (stepLb !== undefined) next.stepLb = stepLb
    if (notes !== undefined) next.notes = notes
    if (patch.defaultRegime !== undefined) {
      next.defaultRegime = checkRegime({
        ...current.defaultRegime,
        ...definedRegimeFields(patch.defaultRegime),
      })
    }
    if (patch.muscleWeights !== undefined) {
      next.muscleWeights = checkMuscleWeights(patch.muscleWeights, await db.muscles.toArray())
    }
    if (loadType !== undefined && loadType !== current.loadType) {
      next.loadType = loadType
      if (current.equipmentSpecific === defaultEquipmentSpecific(current.loadType)) {
        next.equipmentSpecific = defaultEquipmentSpecific(loadType)
      }
      if (current.perHand === defaultPerHand(current.loadType)) {
        next.perHand = defaultPerHand(loadType)
      }
    }
    for (const [key, value] of Object.entries(flags) as [keyof typeof flags, boolean | undefined][])
      if (value !== undefined) next[key] = value
    await db.exercises.put(next)
  })
}

/**
 * Archive (hide) an exercise. Refused while it fills an active program slot, as the slot's
 * default or as a gym's override, since the program would then point at a hidden exercise.
 */
export async function archiveExercise(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction(
    'rw',
    [db.exercises, db.programSlots, db.programDays, db.gymSlotOverrides, db.gyms],
    async () => {
      const exercise = await requireRow(db.exercises.get(id), 'exercise', id)
      if (exercise.archivedAt !== null) return
      const [slots, days, allOverrides, gyms] = await Promise.all([
        db.programSlots.toArray(),
        db.programDays.toArray(),
        db.gymSlotOverrides.toArray(),
        db.gyms.toArray(),
      ])
      const overrides = allOverrides.filter((o) => o.exerciseId === id)
      const dayName = new Map(days.map((d) => [d.id, d.name]))
      const gymName = new Map(gyms.map((g) => [g.id, g.name]))
      const activeSlots = new Map(slots.filter((s) => s.archivedAt === null).map((s) => [s.id, s]))
      const uses = [
        ...[...activeSlots.values()]
          .filter((s) => s.defaultExerciseId === id)
          .map((s) => ({ slotId: s.id, where: `${dayName.get(s.programDayId) ?? '?'}` })),
        ...overrides
          .filter((o) => activeSlots.has(o.slotId))
          .map((o) => ({
            slotId: o.slotId,
            where: `${dayName.get(activeSlots.get(o.slotId)!.programDayId) ?? '?'} at ${gymName.get(o.gymId) ?? '?'}`,
          })),
      ]
      if (uses.length > 0) {
        throw new ServiceError(
          'exercise_in_use',
          `${exercise.name} is used in the program (${uses.map((u) => u.where).join(', ')}). ` +
            'Pick another exercise for those slots first.',
          { slotIds: uses.map((u) => u.slotId) },
        )
      }
      await db.exercises.update(id, { archivedAt: ctx.now(), updatedAt: ctx.now() })
    },
  )
}

export async function restoreExercise(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.exercises, async () => {
    const exercise = await requireRow(db.exercises.get(id), 'exercise', id)
    if (exercise.archivedAt !== null) {
      await db.exercises.update(id, { archivedAt: null, updatedAt: ctx.now() })
    }
  })
}

// ── Gyms ─────────────────────────────────────────────────────────────────────

export async function createGym(ctx: ServiceCtx, name: string): Promise<string> {
  const cleanName = requireName(name, 'A gym')
  const { db } = ctx
  const id = ctx.newId()
  await db.transaction('rw', db.gyms, async () => {
    const gyms = await db.gyms.toArray()
    checkUniqueName(cleanName, gyms, null, 'gym')
    await db.gyms.add({
      id,
      name: cleanName,
      sortOrder: nextOrder(gyms.map((g) => ({ order: g.sortOrder }))),
      archivedAt: null,
      createdAt: ctx.now(),
    })
  })
  return id
}

export async function renameGym(ctx: ServiceCtx, id: string, name: string): Promise<void> {
  const cleanName = requireName(name, 'A gym')
  const { db } = ctx
  await db.transaction('rw', db.gyms, async () => {
    await requireRow(db.gyms.get(id), 'gym', id)
    checkUniqueName(cleanName, await db.gyms.toArray(), id, 'gym')
    await db.gyms.update(id, { name: cleanName })
  })
}

/** Archive a gym. The last active gym can't be archived: every session needs one. */
export async function archiveGym(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.gyms, async () => {
    const gym = await requireRow(db.gyms.get(id), 'gym', id)
    if (gym.archivedAt !== null) return
    const active = (await db.gyms.toArray()).filter((g) => g.archivedAt === null)
    if (active.length <= 1) {
      throw new ServiceError('last_gym', `${gym.name} is your only gym, so it can't be archived.`)
    }
    await db.gyms.update(id, { archivedAt: ctx.now() })
  })
}

export async function restoreGym(ctx: ServiceCtx, id: string): Promise<void> {
  const { db } = ctx
  await db.transaction('rw', db.gyms, async () => {
    await requireRow(db.gyms.get(id), 'gym', id)
    await db.gyms.update(id, { archivedAt: null })
  })
}

/**
 * Permanently swap a slot's exercise at one gym (e.g. that gym has no Smith machine). `null`, or
 * the slot's own default, removes the override. At most one override per gym and slot.
 */
export async function setGymSlotOverride(
  ctx: ServiceCtx,
  gymId: string,
  slotId: string,
  exerciseId: string | null,
): Promise<void> {
  const { db } = ctx
  await db.transaction(
    'rw',
    [db.gyms, db.programSlots, db.exercises, db.gymSlotOverrides],
    async () => {
      await requireRow(db.gyms.get(gymId), 'gym', gymId)
      const slot = await requireRow(db.programSlots.get(slotId), 'program slot', slotId)
      const existing = await db.gymSlotOverrides
        .where('[gymId+slotId]')
        .equals([gymId, slotId])
        .first()
      if (exerciseId === null || exerciseId === slot.defaultExerciseId) {
        if (existing) await db.gymSlotOverrides.delete(existing.id)
        return
      }
      requireActiveExercise(await exerciseMap(ctx), exerciseId)
      if (existing) await db.gymSlotOverrides.update(existing.id, { exerciseId })
      else await db.gymSlotOverrides.add({ id: ctx.newId(), gymId, slotId, exerciseId })
    },
  )
}

/** A gym's own step for an exercise (e.g. its stack jumps 7.5 lb). `null` removes it. */
export async function setGymStep(
  ctx: ServiceCtx,
  gymId: string,
  exerciseId: string,
  stepLb: number | null,
): Promise<void> {
  const step = stepLb === null ? null : checkStep(stepLb)
  const { db } = ctx
  await db.transaction('rw', [db.gyms, db.exercises, db.gymExerciseSettings], async () => {
    await requireRow(db.gyms.get(gymId), 'gym', gymId)
    await requireRow(db.exercises.get(exerciseId), 'exercise', exerciseId)
    const existing = await db.gymExerciseSettings
      .where('[gymId+exerciseId]')
      .equals([gymId, exerciseId])
      .first()
    if (step === null) {
      if (existing) await db.gymExerciseSettings.delete(existing.id)
    } else if (existing) {
      await db.gymExerciseSettings.update(existing.id, { stepLb: step })
    } else {
      await db.gymExerciseSettings.add({ id: ctx.newId(), gymId, exerciseId, stepLb: step })
    }
  })
}

// ── Track starts ─────────────────────────────────────────────────────────────

export interface TrackStartInput {
  /** null = no known load ("set in week 1"): the first session is calibration. */
  startLoadLb: number | null
  /** The first session is calibration (its last working load becomes the base). */
  calibrate: boolean
}

/**
 * Where a progression track starts before it has history. `scope` is the gym id for
 * equipment-specific exercises and '*' otherwise (see progression/keys.ts). Refused once the
 * track has logged working sets: replay reads the start (its calibrate flag decides how the first
 * session is scored), so changing it then would rewrite past results; the next load comes from
 * history instead.
 */
export async function setTrackStart(
  ctx: ServiceCtx,
  dayId: string,
  exerciseId: string,
  scope: GymScope,
  input: TrackStartInput,
): Promise<void> {
  const { startLoadLb } = input
  if (startLoadLb !== null && (typeof startLoadLb !== 'number' || !Number.isFinite(startLoadLb))) {
    throw new ServiceError('invalid_load', 'The start load must be a number, or blank.')
  }
  const calibrate = optionalBool(input.calibrate, 'calibrate') ?? false
  const model = await loadTrainingModel(ctx)
  const hasHistory = model
    .trackHistory(dayId, exerciseId, scope)
    .some((session) => session.sets.length > 0)
  const { db } = ctx
  await db.transaction('rw', [db.programDays, db.exercises, db.gyms, db.trackStarts], async () => {
    await requireRow(db.programDays.get(dayId), 'program day', dayId)
    const exercise = await requireRow(db.exercises.get(exerciseId), 'exercise', exerciseId)
    if (startLoadLb !== null && startLoadLb < 0 && exercise.loadType !== 'bodyweight_plus') {
      throw new ServiceError(
        'invalid_load',
        'The start load can only be negative (assisted) for bodyweight-plus exercises.',
      )
    }
    if (exercise.equipmentSpecific) {
      const gym = scope === SHARED_GYM_SCOPE ? undefined : await db.gyms.get(scope)
      if (!gym) {
        throw new ServiceError(
          'invalid_scope',
          `${exercise.name} is tracked per gym, so its start load needs a gym.`,
        )
      }
    } else if (scope !== SHARED_GYM_SCOPE) {
      throw new ServiceError(
        'invalid_scope',
        `${exercise.name} is shared across gyms, so its start load isn't per gym.`,
      )
    }
    if (hasHistory) {
      throw new ServiceError(
        'track_has_history',
        `${exercise.name} already has logged sessions on this day, so its next load comes ` +
          'from them. Change the load in the next session instead.',
      )
    }
    await db.trackStarts.put({
      trackKey: trackKey(dayId, exerciseId, scope),
      programDayId: dayId,
      exerciseId,
      gymScope: scope,
      startLoadLb,
      calibrate,
      updatedAt: ctx.now(),
    })
  })
}

// ── Muscles ──────────────────────────────────────────────────────────────────

export interface MusclePatch {
  name?: string
  /** null = use the global weekly volume band setting. */
  bandMin?: number | null
  bandMax?: number | null
  exemptLow?: boolean
  lagging?: boolean
}

export async function updateMuscle(ctx: ServiceCtx, id: string, patch: MusclePatch): Promise<void> {
  const name = patch.name === undefined ? undefined : requireName(patch.name, 'A muscle')
  for (const key of ['bandMin', 'bandMax'] as const) {
    const v = patch[key]
    if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      throw new ServiceError('invalid_band', 'Band limits must be 0 or more (or blank).')
    }
  }
  const exemptLow = optionalBool(patch.exemptLow, 'exemptLow')
  const lagging = optionalBool(patch.lagging, 'lagging')
  const { db } = ctx
  await db.transaction('rw', [db.muscles, db.settings], async () => {
    const current = await requireRow(db.muscles.get(id), 'muscle', id)
    if (name !== undefined) checkUniqueName(name, await db.muscles.toArray(), id, 'muscle')
    const next: Muscle = { ...current }
    if (name !== undefined) next.name = name
    if (patch.bandMin !== undefined) next.bandMin = patch.bandMin
    if (patch.bandMax !== undefined) next.bandMax = patch.bandMax
    if (exemptLow !== undefined) next.exemptLow = exemptLow
    if (lagging !== undefined) next.lagging = lagging
    const band = resolveBand(next, await loadSettings(ctx))
    if (band.min > band.max) {
      throw new ServiceError(
        'invalid_band',
        `The low limit (${band.min}) can't be above the high limit (${band.max}).`,
      )
    }
    await db.muscles.put(next)
  })
}

export async function createMuscle(ctx: ServiceCtx, name: string): Promise<string> {
  const cleanName = requireName(name, 'A muscle')
  const { db } = ctx
  const id = ctx.newId()
  await db.transaction('rw', db.muscles, async () => {
    const muscles = await db.muscles.toArray()
    checkUniqueName(cleanName, muscles, null, 'muscle')
    await db.muscles.add({
      id,
      name: cleanName,
      sortOrder: nextOrder(muscles.map((m) => ({ order: m.sortOrder }))),
      bandMin: null,
      bandMax: null,
      exemptLow: false,
      lagging: false,
      archivedAt: null,
    })
  })
  return id
}

// ── Validation ───────────────────────────────────────────────────────────────

function requireText(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new ServiceError('invalid_text', `${what} must be text.`)
  return value
}

function requireName(value: unknown, what: string): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '') throw new ServiceError('invalid_name', `${what} needs a name.`)
  return name
}

function checkUniqueName(
  name: string,
  rows: readonly { id: string; name: string; archivedAt: number | null }[],
  selfId: string | null,
  what: 'exercise' | 'gym' | 'muscle',
): void {
  const clash = rows.find(
    (r) => r.id !== selfId && r.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
  )
  if (!clash) return
  throw new ServiceError(
    'duplicate_name',
    clash.archivedAt === null
      ? `There's already ${what === 'exercise' ? 'an' : 'a'} ${what} called ${clash.name}.`
      : `An archived ${what} is already called ${clash.name}. Restore it instead.`,
    { id: clash.id },
  )
}

function checkWeekday(weekday: unknown): asserts weekday is Weekday | null {
  if (weekday === null) return
  if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new ServiceError('invalid_weekday', 'The weekday must be 0 (Sunday) to 6 (Saturday).')
  }
}

function checkLoadType(loadType: unknown): LoadType {
  if (!LOAD_TYPES.includes(loadType as LoadType)) {
    throw new ServiceError('invalid_load_type', `Unknown load type: ${String(loadType)}.`)
  }
  return loadType as LoadType
}

function checkStep(stepLb: unknown): number {
  if (typeof stepLb !== 'number' || !Number.isFinite(stepLb) || stepLb <= 0) {
    throw new ServiceError('invalid_step', 'The step must be more than 0 lb.')
  }
  return stepLb
}

function optionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value
  throw new ServiceError('invalid_input', `${field} must be true or false.`)
}

function pickRegime(r: Regime): Regime {
  const { sets, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec } = r
  return { sets, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec }
}

function definedRegimeFields(patch: Partial<Regime>): Partial<Regime> {
  const out: Partial<Regime> = {}
  for (const key of REGIME_KEYS) if (patch[key] !== undefined) out[key] = patch[key]
  return out
}

const REGIME_KEYS = [
  'sets',
  'repMin',
  'repMax',
  'rirMin',
  'rirMax',
  'restMinSec',
  'restMaxSec',
] as const satisfies readonly (keyof Regime)[]

/** Validate a slot's (or exercise's default) prescription. */
export function checkRegime(r: Regime): Regime {
  const L = PROGRAM_LIMITS
  const whole = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)
  if (!whole(r.sets) || r.sets < L.setsMin || r.sets > L.setsMax) {
    throw regimeError('sets', `Sets must be a whole number from ${L.setsMin} to ${L.setsMax}.`)
  }
  if (!whole(r.repMin) || !whole(r.repMax) || r.repMin < L.repsMin || r.repMax > L.repsMax) {
    throw regimeError('reps', `Reps must be whole numbers from ${L.repsMin} to ${L.repsMax}.`)
  }
  if (r.repMin > r.repMax) {
    throw regimeError('reps', 'The rep range minimum must not be above the maximum.')
  }
  if (!whole(r.rirMin) || !whole(r.rirMax) || r.rirMin < L.rirMin || r.rirMax > L.rirMax) {
    throw regimeError('rir', `RIR must be whole numbers from ${L.rirMin} to ${L.rirMax}.`)
  }
  if (r.rirMin > r.rirMax) {
    throw regimeError('rir', 'The RIR minimum must not be above the maximum.')
  }
  if (
    !whole(r.restMinSec) ||
    !whole(r.restMaxSec) ||
    r.restMinSec < L.restMinSec ||
    r.restMaxSec > L.restMaxSec
  ) {
    throw regimeError(
      'rest',
      `Rest must be whole seconds from ${L.restMinSec} to ${L.restMaxSec} (${L.restMaxSec / 60} min).`,
    )
  }
  if (r.restMinSec > r.restMaxSec) {
    throw regimeError('rest', 'The minimum rest must not be longer than the maximum.')
  }
  return pickRegime(r)
}

function regimeError(field: string, message: string): ServiceError {
  return new ServiceError('invalid_regime', message, { field })
}

/** Weights must be 0.5 or 1 on known, active muscles, with at least one muscle at 1.0. */
function checkMuscleWeights(
  weights: unknown,
  muscles: readonly Muscle[],
): Record<MuscleId, MuscleWeight> {
  if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) {
    throw new ServiceError('invalid_muscle_weights', 'Muscle weights are missing.')
  }
  const known = new Map(muscles.map((m) => [m.id, m]))
  const out: Record<MuscleId, MuscleWeight> = {}
  for (const [muscleId, weight] of Object.entries(weights)) {
    const muscle = known.get(muscleId)
    if (!muscle || muscle.archivedAt !== null) {
      throw new ServiceError('invalid_muscle_weights', `Unknown muscle: ${muscleId}.`, {
        muscleId,
      })
    }
    if (weight !== 0.5 && weight !== 1) {
      throw new ServiceError(
        'invalid_muscle_weights',
        `${muscle.name}: a muscle weight is 1 (main muscle) or 0.5 (assisting).`,
        { muscleId },
      )
    }
    out[muscleId] = weight
  }
  if (!Object.values(out).includes(1)) {
    throw new ServiceError(
      'invalid_muscle_weights',
      'Pick the main muscle (weight 1) the exercise trains.',
    )
  }
  return out
}

async function exerciseMap(ctx: Pick<ServiceCtx, 'db'>): Promise<Map<string, Exercise>> {
  return new Map((await ctx.db.exercises.toArray()).map((e) => [e.id, e]))
}

function requireActiveExercise(exercises: ReadonlyMap<string, Exercise>, id: string): Exercise {
  const exercise = exercises.get(id)
  if (!exercise) throw notFound('exercise', id)
  if (exercise.archivedAt !== null) {
    throw new ServiceError(
      'exercise_archived',
      `${exercise.name} is archived. Restore it before using it in the program.`,
    )
  }
  return exercise
}

/** Unique, existing, not the default; exercises newly added to the list must be active. */
function checkAlternates(
  ids: readonly unknown[],
  defaultId: string,
  exercises: ReadonlyMap<string, Exercise>,
  previous: readonly string[],
): string[] {
  if (!Array.isArray(ids)) {
    throw new ServiceError('invalid_alternates', 'Alternates must be a list of exercises.')
  }
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string') throw notFound('exercise', String(id))
    if (id === defaultId) continue
    if (out.includes(id)) continue
    if (previous.includes(id)) {
      if (!exercises.has(id)) throw notFound('exercise', id)
    } else requireActiveExercise(exercises, id)
    out.push(id)
  }
  return out
}

// ── Rows and ordering ────────────────────────────────────────────────────────

async function requireRow<T>(row: Promise<T | undefined>, what: string, id: string): Promise<T> {
  const found = await row
  if (found === undefined) throw notFound(what, id)
  return found
}

function notFound(what: string, id: string): ServiceError {
  return new ServiceError('not_found', `That ${what} no longer exists.`, { what, id })
}

function nextOrder(rows: readonly { order: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.order + 1), 0)
}

function byOrder<T extends { id: string; order: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** The rows in their new order: the listed ids first, then unlisted archived rows. */
function applyOrder<T extends { id: string; archivedAt: number | null }>(
  rows: readonly T[],
  ids: readonly string[],
  what: 'day' | 'slot',
): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const listed = new Set<string>()
  for (const id of ids) {
    if (!byId.has(id)) {
      throw new ServiceError('invalid_order', `Unknown ${what} in the new order.`, { id })
    }
    if (listed.has(id)) {
      throw new ServiceError('invalid_order', `A ${what} appears twice in the new order.`, { id })
    }
    listed.add(id)
  }
  const missing = rows.filter((r) => r.archivedAt === null && !listed.has(r.id))
  if (missing.length > 0) {
    throw new ServiceError('invalid_order', `The new order leaves out a ${what}.`, {
      ids: missing.map((r) => r.id),
    })
  }
  return [...ids.map((id) => byId.get(id)!), ...rows.filter((r) => !listed.has(r.id))]
}

async function writeOrder<T extends { id: string; order: number }>(
  rows: readonly T[],
  write: (id: string, order: number) => Promise<unknown>,
): Promise<void> {
  for (const [order, row] of rows.entries()) if (row.order !== order) await write(row.id, order)
}
