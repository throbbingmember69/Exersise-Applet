// Weekly check-ins (findings #32–#34, #36, #48; DECISIONS "Check-ins").
// Check-ins are due every 7 days from the active phase's start and each is evaluated as of its due
// date, from the data as it stood then (a reading dated later never changes it): the weekly trend
// rate against the phase band, the maintenance estimate from the phase's timeline, the miss
// streak and the suggestion, plus any phase-switch prompt (smoothed body fat on the due date, and
// on a cut the main-lift strength slide). Intake coverage and the maintenance estimate cover the
// completed phase week [dueDate − 7, dueDate − 1] (the due date itself is the next week's first,
// usually partly logged, day); weigh-in coverage covers the days feeding the weekly trend rate,
// [dueDate − 6, dueDate].
//
// `syncCheckIns` keeps one row per due week, as of today at the latest. The latest due week is
// 'pending' (the only one that can be answered) and is re-evaluated on every sync because data
// may have changed; the user's answer to its switch prompt is kept only while the prompt stays
// the same. Older weeks that were never answered become 'backfilled' history. Answered and
// backfilled rows are frozen. The miss streak is replayed from the trend every time: earlier
// weeks' directions are recomputed, and it resets after an accepted change, a steps option or a
// manual target change (resetWeekIndex). A skip does not reset it.
//
// `respondCheckIn` re-evaluates the week the same way before answering, so an answer never acts
// on a stale suggestion: accepting (or taking the steps option) is refused with 'stale_checkin'
// when the fresh evaluation differs from what was shown, and the pending row is refreshed.
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
import { trendOn, weeklyRatePct } from '@/domain/trend'
import type {
  CheckIn,
  LocalDate,
  Phase,
  SwitchPrompt,
  SwitchResponse,
  TargetRevision,
} from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { loadTrainingModel } from '../training/model'
import { checkMacrosFit, checkNoLaterTarget } from './phase'
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

type StrengthSlide = (dueDate: LocalDate) => Pick<MainLiftSlide, 'triggered'> | null

export interface SyncResult {
  phaseId: string | null
  /** The actionable check-in after the sync, if any. */
  pending: CheckIn | null
  created: number
  updated: number
}

/**
 * Bring the active phase's check-in rows up to date as of `asOf` (usually today). A date after
 * today is treated as today, so a week is never created before it is due.
 */
export async function syncCheckIns(ctx: ServiceCtx, input: { asOf: string }): Promise<SyncResult> {
  const requested = toLocalDate(input.asOf, 'As-of date')
  const todayDate = today(ctx)
  const asOf = compareLocalDate(requested, todayDate) > 0 ? todayDate : requested
  const model = await loadNutritionModel(ctx)
  const phase = model.activePhase()
  if (!phase) return { phaseId: null, pending: null, created: 0, updated: 0 }
  const weeks = checkinSchedule(phase.startDate, asOf)
  const latest = weeks.at(-1)
  if (!latest) return { phaseId: phase.id, pending: null, created: 0, updated: 0 }

  // The strength slide is only needed on a cut; the training model is loaded outside any write.
  const evaluations = evaluateWeeks(model, phase, weeks, await strengthSlideFor(ctx, phase))

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
        await db.checkIns.update(row.id, { ...refreshed(row, w.evaluation, now), status })
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

/** The main-lift strength slide for a cut (null otherwise). Loads outside any transaction. */
async function strengthSlideFor(ctx: ServiceCtx, phase: Phase): Promise<StrengthSlide> {
  const training = phase.type === 'cut' ? await loadTrainingModel(ctx) : null
  return (d) => training?.mainLiftSlide(d) ?? null
}

function sameEvaluation(row: CheckIn, evaluation: Evaluation): boolean {
  return (Object.keys(evaluation) as (keyof Evaluation)[]).every(
    (k) => JSON.stringify(row[k]) === JSON.stringify(evaluation[k]),
  )
}

/** Same kind, severity and reasons: the user's answer to one still answers the other. */
function samePrompt(a: SwitchPrompt | null, b: SwitchPrompt | null): boolean {
  if (!a || !b) return false
  const reasons = (p: SwitchPrompt) => JSON.stringify([...p.reasons].sort())
  return a.kind === b.kind && a.severity === b.severity && reasons(a) === reasons(b)
}

/** The patch that refreshes a pending row with a new evaluation. */
function refreshed(row: CheckIn, evaluation: Evaluation, now: number): Partial<CheckIn> {
  return {
    ...evaluation,
    evaluatedAt: now,
    switchResponse: samePrompt(row.switchPrompt, evaluation.switchPrompt)
      ? row.switchResponse
      : null,
  }
}

/**
 * Evaluate every due week of a phase, each as of its due date from the data dated on or before
 * it. Pure given the model.
 */
export function evaluateWeeks(
  model: NutritionModel,
  phase: Phase,
  weeks: readonly CheckinWeek[],
  strengthSlide: StrengthSlide,
): WeekEvaluation[] {
  const s = model.settings
  const band = { minPct: phase.rateMinPct, maxPct: phase.rateMaxPct }
  const last = weeks.at(-1)
  // Checkpoints fall on each completed week's last day (the day before its due date).
  const timeline = last ? model.phaseTimeline(phase, addDays(last.dueDate, -1)) : []
  const tdeeByDate = new Map(timeline.map((p) => [p.date, p]))
  const resets = resetPoints(model, phase)
  const lastNonMaintenanceType = model.lastNonMaintenanceTypeBefore(phase)
  const prior: WeekMiss[] = []
  const out: WeekEvaluation[] = []

  for (const week of weeks) {
    const { weekIndex, dueDate } = week
    const trend = model.trendAsOf(dueDate)
    const ratePct = weeklyRatePct(trend, dueDate)
    const lastResetWeekIndex = Math.max(0, ...resets.filter((r) => r <= weekIndex))
    const result = evaluateCheckin(
      { phaseType: phase.type, band, weekIndex, ratePct, priorWeeks: prior, lastResetWeekIndex },
      s,
    )
    prior.push({ weekIndex, direction: ratePct === null ? null : missDirection(ratePct, band) })

    const lastDay = addDays(dueDate, -1)
    const intake = loggingCoverage({
      from: addDays(dueDate, -DAYS_PER_WEEK),
      to: lastDay,
      intake: model.data.nutritionEntries,
      weighInDates: model.weighInDates,
    })
    const weighIns = loggingCoverage({
      from: addDays(dueDate, -(DAYS_PER_WEEK - 1)),
      to: dueDate,
      intake: model.data.nutritionEntries,
      weighInDates: model.weighInDates,
    })
    const tdee = tdeeByDate.get(lastDay)
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
        trendWeightLb: trendOn(trend, dueDate)?.trendLb ?? null,
        trendRatePct: ratePct,
        bandMinPct: band.minPct,
        bandMaxPct: band.maxPct,
        intakeLoggedPct: intake.intakePct,
        weighInLoggedPct: weighIns.weighInPct,
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

/**
 * Answer the pending check-in. The week is re-evaluated first and the answered row keeps that
 * evaluation. accept/custom change the target from tomorrow.
 */
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

  // Re-evaluate the row's week exactly as a sync would.
  const weeks = checkinSchedule(phase.startDate, row.dueDate)
  const fresh = evaluateWeeks(model, phase, weeks, await strengthSlideFor(ctx, phase)).at(-1)
  if (!fresh || fresh.dueDate !== row.dueDate) {
    throw new ServiceError('not_found', 'This check-in is not on the phase schedule', { id })
  }
  const evaluation = fresh.evaluation
  const now = ctx.now()
  const refresh = refreshed(row, evaluation, now)

  const stale = staleness(action, row, evaluation)
  if (stale) {
    await ctx.db.transaction('rw', ctx.db.checkIns, async () => {
      const current = await ctx.db.checkIns.get(row.id)
      if (current?.status === 'pending') await ctx.db.checkIns.update(row.id, refresh)
    })
    throw stale
  }

  let revision: TargetRevision | null = null
  let patch: Partial<CheckIn>
  if (action === 'accept' || action === 'custom') {
    const change =
      action === 'accept' ? evaluation.suggestedKcalChange : customChange(response.kcalChange)
    const effectiveDate = addDays(todayDate, 1)
    checkNoLaterTarget(model, phase, effectiveDate)
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
    patch = { ...refresh, status: 'accepted', appliedKcalChange: change, respondedAt: now }
  } else if (action === 'accept_steps') {
    patch = { ...refresh, status: 'accepted_steps', respondedAt: now }
  } else {
    patch = { ...refresh, status: 'skipped', respondedAt: now }
  }

  const { db } = ctx
  await db.transaction('rw', db.checkIns, db.targetRevisions, async () => {
    const current = await db.checkIns.get(row.id)
    if (!current) throw new ServiceError('not_found', 'Check-in not found', { id })
    requirePending(current)
    if (revision) await db.targetRevisions.add(revision)
    await db.checkIns.update(row.id, patch)
  })
  return { status: patch.status ?? row.status, revisionId: revision?.id ?? null }
}

/**
 * Why an accept (or steps) answer can't go ahead: nothing to accept, or the fresh evaluation no
 * longer matches what the row showed ('stale_checkin', after which the row is refreshed). Null
 * when the answer can proceed; skip and custom amounts always can.
 */
function staleness(action: CheckInAction, shown: CheckIn, fresh: Evaluation): ServiceError | null {
  const stale = () =>
    new ServiceError(
      'stale_checkin',
      'This check-in changed since it was shown; review the updated suggestion',
      {
        suggestionType: fresh.suggestionType,
        suggestedKcalChange: fresh.suggestedKcalChange,
        stepsAlternative: fresh.stepsAlternative,
      },
    )
  if (action === 'accept') {
    const freshChange = suggestedChange(fresh)
    const shownChange = suggestedChange(shown)
    if (freshChange === null && shownChange === null) {
      return new ServiceError('no_suggestion', 'This check-in suggests no calorie change')
    }
    return freshChange === shownChange ? null : stale()
  }
  if (action === 'accept_steps') {
    if (fresh.stepsAlternative === null && shown.stepsAlternative === null) {
      return new ServiceError('no_steps_alternative', 'This check-in has no steps option')
    }
    return fresh.stepsAlternative === shown.stepsAlternative ? null : stale()
  }
  return null
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

/** The suggested kcal change, or null when none is suggested. */
function suggestedChange(e: Pick<Evaluation, 'suggestionType' | 'suggestedKcalChange'>) {
  return e.suggestionType === 'kcal_change' && e.suggestedKcalChange !== 0
    ? e.suggestedKcalChange
    : null
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
