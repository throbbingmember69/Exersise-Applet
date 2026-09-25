// Phase and target commands (findings #5, #26–#28, #36; DECISIONS "Nutrition").
// A phase's starting targets are always proposed for the user to confirm or edit: maintenance is
// the last valid measured estimate, else the formula on trend weight (the seed baseline before any
// weigh-in), smoothed body fat and age on the start date. Starting a phase ends the active one the
// day before and writes the Phase plus its 'phase_start' TargetRevision in one transaction.
// Targets only change through appended TargetRevisions: check-ins (checkin.ts) and manual edits
// here. A manual edit also resets the check-in miss streak (G13).
import type { SmoothedBodyFat } from '@/domain/bodycomp'
import { addDays, ageOn, compareLocalDate } from '@/domain/dates'
import {
  bandMidpoint,
  macroSplit,
  proposePhaseTargets,
  type PhaseProposal,
} from '@/domain/nutritionTargets'
import { formulaTdee, phaseStartMaintenance } from '@/domain/tdee'
import type { LocalDate, MaintenanceSource, Phase, PhaseType, TargetRevision } from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { loadNutritionModel, toLocalDate, type NutritionModel } from './queries'

const PHASE_TYPES: readonly PhaseType[] = ['bulk', 'maintenance', 'cut']
const DEFAULT_END_REASON = 'next_phase'

/** Sanity bounds for user-entered targets (typo guards, not tunable engine values). */
const LIMITS = {
  kcal: { min: 500, max: 10000 },
  proteinG: { min: 0, max: 1000 },
  fatPct: { min: 0, max: 100 },
  ratePct: { min: -5, max: 5 },
  weeks: { min: 1, max: 104 },
  bfPct: { min: 2, max: 70 },
} as const

export interface ProposePhaseInput {
  type: PhaseType
  startDate: string
}

export interface PhaseProposalView {
  proposal: PhaseProposal
  maintenance: { kcal: number; source: MaintenanceSource }
  startDate: LocalDate
  /** Trend weight on the start date (the seed baseline before any real weigh-in). */
  trendLb: number
  weightSource: 'trend' | 'seed'
  bodyFat: SmoothedBodyFat | null
  leanLb: number | null
  age: number
  /** The phase this one follows (the active one, which starting this one ends). */
  previousPhase: Phase | null
  /** What the flowchart suggests after `previousPhase` (a lean bulk when there is none). */
  suggestedType: PhaseType
}

/** Proposed starting targets for a phase starting on `startDate`, to confirm or edit. */
export async function proposePhase(
  ctx: Pick<ServiceCtx, 'db'>,
  input: ProposePhaseInput,
): Promise<PhaseProposalView> {
  const type = checkType(input.type)
  const startDate = toLocalDate(input.startDate, 'Start date')
  return proposeFrom(await loadNutritionModel(ctx), type, startDate)
}

function proposeFrom(
  model: NutritionModel,
  type: PhaseType,
  startDate: LocalDate,
): PhaseProposalView {
  const s = model.settings
  const profile = model.profile
  if (!profile) throw new ServiceError('no_profile', 'Set up your profile first')
  const weight = model.weightOn(startDate)
  if (!weight) {
    throw new ServiceError('no_bodyweight', 'Log a weigh-in first so targets can be calculated')
  }
  const bodyFat = model.bodyFatOn(startDate)
  const age = ageOn(profile, startDate)
  const formula = formulaTdee(
    {
      trendLb: weight.weightLb,
      bodyFatPct: bodyFat?.pct ?? null,
      heightIn: profile.heightIn,
      age,
      sex: profile.sex,
    },
    s,
  )
  const maintenance = phaseStartMaintenance(model.maintenanceEstimateOn(startDate), formula.kcal)
  const proposal = proposePhaseTargets(
    {
      type,
      maintenanceKcal: maintenance.kcal,
      maintenanceSource: maintenance.source,
      trendLb: weight.weightLb,
      bodyFatPct: bodyFat?.pct ?? null,
      bfQuality: bodyFat?.quality ?? 'none',
    },
    s,
  )
  const previousPhase = model.phaseBefore(startDate)
  return {
    proposal,
    maintenance,
    startDate,
    trendLb: weight.weightLb,
    weightSource: weight.source,
    bodyFat,
    leanLb: proposal.leanLb,
    age,
    previousPhase,
    suggestedType: model.suggestedNextType(previousPhase),
  }
}

export interface StartPhaseInput {
  type: PhaseType
  startDate: string
  /** Confirmed daily targets (the proposal's, possibly edited). */
  kcal: number
  proteinG: number
  fatPct: number
  /** Rate band in %BW/week (either order; stored min < max). Defaults to the settings band. */
  rateMinPct?: number
  rateMaxPct?: number
  /** Defaults to the band midpoint. */
  targetRatePct?: number
  plannedWeeks?: number
  maxWeeks?: number
  /** Bulk ceiling / cut target; defaults from settings (null for types that don't use them). */
  bfCeilingPct?: number | null
  bfTargetPct?: number | null
  /** Why the active phase ends (stored on it). */
  endReason?: string
  /**
   * The proposal the user confirmed (from proposePhase): its maintenance, weight, body-fat and
   * protein context is stored with the phase. Recomputed when omitted.
   */
  proposal?: PhaseProposal
}

/** Start a phase: ends the active one the day before, writes the Phase and its first target. */
export async function startPhase(ctx: ServiceCtx, input: StartPhaseInput): Promise<string> {
  const type = checkType(input.type)
  const startDate = toLocalDate(input.startDate, 'Start date')
  const kcal = checkNumber('kcal', input.kcal, LIMITS.kcal, 'Calories')
  const proteinG = checkNumber('proteinG', input.proteinG, LIMITS.proteinG, 'Protein (g)')
  const fatPct = checkNumber('fatPct', input.fatPct, LIMITS.fatPct, 'Fat %')
  checkMacrosFit(kcal, proteinG, fatPct)

  const model = await loadNutritionModel(ctx)
  for (const p of model.phases) {
    const last = p.endDate ?? p.startDate
    if (compareLocalDate(startDate, last) <= 0) {
      throw new ServiceError('phase_overlap', `A new phase must start after ${last}`, {
        phaseId: p.id,
      })
    }
  }
  const proposal =
    input.proposal?.type === type ? input.proposal : proposeFrom(model, type, startDate).proposal

  const a = optionalNumber('rateMinPct', input.rateMinPct, LIMITS.ratePct, 'Rate band')
  const b = optionalNumber('rateMaxPct', input.rateMaxPct, LIMITS.ratePct, 'Rate band')
  const lo = a ?? proposal.band.minPct
  const hi = b ?? proposal.band.maxPct
  const band = { minPct: Math.min(lo, hi), maxPct: Math.max(lo, hi) }
  const targetRatePct =
    optionalNumber('targetRatePct', input.targetRatePct, LIMITS.ratePct, 'Target rate') ??
    bandMidpoint(band)
  const plannedWeeks = checkWeeks('plannedWeeks', input.plannedWeeks ?? proposal.plannedWeeks)
  const maxWeeks = checkWeeks('maxWeeks', input.maxWeeks ?? proposal.maxWeeks)
  if (plannedWeeks > maxWeeks) {
    throw new ServiceError('invalid_length', 'Planned weeks cannot exceed the maximum weeks')
  }
  const bfCeilingPct = optionalBf(
    'bfCeilingPct',
    input.bfCeilingPct === undefined ? proposal.bfCeilingPct : input.bfCeilingPct,
  )
  const bfTargetPct = optionalBf(
    'bfTargetPct',
    input.bfTargetPct === undefined ? proposal.bfTargetPct : input.bfTargetPct,
  )

  const now = ctx.now()
  const active = model.activePhase()
  const phase: Phase = {
    id: ctx.newId(),
    type,
    startDate,
    endDate: null,
    status: 'active',
    prevPhaseId: model.phases.at(-1)?.id ?? null,
    parentPhaseId: null,
    rateMinPct: band.minPct,
    rateMaxPct: band.maxPct,
    targetRatePct,
    maintenanceKcalAtStart: proposal.maintenanceKcal,
    maintenanceSource: proposal.maintenanceSource,
    trendWeightLbAtStart: proposal.trendLb,
    bodyFatPctAtStart: proposal.bodyFatPct,
    bfQuality: proposal.bfQuality,
    leanMassLbAtStart: proposal.leanLb,
    proteinBasis: proposal.proteinBasis,
    proteinGPerKg: proposal.proteinGPerKg,
    fatPct,
    bfCeilingPct,
    bfTargetPct,
    plannedWeeks,
    maxWeeks,
    endReason: null,
    createdAt: now,
  }
  const revision: TargetRevision = {
    id: ctx.newId(),
    phaseId: phase.id,
    effectiveDate: startDate,
    kcal,
    proteinG,
    fatPct,
    source: 'phase_start',
    checkInId: null,
    note: '',
    createdAt: now,
  }
  const { db } = ctx
  await db.transaction('rw', db.phases, db.targetRevisions, db.checkIns, async () => {
    if (active) {
      await closePhase(ctx, active, addDays(startDate, -1), input.endReason ?? DEFAULT_END_REASON)
    }
    await db.phases.add(phase)
    await db.targetRevisions.add(revision)
  })
  return phase.id
}

export interface EndPhaseInput {
  /** Last day of the phase. */
  date: string
  reason: string
}

/** End the active phase on `date` (inclusive). Its unanswered check-in becomes history. */
export async function endPhase(ctx: ServiceCtx, input: EndPhaseInput): Promise<void> {
  const date = toLocalDate(input.date, 'End date')
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason === '') throw new ServiceError('invalid_reason', 'Give a reason for ending the phase')
  const active = (await loadNutritionModel(ctx)).activePhase()
  if (!active) throw new ServiceError('no_active_phase', 'There is no active phase to end')
  if (compareLocalDate(date, active.startDate) < 0) {
    throw new ServiceError(
      'end_before_start',
      `The phase started on ${active.startDate}; it can't end before that`,
    )
  }
  const { db } = ctx
  await db.transaction('rw', db.phases, db.checkIns, async () => {
    await closePhase(ctx, active, date, reason)
  })
}

/** Inside a transaction: end a phase and turn its pending check-ins into history. */
async function closePhase(
  ctx: ServiceCtx,
  phase: Phase,
  endDate: LocalDate,
  endReason: string,
): Promise<void> {
  const { db } = ctx
  await db.phases.update(phase.id, { endDate, status: 'ended', endReason })
  await db.checkIns
    .where('phaseId')
    .equals(phase.id)
    .filter((c) => c.status === 'pending')
    .modify({ status: 'backfilled' })
}

export interface ManualTargetInput {
  /** First day the new target applies (today or later, within the active phase). */
  effectiveDate: string
  /** Omitted fields keep the target in effect on that date. */
  kcal?: number
  proteinG?: number
  fatPct?: number
  note?: string
}

/** Append a 'manual' target revision to the active phase. Returns its id. */
export async function setManualTarget(ctx: ServiceCtx, input: ManualTargetInput): Promise<string> {
  const effectiveDate = toLocalDate(input.effectiveDate, 'Effective date')
  const kcal = optionalNumber('kcal', input.kcal, LIMITS.kcal, 'Calories')
  const proteinG = optionalNumber('proteinG', input.proteinG, LIMITS.proteinG, 'Protein (g)')
  const fatPct = optionalNumber('fatPct', input.fatPct, LIMITS.fatPct, 'Fat %')
  if (kcal === null && proteinG === null && fatPct === null) {
    throw new ServiceError('empty_patch', 'Change at least one target')
  }
  if (compareLocalDate(effectiveDate, today(ctx)) < 0) {
    throw new ServiceError(
      'effective_in_past',
      'A target change can start today at the earliest; past targets are history',
    )
  }
  const model = await loadNutritionModel(ctx)
  const phase = model.activePhase()
  if (!phase) throw new ServiceError('no_active_phase', 'Start a phase before setting targets')
  if (compareLocalDate(effectiveDate, phase.startDate) < 0) {
    throw new ServiceError(
      'before_phase_start',
      `The active phase starts on ${phase.startDate}; the change can't start before that`,
    )
  }
  const base = model.targetOn(phase, effectiveDate)
  if (!base) throw new ServiceError('no_target', 'The active phase has no target to change')
  const next = {
    kcal: kcal ?? base.kcal,
    proteinG: proteinG ?? base.proteinG,
    fatPct: fatPct ?? base.fatPct,
  }
  checkMacrosFit(next.kcal, next.proteinG, next.fatPct)
  const revision: TargetRevision = {
    id: ctx.newId(),
    phaseId: phase.id,
    effectiveDate,
    ...next,
    source: 'manual',
    checkInId: null,
    note: typeof input.note === 'string' ? input.note.trim() : '',
    createdAt: ctx.now(),
  }
  await ctx.db.transaction('rw', ctx.db.targetRevisions, async () => {
    await ctx.db.targetRevisions.add(revision)
  })
  return revision.id
}

// ── Validation ──────────────────────────────────────────────────────────────

function checkType(type: unknown): PhaseType {
  if (!PHASE_TYPES.includes(type as PhaseType)) {
    throw new ServiceError('invalid_type', 'Phase type must be bulk, maintenance or cut', { type })
  }
  return type as PhaseType
}

function checkNumber(
  key: string,
  value: unknown,
  range: { min: number; max: number },
  label: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < range.min ||
    value > range.max
  ) {
    throw new ServiceError(
      `invalid_${key}`,
      `${label} must be between ${range.min} and ${range.max}`,
      {
        value,
      },
    )
  }
  return value
}

function optionalNumber(
  key: string,
  value: unknown,
  range: { min: number; max: number },
  label: string,
): number | null {
  return value === undefined || value === null ? null : checkNumber(key, value, range, label)
}

function checkWeeks(key: string, value: unknown): number {
  const n = checkNumber(key, value, LIMITS.weeks, 'Phase length (weeks)')
  if (!Number.isInteger(n)) {
    throw new ServiceError(`invalid_${key}`, 'Phase length must be a whole number of weeks')
  }
  return n
}

function optionalBf(key: string, value: number | null): number | null {
  return value === null ? null : checkNumber(key, value, LIMITS.bfPct, 'Body-fat threshold %')
}

/** Protein and fat must leave room for non-negative carbs. */
export function checkMacrosFit(kcal: number, proteinG: number, fatPct: number): void {
  if (macroSplit(kcal, proteinG, fatPct).carbsG < 0) {
    throw new ServiceError(
      'macros_exceed_kcal',
      'Protein and fat add up to more than the calorie target',
      { kcal, proteinG, fatPct },
    )
  }
}
