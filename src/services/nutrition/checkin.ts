// Weekly check-ins (findings #32–#34, #36, #48; DECISIONS "Check-ins").
// Check-ins are due every 7 days from the active phase's start and each is evaluated as of its due
// date: the weekly trend rate against the phase band, logging coverage for the 7 days ending on
// the due date, the maintenance estimate from the phase's timeline, the miss streak and the
// suggestion, plus any phase-switch prompt (smoothed body fat on the due date, and on a cut the
// main-lift strength slide).
//
// `syncCheckIns` keeps one row per due week. The latest due week is 'pending' (the only one that
// can be answered) and is re-evaluated on every sync because data may have changed. Older weeks
// that were never answered become 'backfilled' history. Answered and backfilled rows are frozen.
// The miss streak is replayed from the trend every time: earlier weeks' directions are
// recomputed, and it resets after an accepted change, a steps option or a manual target change
// (resetWeekIndex). A skip does not reset it.
import {
  checkinSchedule,
  evaluateCheckin,
  missDirection,
  resetWeekIndex,
  type CheckinWeek,
  type WeekMiss,
} from '@/domain/checkin'
import { addDays, compareLocalDate } from '@/domain/dates'
import { applyKcalChange } from '@/domain/nutritionTargets'
import { phaseSwitchPrompt } from '@/domain/phaseSwitch'
import type { MainLiftSlide } from '@/domain/strength'
import { loggingCoverage } from '@/domain/tdee'
import { weeklyRatePct } from '@/domain/trend'
import type { CheckIn, LocalDate, Phase, SwitchResponse, TargetRevision } from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { loadTrainingModel } from '../training/model'
import { checkMacrosFit } from './phase'
import { loadNutritionModel, toLocalDate, type NutritionModel } from './queries'

const DAYS_PER_WEEK = 7

/** The fields a (re-)evaluation produces; the rest of a row is identity and the user's answer. */
type Evaluation = Pick<
  CheckIn,
  | 'trendWeightLb'
  | 'trendRatePct'
  | 'bandMinPct'
  | 'bandMaxPct'
  | 'intakeLoggedPct'
  | 'weighInLoggedPct'
  | 'tdeeEstimate'
  | 'tdeeSource'
  | 'tdeeCapped'
  | 'missDirection'
  | 'missStreak'
  | 'suggestionType'
  | 'suggestedKcalChange'
  | 'stepsAlternative'
  | 'switchPrompt'
>

interface WeekEvaluation extends CheckinWeek {
  evaluation: Evaluation
}

export interface SyncResult {
  phaseId: string | null
  /** The actionable check-in after the sync, if any. */
  pending: CheckIn | null
  created: number
  updated: number
}

/** Bring the active phase's check-in rows up to date as of `asOf` (usually today). */
export async function syncCheckIns(ctx: ServiceCtx, input: { asOf: string }): Promise<SyncResult> {
  const asOf = toLocalDate(input.asOf, 'As-of date')
  const model = await loadNutritionModel(ctx)
  const phase = model.activePhase()
  if (!phase) return { phaseId: null, pending: null, created: 0, updated: 0 }
  const weeks = checkinSchedule(phase.startDate, asOf)
  const latest = weeks.at(-1)
  if (!latest) return { phaseId: phase.id, pending: null, created: 0, updated: 0 }

  // The strength slide is only needed on a cut; the training model is loaded outside any write.
  const training = phase.type === 'cut' ? await loadTrainingModel(ctx) : null
  const evaluations = evaluateWeeks(model, phase, weeks, (d) => training?.mainLiftSlide(d) ?? null)

  const { db } = ctx
  const now = ctx.now()
  return db.transaction('rw', db.checkIns, async () => {
    const rows = await db.checkIns.where('phaseId').equals(phase.id).toArray()
    const byDue = new Map(rows.map((r) => [r.dueDate, r]))
    const lastRowDue = rows
      .map((r) => r.dueDate)
      .sort(compareLocalDate)
      .at(-1)
    const newestDue =
      lastRowDue && compareLocalDate(lastRowDue, latest.dueDate) > 0 ? lastRowDue : latest.dueDate
    let created = 0
    let updated = 0
    for (const w of evaluations) {
      const row = byDue.get(w.dueDate)
      const isLatest = w.dueDate === newestDue
      if (!row) {
        await db.checkIns.add({
          id: ctx.newId(),
          phaseId: phase.id,
          dueDate: w.dueDate,
          phaseWeekIndex: w.weekIndex,
          status: isLatest ? 'pending' : 'backfilled',
          evaluatedAt: now,
          ...w.evaluation,
          appliedKcalChange: null,
          switchResponse: null,
          respondedAt: null,
        })
        created++
      } else if (row.status === 'pending') {
        const status = isLatest ? 'pending' : 'backfilled'
        if (status === 'pending' && sameEvaluation(row, w.evaluation)) continue
        await db.checkIns.update(row.id, {
          ...w.evaluation,
          status,
          evaluatedAt: now,
          switchResponse: w.evaluation.switchPrompt ? row.switchResponse : null,
        })
        updated++
      }
    }
    const pending =
      (await db.checkIns.where('phaseId').equals(phase.id).toArray())
        .filter((r) => r.status === 'pending')
        .sort((a, b) => compareLocalDate(a.dueDate, b.dueDate))
        .at(-1) ?? null
    return { phaseId: phase.id, pending, created, updated }
  })
}

function sameEvaluation(row: CheckIn, evaluation: Evaluation): boolean {
  return (Object.keys(evaluation) as (keyof Evaluation)[]).every(
    (k) => JSON.stringify(row[k]) === JSON.stringify(evaluation[k]),
  )
}

/** Evaluate every due week of a phase, each as of its due date. Pure given the model. */
export function evaluateWeeks(
  model: NutritionModel,
  phase: Phase,
  weeks: readonly CheckinWeek[],
  strengthSlide: (dueDate: LocalDate) => Pick<MainLiftSlide, 'triggered'> | null,
): WeekEvaluation[] {
  const s = model.settings
  const band = { minPct: phase.rateMinPct, maxPct: phase.rateMaxPct }
  const last = weeks.at(-1)
  const timeline = last ? model.phaseTimeline(phase, last.dueDate) : []
  const tdeeByDate = new Map(timeline.map((p) => [p.date, p]))
  const resets = resetPoints(model, phase)
  const lastNonMaintenanceType = model.lastNonMaintenanceTypeBefore(phase)
  const prior: WeekMiss[] = []
  const out: WeekEvaluation[] = []

  for (const week of weeks) {
    const { weekIndex, dueDate } = week
    const ratePct = weeklyRatePct(model.trend, dueDate)
    const lastResetWeekIndex = Math.max(0, ...resets.filter((r) => r <= weekIndex))
    const result = evaluateCheckin(
      { phaseType: phase.type, band, weekIndex, ratePct, priorWeeks: prior, lastResetWeekIndex },
      s,
    )
    prior.push({ weekIndex, direction: ratePct === null ? null : missDirection(ratePct, band) })

    const coverage = loggingCoverage({
      from: addDays(dueDate, -(DAYS_PER_WEEK - 1)),
      to: dueDate,
      intake: model.data.nutritionEntries,
      weighInDates: model.weighInDates,
    })
    const tdee = tdeeByDate.get(dueDate)
    const switchPrompt = phaseSwitchPrompt(
      {
        phase,
        weekIndex,
        smoothedBf: model.bodyFatOn(dueDate),
        strength: phase.type === 'cut' ? strengthSlide(dueDate) : null,
        lastNonMaintenanceType,
      },
      s,
    )
    out.push({
      weekIndex,
      dueDate,
      evaluation: {
        trendWeightLb: model.trendOn(dueDate)?.trendLb ?? null,
        trendRatePct: ratePct,
        bandMinPct: band.minPct,
        bandMaxPct: band.maxPct,
        intakeLoggedPct: coverage.intakePct,
        weighInLoggedPct: coverage.weighInPct,
        tdeeEstimate: tdee?.kcal ?? null,
        tdeeSource: tdee?.source ?? 'insufficient_data',
        tdeeCapped: tdee?.capped ?? false,
        missDirection: result.missDirection,
        missStreak: result.missStreak,
        suggestionType: result.suggestionType,
        suggestedKcalChange: result.suggestedKcalChange,
        stepsAlternative: result.stepsAlternative,
        switchPrompt,
      },
    })
  }
  return out
}

/**
 * Week indices after which the miss streak restarts: accepted check-in changes and manual target
 * changes (by effective date), and weeks answered with the steps option.
 */
function resetPoints(model: NutritionModel, phase: Phase): number[] {
  const fromRevisions = model
    .revisionsOf(phase.id)
    .filter((r) => r.source === 'checkin' || r.source === 'manual')
    .map((r) => resetWeekIndex(phase.startDate, r.effectiveDate))
  const fromSteps = model
    .checkInsOf(phase.id)
    .filter((c) => c.status === 'accepted_steps')
    .map((c) => c.phaseWeekIndex)
  return [...fromRevisions, ...fromSteps]
}

export type CheckInAction = 'accept' | 'accept_steps' | 'skip' | 'custom'

export interface CheckInResponse {
  action: CheckInAction
  /** Signed kcal/day change for 'custom'. */
  kcalChange?: number
}

export interface CheckInResponseResult {
  status: CheckIn['status']
  /** The target revision written by accept/custom (effective tomorrow), else null. */
  revisionId: string | null
}

const ACTIONS: readonly CheckInAction[] = ['accept', 'accept_steps', 'skip', 'custom']
/** Sanity bound for a custom change (a typo guard, not an engine value). */
const MAX_CUSTOM_CHANGE_KCAL = 2000

/** Answer the pending check-in. accept/custom change the target from tomorrow. */
export async function respondCheckIn(
  ctx: ServiceCtx,
  id: string,
  response: CheckInResponse,
): Promise<CheckInResponseResult> {
  const action = response.action
  if (!ACTIONS.includes(action)) {
    throw new ServiceError('invalid_action', 'Unknown check-in action', { action })
  }
  const model = await loadNutritionModel(ctx)
  const row = model.data.checkIns.find((c) => c.id === id)
  if (!row) throw new ServiceError('not_found', 'Check-in not found', { id })
  requirePending(row)
  const phase = model.activePhase()
  if (!phase || phase.id !== row.phaseId) {
    throw new ServiceError('phase_ended', 'This check-in belongs to a phase that has ended')
  }
  const todayDate = today(ctx)
  if (compareLocalDate(addDays(row.dueDate, DAYS_PER_WEEK), todayDate) <= 0) {
    throw new ServiceError(
      'checkin_outdated',
      'A newer check-in is due; refresh check-ins before answering',
    )
  }

  const now = ctx.now()
  let revision: TargetRevision | null = null
  let patch: Partial<CheckIn>
  if (action === 'accept' || action === 'custom') {
    const change = action === 'accept' ? suggestedChange(row) : customChange(response.kcalChange)
    const effectiveDate = addDays(todayDate, 1)
    const base = model.targetOn(phase, effectiveDate)
    if (!base) throw new ServiceError('no_target', 'The active phase has no target to change')
    const next = applyKcalChange(base, change)
    if (!(next.kcal > 0)) {
      throw new ServiceError('invalid_kcalChange', 'The change would leave no calories', {
        change,
      })
    }
    checkMacrosFit(next.kcal, next.proteinG, next.fatPct)
    revision = {
      id: ctx.newId(),
      phaseId: phase.id,
      effectiveDate,
      kcal: next.kcal,
      proteinG: base.proteinG,
      fatPct: base.fatPct,
      source: 'checkin',
      checkInId: row.id,
      note: '',
      createdAt: now,
    }
    patch = { status: 'accepted', appliedKcalChange: change, respondedAt: now }
  } else if (action === 'accept_steps') {
    if (row.stepsAlternative === null) {
      throw new ServiceError('no_steps_alternative', 'This check-in has no steps option')
    }
    patch = { status: 'accepted_steps', respondedAt: now }
  } else {
    patch = { status: 'skipped', respondedAt: now }
  }

  const { db } = ctx
  await db.transaction('rw', db.checkIns, db.targetRevisions, async () => {
    const fresh = await db.checkIns.get(row.id)
    if (!fresh) throw new ServiceError('not_found', 'Check-in not found', { id })
    requirePending(fresh)
    if (revision) await db.targetRevisions.add(revision)
    await db.checkIns.update(row.id, patch)
  })
  return { status: patch.status ?? row.status, revisionId: revision?.id ?? null }
}

function requirePending(row: CheckIn): void {
  if (row.status === 'pending') return
  throw new ServiceError(
    'not_pending',
    row.status === 'backfilled'
      ? 'This check-in is history and can no longer be answered'
      : 'This check-in was already answered',
    { status: row.status },
  )
}

function suggestedChange(row: CheckIn): number {
  if (row.suggestionType !== 'kcal_change' || row.suggestedKcalChange === 0) {
    throw new ServiceError('no_suggestion', 'This check-in suggests no calorie change')
  }
  return row.suggestedKcalChange
}

function customChange(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value === 0 ||
    Math.abs(value) > MAX_CUSTOM_CHANGE_KCAL
  ) {
    throw new ServiceError(
      'invalid_kcalChange',
      `Enter a calorie change between −${MAX_CUSTOM_CHANGE_KCAL} and +${MAX_CUSTOM_CHANGE_KCAL} (not 0)`,
      { value },
    )
  }
  return value
}

const SWITCH_RESPONSES: readonly SwitchResponse[] = ['plan_next', 'dismissed']

/** Answer a check-in's phase-switch prompt (once). 'plan_next' leads to the phase wizard. */
export async function respondSwitchPrompt(
  ctx: ServiceCtx,
  id: string,
  response: SwitchResponse,
): Promise<void> {
  if (!SWITCH_RESPONSES.includes(response)) {
    throw new ServiceError('invalid_response', 'Unknown prompt response', { response })
  }
  const { db } = ctx
  await db.transaction('rw', db.checkIns, async () => {
    const row = await db.checkIns.get(id)
    if (!row) throw new ServiceError('not_found', 'Check-in not found', { id })
    if (!row.switchPrompt) {
      throw new ServiceError('no_prompt', 'This check-in has no phase-switch prompt')
    }
    if (row.switchResponse !== null) {
      throw new ServiceError('already_responded', 'This prompt was already answered')
    }
    await db.checkIns.update(id, { switchResponse: response })
  })
}
