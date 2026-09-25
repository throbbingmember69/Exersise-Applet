// Start sheet: which gym and program day to pre-select, the deload toggle, and a preview of every
// slot's suggested load before the session is created.
import { compareLocalDate, weekStart, weekday } from '@/domain/dates'
import type {
  LoadType,
  LocalDate,
  NextPrescription,
  ProgramDay,
  Regime,
  Session,
  Weekday,
} from '@/domain/types'
import type { ServiceCtx } from '../../context'
import {
  activeDays,
  activeGyms,
  badgeFor,
  deloadView,
  gymNameOf,
  loadQueryData,
  modelAsOf,
  resolveGymId,
  type DeloadView,
  type PrescriptionBadge,
} from './shared'

export interface GymOption {
  id: string
  name: string
}

export interface StartDayOption {
  id: string
  name: string
  weekday: Weekday | null
  /** Date of the latest counted session of this day (on or before today), or null. */
  lastDoneDate: LocalDate | null
  scheduledToday: boolean
}

export interface StartOptions {
  today: LocalDate
  /** Active gyms, by sortOrder. */
  gyms: GymOption[]
  /** The last gym used if still active, else the first gym (null with no gyms). */
  lastGymId: string | null
  /** Active program days, in program order. */
  days: StartDayOption[]
  suggestedDayId: string | null
  inProgressSessionId: string | null
  deload: DeloadView
}

/**
 * What the start sheet pre-selects on `today`. Suggested day: today's scheduled day unless it was
 * already done this training week; otherwise the day after the latest session's day in program
 * order (wrapping); with no history, today's scheduled day or else the first day.
 */
export async function getStartOptions(
  ctx: Pick<ServiceCtx, 'db'>,
  { today }: { today: LocalDate },
): Promise<StartOptions> {
  const q = await loadQueryData(ctx)
  const days = activeDays(q.data.programDays)
  const history = q.index.counted.filter((s) => compareLocalDate(s.date, today) <= 0)
  const lastDone = new Map<string, LocalDate>()
  for (const s of history) if (s.programDayId !== null) lastDone.set(s.programDayId, s.date)
  const todayWeekday = weekday(today)

  return {
    today,
    gyms: activeGyms(q.gyms).map((g) => ({ id: g.id, name: g.name })),
    lastGymId: resolveGymId(q.gyms, q.lastGymSetting),
    days: days.map((d) => ({
      id: d.id,
      name: d.name,
      weekday: d.weekday,
      lastDoneDate: lastDone.get(d.id) ?? null,
      scheduledToday: d.weekday === todayWeekday,
    })),
    suggestedDayId: suggestDay({
      days,
      allDays: q.data.programDays,
      history,
      today,
      weekStartDay: q.model.settings.trainingWeekStartDay as Weekday,
    }),
    inProgressSessionId: q.model.inProgressSession()?.id ?? null,
    deload: deloadView(modelAsOf(q.data, today)),
  }
}

function suggestDay(input: {
  /** Active days in program order. */
  days: readonly ProgramDay[]
  allDays: readonly ProgramDay[]
  /** Counted sessions up to today, oldest first. */
  history: readonly Session[]
  today: LocalDate
  weekStartDay: Weekday
}): string | null {
  const { days, history, today } = input
  const first = days[0]
  if (!first) return null
  const scheduled = days.find((d) => d.weekday === weekday(today))
  const thisWeek = weekStart(today, input.weekStartDay)
  if (
    scheduled &&
    !history.some((s) => s.programDayId === scheduled.id && compareLocalDate(s.date, thisWeek) >= 0)
  ) {
    return scheduled.id
  }
  const byId = new Map(input.allDays.map((d) => [d.id, d]))
  for (let i = history.length - 1; i >= 0; i--) {
    const lastDay = byId.get(history[i]?.programDayId ?? '')
    if (!lastDay) continue
    return (days.find((d) => d.order > lastDay.order) ?? first).id
  }
  return scheduled?.id ?? first.id
}

export interface ExerciseOption {
  id: string
  name: string
}

export interface PreviewSlot {
  slotId: string
  label: string
  exerciseId: string
  exerciseName: string
  loadType: LoadType
  perHand: boolean
  unilateral: boolean
  /** The slot's regime (sets before any deload cut; the suggestion carries the deload sets). */
  regime: Regime
  suggestion: NextPrescription
  swapKind: 'none' | 'gym_override'
  /** Swap candidates: the slot's default and alternates other than the current exercise. */
  alternates: ExerciseOption[]
  badge: PrescriptionBadge
}

export interface SessionPreview {
  programDayId: string
  dayName: string
  gymId: string
  gymName: string
  isDeload: boolean
  /** Working sets across all slots (after any deload cut). */
  totalSets: number
  slots: PreviewSlot[]
}

/** The start-sheet preview of a program day at a gym; null if the day or gym doesn't exist. */
export async function previewSession(
  ctx: Pick<ServiceCtx, 'db'>,
  { gymId, programDayId, isDeload }: { gymId: string; programDayId: string; isDeload: boolean },
): Promise<SessionPreview | null> {
  const q = await loadQueryData(ctx)
  const day = q.data.programDays.find((d) => d.id === programDayId)
  if (!day || !q.gyms.some((g) => g.id === gymId)) return null
  const { model } = q

  const slots = model.slotsOf(programDayId).map((slot): PreviewSlot => {
    const { exercise, swapKind } = model.resolveSlotExercise(slot, gymId)
    const regime: Regime = {
      sets: slot.sets,
      repMin: slot.repMin,
      repMax: slot.repMax,
      rirMin: slot.rirMin,
      rirMax: slot.rirMax,
      restMinSec: slot.restMinSec,
      restMaxSec: slot.restMaxSec,
    }
    const suggestion = model.prescriptionFor({
      programDayId,
      regime,
      exerciseId: exercise.id,
      gymId,
      isDeload,
    })
    const alternates = [...new Set([slot.defaultExerciseId, ...slot.alternateExerciseIds])]
      .filter((id) => id !== exercise.id)
      .flatMap((id) => {
        const alt = model.exercise(id)
        return alt && alt.archivedAt === null ? [{ id: alt.id, name: alt.name }] : []
      })
    return {
      slotId: slot.id,
      label: slot.label,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      loadType: exercise.loadType,
      perHand: exercise.perHand,
      unilateral: exercise.unilateral,
      regime,
      suggestion,
      swapKind,
      alternates,
      badge: badgeFor(suggestion),
    }
  })

  return {
    programDayId,
    dayName: day.name,
    gymId,
    gymName: gymNameOf(q.gyms, gymId),
    isDeload,
    totalSets: slots.reduce((n, s) => n + s.suggestion.sets, 0),
    slots,
  }
}
