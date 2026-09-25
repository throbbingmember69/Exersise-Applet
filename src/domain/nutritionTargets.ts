// Nutrition targets (findings #26–#28, #43; DECISIONS "Nutrition").
// A phase's kcal = maintenance + the rate-band midpoint turned into a daily offset
// (rate% × trend weight × kcalPerLb / 7), rounded to kcalRoundTo when proposed. Protein is
// g/kg bodyweight on a bulk or maintenance and g/kg lean mass on a cut (bodyweight fallback
// without body fat), rounded to proteinRoundTo. Fat is fatPct of kcal and carbs fill the rest.
// Targets are always proposed for the user to confirm. The active target on a date is the
// latest TargetRevision effective on or before it; a kcal change keeps protein grams fixed.
import { leanMassLb } from '@/domain/bodycomp'
import { compareLocalDate } from '@/domain/dates'
import { roundToStep } from '@/domain/rounding'
import type {
  BodyFatQuality,
  LocalDate,
  MaintenanceSource,
  PhaseType,
  ProteinBasis,
  Settings,
  TargetRevision,
} from '@/domain/types'
import { lbToKg } from '@/domain/units'

const DAYS_PER_WEEK = 7
const KCAL_PER_G_PROTEIN = 4
const KCAL_PER_G_CARB = 4
const KCAL_PER_G_FAT = 9

/** Weekly trend-rate band in %BW/week, with minPct ≤ maxPct numerically (cut: −0.75, −0.5). */
export interface RateBand {
  minPct: number
  maxPct: number
}

export interface Macros {
  kcal: number
  proteinG: number
  fatPct: number
  fatG: number
  carbsG: number
}

export interface ProteinRule {
  basis: ProteinBasis
  gPerKg: number
}

export type ProposalWarning = 'surplus_high' | 'carbs_negative'

export interface PhaseTargetInput {
  type: PhaseType
  /** Unrounded maintenance kcal/day. */
  maintenanceKcal: number
  maintenanceSource: MaintenanceSource
  trendLb: number
  bodyFatPct: number | null
  bfQuality: BodyFatQuality
  /** Overrides the settings band (phase setup lets the user pick one). */
  band?: RateBand
  /** Overrides the band midpoint. */
  targetRatePct?: number
}

export interface PhaseProposal extends Macros {
  type: PhaseType
  maintenanceKcal: number
  maintenanceSource: MaintenanceSource
  trendLb: number
  bodyFatPct: number | null
  bfQuality: BodyFatQuality
  leanLb: number | null
  band: RateBand
  targetRatePct: number
  /** Unrounded kcal offset from the target rate. */
  kcalOffset: number
  /** (kcal − maintenance) / maintenance × 100; negative on a cut. */
  impliedSurplusPct: number
  proteinBasis: ProteinBasis
  proteinGPerKg: number
  plannedWeeks: number
  maxWeeks: number
  bfCeilingPct: number | null
  bfTargetPct: number | null
  warnings: ProposalWarning[]
}

/** The settings band for a phase type, ordered so minPct ≤ maxPct. */
export function rateBand(type: PhaseType, s: Settings): RateBand {
  const [a, b] =
    type === 'bulk'
      ? [s.bulkRateMinPct, s.bulkRateMaxPct]
      : type === 'cut'
        ? [s.cutRateMinPct, s.cutRateMaxPct]
        : [s.maintRateMinPct, s.maintRateMaxPct]
  return { minPct: Math.min(a, b), maxPct: Math.max(a, b) }
}

/** Midpoint of a band (bulk 0.375, cut −0.625, maintenance 0 by default). */
export function bandMidpoint(band: RateBand): number {
  return (band.minPct + band.maxPct) / 2
}

/** Daily kcal offset for a weekly rate: pct/100 × trend weight × kcalPerLb / 7. */
export function kcalOffset(ratePct: number, trendLb: number, s: Settings): number {
  return ((ratePct / 100) * trendLb * s.kcalPerLb) / DAYS_PER_WEEK
}

/** Which mass protein is based on, and its multiplier, for a phase type. */
export function proteinRule(type: PhaseType, leanLb: number | null, s: Settings): ProteinRule {
  if (type === 'bulk') return { basis: 'bodyweight', gPerKg: s.bulkProteinGPerKgBw }
  if (type === 'maintenance') return { basis: 'bodyweight', gPerKg: s.maintProteinGPerKgBw }
  if (leanLb === null) return { basis: 'bodyweight_fallback', gPerKg: s.cutProteinFallbackGPerKgBw }
  return { basis: 'leanMass', gPerKg: s.cutProteinGPerKgLbm }
}

/** Daily protein grams for a phase type, rounded to proteinRoundTo. */
export function proteinG(
  type: PhaseType,
  mass: { trendLb: number; leanLb: number | null },
  s: Settings,
): number {
  const rule = proteinRule(type, mass.leanLb, s)
  const massLb = rule.basis === 'leanMass' && mass.leanLb !== null ? mass.leanLb : mass.trendLb
  return roundToStep(rule.gPerKg * lbToKg(massLb), s.proteinRoundTo)
}

/** Fat = kcal × fatPct / 100 / 9; carbs = (kcal − 4P − 9F) / 4. Unrounded. */
export function macroSplit(
  kcal: number,
  protein: number,
  fatPct: number,
): { fatG: number; carbsG: number } {
  const fatG = (kcal * fatPct) / 100 / KCAL_PER_G_FAT
  const carbsG = (kcal - KCAL_PER_G_PROTEIN * protein - KCAL_PER_G_FAT * fatG) / KCAL_PER_G_CARB
  return { fatG, carbsG }
}

/** Full macros for a stored target (kcal, protein, fat share). */
export function targetMacros(target: Pick<TargetRevision, 'kcal' | 'proteinG' | 'fatPct'>): Macros {
  const { kcal, proteinG: protein, fatPct } = target
  return { kcal, proteinG: protein, fatPct, ...macroSplit(kcal, protein, fatPct) }
}

/** A kcal change keeps protein grams fixed; fat stays fatPct of the new kcal; carbs fill the rest. */
export function applyKcalChange(
  target: Pick<TargetRevision, 'kcal' | 'proteinG' | 'fatPct'>,
  deltaKcal: number,
): Macros {
  return targetMacros({ ...target, kcal: target.kcal + deltaKcal })
}

/** The latest revision effective on or before `date` (ties: latest createdAt, then last given). */
export function activeTargetOn(
  revisions: readonly TargetRevision[],
  date: LocalDate,
): TargetRevision | null {
  let best: TargetRevision | null = null
  for (const r of revisions) {
    if (compareLocalDate(r.effectiveDate, date) > 0) continue
    if (
      !best ||
      compareLocalDate(r.effectiveDate, best.effectiveDate) > 0 ||
      (r.effectiveDate === best.effectiveDate && r.createdAt >= best.createdAt)
    ) {
      best = r
    }
  }
  return best
}

function warningsFor(m: Macros, maintenanceKcal: number, s: Settings): ProposalWarning[] {
  const warnings: ProposalWarning[] = []
  if (surplusPct(m.kcal, maintenanceKcal) > s.surplusWarnPct) warnings.push('surplus_high')
  if (m.carbsG < 0) warnings.push('carbs_negative')
  return warnings
}

function surplusPct(kcal: number, maintenanceKcal: number): number {
  return ((kcal - maintenanceKcal) / maintenanceKcal) * 100
}

/** Proposed starting targets for a new phase, to be confirmed or edited before it starts. */
export function proposePhaseTargets(input: PhaseTargetInput, s: Settings): PhaseProposal {
  const { type, maintenanceKcal, trendLb, bodyFatPct } = input
  const band = input.band ?? rateBand(type, s)
  const targetRatePct = input.targetRatePct ?? bandMidpoint(band)
  const offset = kcalOffset(targetRatePct, trendLb, s)
  const leanLb = bodyFatPct === null ? null : leanMassLb(trendLb, bodyFatPct)
  const rule = proteinRule(type, leanLb, s)
  const kcal = roundToStep(maintenanceKcal + offset, s.kcalRoundTo)
  const protein = proteinG(type, { trendLb, leanLb }, s)
  const macros = targetMacros({ kcal, proteinG: protein, fatPct: s.fatPct })
  const length = phaseLength(type, s)
  return {
    ...macros,
    type,
    maintenanceKcal,
    maintenanceSource: input.maintenanceSource,
    trendLb,
    bodyFatPct,
    bfQuality: bodyFatPct === null ? 'none' : input.bfQuality,
    leanLb,
    band,
    targetRatePct,
    kcalOffset: offset,
    impliedSurplusPct: surplusPct(kcal, maintenanceKcal),
    proteinBasis: rule.basis,
    proteinGPerKg: rule.gPerKg,
    ...length,
    bfCeilingPct: type === 'bulk' ? s.bulkBfCeilingPct : null,
    bfTargetPct: type === 'cut' ? s.cutBfTargetPct : null,
    warnings: warningsFor(macros, maintenanceKcal, s),
  }
}

/** Apply the user's edits to a proposal; fat, carbs, surplus and warnings are recomputed. */
export function editProposal(
  p: PhaseProposal,
  edits: Partial<Pick<Macros, 'kcal' | 'proteinG' | 'fatPct'>>,
  s: Settings,
): PhaseProposal {
  const macros = targetMacros({
    kcal: edits.kcal ?? p.kcal,
    proteinG: edits.proteinG ?? p.proteinG,
    fatPct: edits.fatPct ?? p.fatPct,
  })
  return {
    ...p,
    ...macros,
    impliedSurplusPct: surplusPct(macros.kcal, p.maintenanceKcal),
    warnings: warningsFor(macros, p.maintenanceKcal, s),
  }
}

/** Planned and maximum length in weeks (maintenance: both maintWeeks). */
export function phaseLength(
  type: PhaseType,
  s: Settings,
): { plannedWeeks: number; maxWeeks: number } {
  if (type === 'bulk') return { plannedWeeks: s.bulkPlannedWeeks, maxWeeks: s.bulkMaxWeeks }
  if (type === 'cut') return { plannedWeeks: s.cutPlannedWeeks, maxWeeks: s.cutMaxWeeks }
  return { plannedWeeks: s.maintWeeks, maxWeeks: s.maintWeeks }
}
