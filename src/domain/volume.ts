// Weekly volume accounting (spec "Volume accounting"): fractional sets per muscle = Σ sets × weight,
// with weight 1.0 for the muscle an exercise mainly trains and 0.5 for an assisting muscle. A
// unilateral set covers both sides and counts once. Planned volume sums the program's active slots
// (required ones by default: optional slots count only once they're done, i.e. as logged volume);
// logged volume sums working sets (not warm-ups, not voided) with the session snapshot's weights,
// grouped into calendar training weeks. Flags (audit findings #23, #39): 'low' strictly below the
// muscle's band, except for exempt muscles, unfinished weeks and deload weeks; 'high' strictly above
// it. The per-session cap flags a muscle strictly above the cap.
import { compareLocalDate, weekStart } from './dates'
import type {
  Exercise,
  LocalDate,
  Muscle,
  MuscleId,
  MuscleWeights,
  ProgramDay,
  ProgramSlot,
  Session,
  SessionExercise,
  SetLog,
  Settings,
  Weekday,
} from './types'

export type MuscleVolume = ReadonlyMap<MuscleId, number>

export interface VolumeTotals {
  /** Fractional sets per muscle. Muscles with no volume are absent. */
  byMuscle: MuscleVolume
  /** Sets counted once each, whatever their muscle weights. */
  totalSets: number
}

/** The slot fields planned volume reads (a missing `optional` means a required slot). */
export type PlannedSlot = Pick<ProgramSlot, 'programDayId' | 'sets' | 'archivedAt'> &
  Partial<Pick<ProgramSlot, 'optional'>>

/**
 * Which slots planned volume counts: 'required' (the default: the plan you must do), 'optional'
 * (the extras on offer) or 'all' (the most a day can hold, for the per-session cap).
 */
export type PlannedInclude = 'required' | 'optional' | 'all'

function included(slot: PlannedSlot, include: PlannedInclude): boolean {
  const optional = slot.optional === true
  return include === 'all' || (include === 'optional' ? optional : !optional)
}

/** The exercise filling a slot (after any gym override), or null/undefined if none resolves. */
export type SlotExerciseResolver<S> = (
  slot: S,
) => Pick<Exercise, 'muscleWeights'> | null | undefined

/**
 * Planned weekly volume of the program. Archived slots are skipped; when `days` is given, so are
 * slots on archived or unknown days. A slot whose exercise doesn't resolve adds sets but no volume.
 * Only required slots count unless `include` says otherwise.
 */
export function plannedWeeklyVolume<S extends PlannedSlot>(
  slots: readonly S[],
  resolveExercise: SlotExerciseResolver<S>,
  days?: readonly Pick<ProgramDay, 'id' | 'archivedAt'>[],
  include: PlannedInclude = 'required',
): VolumeTotals {
  const picked = slots.filter((s) => included(s, include))
  if (!days) return sumSlots(picked, resolveExercise)
  const activeDays = new Set(days.filter((d) => d.archivedAt === null).map((d) => d.id))
  return sumSlots(
    picked.filter((s) => activeDays.has(s.programDayId)),
    resolveExercise,
  )
}

/** The optional slots' weekly volume: what the program offers on top of its required sets. */
export function plannedOptionalVolume<S extends PlannedSlot>(
  slots: readonly S[],
  resolveExercise: SlotExerciseResolver<S>,
  days?: readonly Pick<ProgramDay, 'id' | 'archivedAt'>[],
): VolumeTotals {
  return plannedWeeklyVolume(slots, resolveExercise, days, 'optional')
}

/**
 * Planned volume of one day's slots. The per-session cap warning passes 'all': a day must stay
 * under the cap even when its optional slots are done too.
 */
export function plannedDayVolume<S extends PlannedSlot>(
  slots: readonly S[],
  resolveExercise: SlotExerciseResolver<S>,
  include: PlannedInclude = 'required',
): VolumeTotals {
  return sumSlots(
    slots.filter((s) => included(s, include)),
    resolveExercise,
  )
}

/** Two volume totals added together (e.g. required + optional planned volume). */
export function addVolume(a: VolumeTotals, b: VolumeTotals): VolumeTotals {
  const byMuscle = new Map(a.byMuscle)
  for (const [muscle, sets] of b.byMuscle) byMuscle.set(muscle, (byMuscle.get(muscle) ?? 0) + sets)
  return { byMuscle, totalSets: a.totalSets + b.totalSets }
}

/** Working sets per session exercise; warm-ups and voided sets don't count. */
export function countWorkingSets(
  sets: readonly Pick<SetLog, 'sessionExerciseId' | 'isWarmup' | 'voidedAt'>[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const set of sets) {
    if (set.isWarmup || set.voidedAt !== null) continue
    counts.set(set.sessionExerciseId, (counts.get(set.sessionExerciseId) ?? 0) + 1)
  }
  return counts
}

/** Logged volume of one session, using each session exercise's snapshot muscle weights. */
export function loggedSessionVolume(
  sessionExercises: readonly Pick<SessionExercise, 'id' | 'muscleWeights'>[],
  workingSetCounts: ReadonlyMap<string, number>,
): VolumeTotals {
  const byMuscle = new Map<MuscleId, number>()
  let totalSets = 0
  for (const se of sessionExercises) {
    const sets = workingSetCounts.get(se.id) ?? 0
    totalSets += sets
    addWeighted(byMuscle, se.muscleWeights, sets)
  }
  return { byMuscle, totalSets }
}

/** A session with its logged volume, as input to weekly grouping. */
export type LoggedSession = Pick<Session, 'id' | 'date' | 'status' | 'isDeload' | 'voidedAt'> & {
  volume: VolumeTotals
}

export interface WeekVolume extends VolumeTotals {
  weekStart: LocalDate
  /** A deload session was logged this week, so the week gets no 'low' flags. */
  isDeloadWeek: boolean
  /** Counted sessions, in date order. */
  sessionIds: string[]
}

/** Voided and abandoned sessions are excluded from volume; in-progress sets count as logged. */
export function countsTowardVolume(session: Pick<Session, 'status' | 'voidedAt'>): boolean {
  return session.voidedAt === null && session.status !== 'abandoned'
}

/**
 * Logged volume per calendar training week, keyed by the week's first day. Weeks without a counted
 * session are absent; the map iterates in ascending week order.
 */
export function weeklyLoggedVolume(
  sessions: readonly LoggedSession[],
  weekStartDay: Weekday,
): Map<LocalDate, WeekVolume> {
  const counted = sessions
    .filter(countsTowardVolume)
    .sort((a, b) => compareLocalDate(a.date, b.date))
  const weeks = new Map<LocalDate, WeekVolume & { byMuscle: Map<MuscleId, number> }>()
  for (const s of counted) {
    const start = weekStart(s.date, weekStartDay)
    let week = weeks.get(start)
    if (!week) {
      week = {
        weekStart: start,
        byMuscle: new Map(),
        totalSets: 0,
        isDeloadWeek: false,
        sessionIds: [],
      }
      weeks.set(start, week)
    }
    for (const [muscle, sets] of s.volume.byMuscle) {
      week.byMuscle.set(muscle, (week.byMuscle.get(muscle) ?? 0) + sets)
    }
    week.totalSets += s.volume.totalSets
    week.isDeloadWeek ||= s.isDeload
    week.sessionIds.push(s.id)
  }
  return weeks
}

export type VolumeFlag = 'low' | 'ok' | 'high'

export interface VolumeBand {
  min: number
  max: number
}

export interface VolumeFlagContext {
  /** The muscle never flags 'low'. */
  exemptLow: boolean
  /** False for the current, unfinished week: it shows progress, not a verdict. */
  weekComplete: boolean
  deloadWeek: boolean
}

/** A muscle's weekly band: its own bounds where set, else the global settings. */
export function resolveBand(
  muscle: Pick<Muscle, 'bandMin' | 'bandMax'>,
  s: Pick<Settings, 'weeklyVolumeMin' | 'weeklyVolumeMax'>,
): VolumeBand {
  return { min: muscle.bandMin ?? s.weeklyVolumeMin, max: muscle.bandMax ?? s.weeklyVolumeMax }
}

/** 'high' strictly above the band, 'ok' inside it, 'low' strictly below it; null when 'low' is suppressed. */
export function volumeFlag(
  total: number,
  band: VolumeBand,
  ctx: VolumeFlagContext,
): VolumeFlag | null {
  if (total > band.max) return 'high'
  if (total >= band.min) return 'ok'
  return ctx.exemptLow || !ctx.weekComplete || ctx.deloadWeek ? null : 'low'
}

/**
 * Flags for every active muscle, in the given order; a muscle with no volume counts as 0. With the
 * week's dates, a muscle not yet tracked by the week's end (its `trackedFrom` is later) gets no
 * flag, and one tracked only from mid-week can show 'ok' or 'high' but not 'low' (its earlier
 * sessions were logged before it existed).
 */
export function muscleFlags(
  byMuscle: MuscleVolume,
  muscles: readonly (Pick<Muscle, 'id' | 'bandMin' | 'bandMax' | 'exemptLow' | 'archivedAt'> & {
    trackedFrom?: LocalDate | null
  })[],
  s: Pick<Settings, 'weeklyVolumeMin' | 'weeklyVolumeMax'>,
  week: Pick<VolumeFlagContext, 'weekComplete' | 'deloadWeek'> & {
    weekStart?: LocalDate
    weekEnd?: LocalDate
  },
): Map<MuscleId, VolumeFlag | null> {
  const flags = new Map<MuscleId, VolumeFlag | null>()
  for (const m of muscles) {
    if (m.archivedAt !== null) continue
    const from = m.trackedFrom ?? null
    if (from && week.weekEnd && compareLocalDate(week.weekEnd, from) < 0) {
      flags.set(m.id, null)
      continue
    }
    const partial = !!from && !!week.weekStart && compareLocalDate(week.weekStart, from) < 0
    flags.set(
      m.id,
      volumeFlag(byMuscle.get(m.id) ?? 0, resolveBand(m, s), {
        ...week,
        exemptLow: m.exemptLow || partial,
      }),
    )
  }
  return flags
}

/** Muscles whose volume in one session is strictly above the cap. */
export function overSessionCap(byMuscle: MuscleVolume, cap: number): MuscleId[] {
  return [...byMuscle].filter(([, sets]) => sets > cap).map(([muscle]) => muscle)
}

function sumSlots<S extends PlannedSlot>(
  slots: readonly S[],
  resolveExercise: SlotExerciseResolver<S>,
): VolumeTotals {
  const byMuscle = new Map<MuscleId, number>()
  let totalSets = 0
  for (const slot of slots) {
    if (slot.archivedAt !== null) continue
    totalSets += slot.sets
    const exercise = resolveExercise(slot)
    if (exercise) addWeighted(byMuscle, exercise.muscleWeights, slot.sets)
  }
  return { byMuscle, totalSets }
}

function addWeighted(acc: Map<MuscleId, number>, weights: MuscleWeights, sets: number): void {
  if (sets <= 0) return
  for (const [muscle, weight] of Object.entries(weights)) {
    acc.set(muscle, (acc.get(muscle) ?? 0) + sets * weight)
  }
}
