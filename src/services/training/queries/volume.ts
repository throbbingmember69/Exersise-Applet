// Volume dashboard: the program's planned weekly fractional sets per muscle at a gym, and the sets
// actually logged in the training week containing a date, each against the muscle's band, plus
// per-session cap warnings (planned per program day, logged per session).
import { addDays, compareLocalDate, weekStart } from '@/domain/dates'
import type { LocalDate, MuscleId, ProgramSlot, Weekday } from '@/domain/types'
import {
  countWorkingSets,
  loggedSessionVolume,
  muscleFlags,
  overSessionCap,
  plannedDayVolume,
  plannedWeeklyVolume,
  resolveBand,
  weeklyLoggedVolume,
  type LoggedSession,
  type VolumeFlag,
  type VolumeTotals,
} from '@/domain/volume'
import type { ServiceCtx } from '../../context'
import {
  activeDays,
  dayNameOf,
  gymNameOf,
  loadQueryData,
  muscleRows,
  resolveGymId,
  type MuscleSets,
} from './shared'

export interface VolumeMuscleRow {
  muscleId: MuscleId
  name: string
  /** The muscle's weekly band (its own bounds, else the global settings). */
  bandMin: number
  bandMax: number
  /** Never flagged 'low'. */
  exemptLow: boolean
  planned: number
  /** Against a complete week (null = 'low' suppressed for an exempt muscle). */
  plannedFlag: VolumeFlag | null
  logged: number
  /** null while 'low' is suppressed: exempt muscle, unfinished week, or deload week. */
  loggedFlag: VolumeFlag | null
}

export interface DayCapWarning {
  programDayId: string
  dayName: string
  /** Muscles planned strictly over the per-session cap on this day. */
  muscles: MuscleSets[]
}

export interface SessionCapWarning {
  sessionId: string
  date: LocalDate
  dayName: string
  /** Muscles logged strictly over the per-session cap in this session. */
  muscles: MuscleSets[]
}

export interface VolumeDashboard {
  asOf: LocalDate
  /** The gym the plan is resolved for (null when there are no gyms). */
  gymId: string | null
  gymName: string | null
  sessionCap: number
  week: {
    start: LocalDate
    end: LocalDate
    /** asOf is the week's last day or later, so 'low' flags apply. */
    complete: boolean
    /** A deload session was logged this week: no 'low' flags. */
    isDeloadWeek: boolean
    /** Sessions counted this week (in-progress included; voided and abandoned left out). */
    sessionIds: string[]
  }
  /** Active muscles in sortOrder. */
  muscles: VolumeMuscleRow[]
  planned: { totalSets: number; capWarnings: DayCapWarning[] }
  logged: { totalSets: number; capWarnings: SessionCapWarning[] }
}

/**
 * Planned vs logged weekly volume. The plan resolves each slot's exercise at `gymId` (default:
 * the last gym used). Logged volume counts every gym's sessions in the training week containing
 * `asOf`, using each session's snapshot muscle weights and its working sets.
 */
export async function getVolumeDashboard(
  ctx: Pick<ServiceCtx, 'db'>,
  { asOf, gymId }: { asOf: LocalDate; gymId?: string },
): Promise<VolumeDashboard> {
  const q = await loadQueryData(ctx)
  const { model, index } = q
  const settings = model.settings
  const cap = settings.sessionCap
  const muscles = q.muscles.filter((m) => m.archivedAt === null)
  const gym = gymId ?? resolveGymId(q.gyms, q.lastGymSetting)

  // Planned.
  const resolve = (slot: ProgramSlot) =>
    model.exercise(slot.defaultExerciseId)
      ? model.resolveSlotExercise(slot, gym ?? '').exercise
      : null
  const planned = plannedWeeklyVolume(q.data.programSlots, resolve, q.data.programDays)
  const plannedFlags = muscleFlags(planned.byMuscle, muscles, settings, {
    weekComplete: true,
    deloadWeek: false,
  })
  const dayWarnings = activeDays(q.data.programDays).flatMap((day): DayCapWarning[] => {
    const volume = plannedDayVolume(model.slotsOf(day.id), resolve)
    const over = overSessionCap(volume.byMuscle, cap)
    return over.length === 0
      ? []
      : [
          {
            programDayId: day.id,
            dayName: day.name,
            muscles: muscleRows(volume.byMuscle, q.muscles, over),
          },
        ]
  })

  // Logged.
  const weekStartDay = settings.trainingWeekStartDay as Weekday
  const start = weekStart(asOf, weekStartDay)
  const end = addDays(start, 6)
  const sessionVolumes = new Map<string, VolumeTotals>()
  const logged: LoggedSession[] = q.data.sessions
    .filter((s) => compareLocalDate(s.date, start) >= 0 && compareLocalDate(s.date, end) <= 0)
    .map((s) => {
      const volume = loggedSessionVolume(
        index.exercisesOf(s.id),
        countWorkingSets(index.setsOfSession(s.id)),
      )
      sessionVolumes.set(s.id, volume)
      return {
        id: s.id,
        date: s.date,
        status: s.status,
        isDeload: s.isDeload,
        voidedAt: s.voidedAt,
        volume,
      }
    })
  const week = weeklyLoggedVolume(logged, weekStartDay).get(start)
  const loggedByMuscle = week?.byMuscle ?? new Map<MuscleId, number>()
  const complete = compareLocalDate(asOf, end) >= 0
  const isDeloadWeek = week?.isDeloadWeek ?? false
  const loggedFlags = muscleFlags(loggedByMuscle, muscles, settings, {
    weekComplete: complete,
    deloadWeek: isDeloadWeek,
  })
  const sessionIds = week?.sessionIds ?? []
  const sessionWarnings = sessionIds.flatMap((id): SessionCapWarning[] => {
    const session = index.sessions.get(id)
    const volume = sessionVolumes.get(id)
    if (!session || !volume) return []
    const over = overSessionCap(volume.byMuscle, cap)
    return over.length === 0
      ? []
      : [
          {
            sessionId: id,
            date: session.date,
            dayName: dayNameOf(q.data.programDays, session.programDayId),
            muscles: muscleRows(volume.byMuscle, q.muscles, over),
          },
        ]
  })

  return {
    asOf,
    gymId: gym,
    gymName: gym === null ? null : gymNameOf(q.gyms, gym),
    sessionCap: cap,
    week: { start, end, complete, isDeloadWeek, sessionIds },
    muscles: muscles.map((m): VolumeMuscleRow => {
      const band = resolveBand(m, settings)
      return {
        muscleId: m.id,
        name: m.name,
        bandMin: band.min,
        bandMax: band.max,
        exemptLow: m.exemptLow,
        planned: planned.byMuscle.get(m.id) ?? 0,
        plannedFlag: plannedFlags.get(m.id) ?? null,
        logged: loggedByMuscle.get(m.id) ?? 0,
        loggedFlag: loggedFlags.get(m.id) ?? null,
      }
    }),
    planned: { totalSets: planned.totalSets, capWarnings: dayWarnings },
    logged: { totalSets: week?.totalSets ?? 0, capWarnings: sessionWarnings },
  }
}
