// Volume ramp prompts for lagging muscles (spec: on a bulk, add a set to a lagging muscle every
// 3–4 weeks; setting rampEveryWeeks). A prompt is derived, never stored, until the user answers
// it: accepting adds one set to the chosen program slot and logs the answer in one write;
// declining just logs it. The next prompt for that muscle is due `rampEveryWeeks` after the answer.
import { compareLocalDate, localDateOf } from '@/domain/dates'
import { pickRampSlot, rampDueDate, type RampSlot } from '@/domain/ramp'
import type { LocalDate, Phase, Suggestion } from '@/domain/types'
import { plannedWeeklyVolume, resolveBand } from '@/domain/volume'
import type { ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { activeDays, loadQueryData, resolveGymId, type QueryData } from './queries/shared'

export interface VolumeRampView {
  /** Suggestion-log key: one per muscle and due cycle. */
  key: string
  dueDate: LocalDate
  muscleId: string
  muscleName: string
  slotId: string
  dayName: string
  exerciseName: string
  fromSets: number
  toSets: number
  /** Planned weekly fractional sets for the muscle now and after the extra set. */
  plannedNow: number
  plannedAfter: number
  bandMax: number
}

export interface VolumeRampInput {
  muscleId: string
  slotId: string
  fromSets: number
  /** The prompt's due date: each 3-week cycle is a new prompt, even for the same slot. */
  dueDate: LocalDate
}

export function rampKey(input: VolumeRampInput): string {
  return `volume_ramp|${input.muscleId}|${input.dueDate}|${input.slotId}|${input.fromSets}`
}

const isRamp = (s: Suggestion) => s.kind === 'volume_ramp'

/** The bulk running on `today`, if any. */
function activeBulk(phases: readonly Phase[], today: LocalDate): Phase | null {
  return (
    phases.find(
      (p) =>
        p.status === 'active' && p.type === 'bulk' && compareLocalDate(p.startDate, today) <= 0,
    ) ?? null
  )
}

/** Due ramp prompts on `today`, one per lagging muscle at most. */
export function volumeRampViews(
  q: QueryData,
  phases: readonly Phase[],
  today: LocalDate,
): VolumeRampView[] {
  const bulk = activeBulk(phases, today)
  if (!bulk) return []
  const { model } = q
  const settings = model.settings
  const gym = resolveGymId(q.gyms, q.lastGymSetting) ?? ''
  const days = activeDays(q.data.programDays)
  const dayName = new Map(days.map((d) => [d.id, d.name]))
  const slots = days.flatMap((d) => model.slotsOf(d.id))
  const resolved = slots.map((slot) => ({
    slot,
    exercise: model.resolveSlotExercise(slot, gym).exercise,
  }))
  const rampSlots: RampSlot[] = resolved.map(({ slot, exercise }) => ({
    slotId: slot.id,
    programDayId: slot.programDayId,
    sets: slot.sets,
    weights: exercise.muscleWeights,
  }))
  const planned = plannedWeeklyVolume(
    slots,
    (slot) => resolved.find((r) => r.slot.id === slot.id)?.exercise,
    q.data.programDays,
  ).byMuscle

  const views: VolumeRampView[] = []
  for (const m of q.muscles) {
    if (!m.lagging || m.archivedAt !== null) continue
    const answered = q.data.suggestions
      .filter((s) => isRamp(s) && s.respondedAt !== null && s.payload.muscleId === m.id)
      .map((s) => localDateOf(s.respondedAt!))
      .sort(compareLocalDate)
      .at(-1)
    const due = rampDueDate({
      phaseStart: bulk.startDate,
      trackedFrom: m.trackedFrom,
      lastAnswered: answered ?? null,
      everyWeeks: settings.rampEveryWeeks,
    })
    if (compareLocalDate(due, today) > 0) continue
    const now = planned.get(m.id) ?? 0
    const bandMax = resolveBand(m, settings).max
    if (now + 1 > bandMax) continue
    const pick = pickRampSlot(m.id, rampSlots, {
      cap: settings.sessionCap,
      maxSets: settings.rampMaxSetsPerExercise,
    })
    if (!pick) continue
    const key = rampKey({ muscleId: m.id, ...pick, dueDate: due })
    if (q.data.suggestions.some((s) => s.key === key && s.respondedAt !== null)) continue
    const target = resolved.find((r) => r.slot.id === pick.slotId)!
    views.push({
      key,
      dueDate: due,
      muscleId: m.id,
      muscleName: m.name,
      slotId: pick.slotId,
      dayName: dayName.get(target.slot.programDayId) ?? '',
      exerciseName: target.exercise.name,
      fromSets: pick.fromSets,
      toSets: pick.fromSets + 1,
      plannedNow: now,
      plannedAfter: now + 1,
      bandMax,
    })
  }
  return views
}

/** Due ramp prompts on `today` (for the Today screen). */
export async function getVolumeRamps(
  ctx: Pick<ServiceCtx, 'db'>,
  { today }: { today: LocalDate },
): Promise<VolumeRampView[]> {
  const [q, phases] = await Promise.all([loadQueryData(ctx), ctx.db.phases.toArray()])
  return volumeRampViews(q, phases, today)
}

async function answer(
  ctx: ServiceCtx,
  input: VolumeRampInput,
  status: 'accepted' | 'dismissed',
): Promise<void> {
  const { db } = ctx
  const key = rampKey(input)
  const now = ctx.now()
  await db.transaction('rw', [db.programSlots, db.suggestions], async () => {
    const existing = await db.suggestions.where('key').equals(key).first()
    if (existing?.respondedAt != null) {
      throw new ServiceError('already_answered', 'That suggestion was already answered.')
    }
    if (status === 'accepted') {
      const slot = await db.programSlots.get(input.slotId)
      if (!slot || slot.archivedAt !== null || slot.sets !== input.fromSets) {
        throw new ServiceError(
          'stale_ramp',
          'The program changed since this was suggested. Check the day and try again.',
        )
      }
      await db.programSlots.update(slot.id, { sets: slot.sets + 1 })
    }
    const row: Suggestion = {
      id: existing?.id ?? ctx.newId(),
      kind: 'volume_ramp',
      key,
      status,
      payload: {
        muscleId: input.muscleId,
        slotId: input.slotId,
        fromSets: input.fromSets,
        dueDate: input.dueDate,
      },
      firstShownAt: existing?.firstShownAt ?? now,
      respondedAt: now,
    }
    await db.suggestions.put(row)
  })
}

/** Add the suggested set to the slot and log the answer (one write). */
export function acceptVolumeRamp(ctx: ServiceCtx, input: VolumeRampInput): Promise<void> {
  return answer(ctx, input, 'accepted')
}

/** Decline this time; the next prompt for the muscle comes `rampEveryWeeks` later. */
export function dismissVolumeRamp(ctx: ServiceCtx, input: VolumeRampInput): Promise<void> {
  return answer(ctx, input, 'dismissed')
}
