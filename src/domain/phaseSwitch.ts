// Phase-switch prompts (findings #35, #36; DECISIONS "Body fat"). Prompts only; nothing switches
// automatically. Bulk: a soft note at the planned length, a firm prompt at the maximum or when
// smoothed body fat reaches the ceiling. Cut: soft at the planned length, firm at the maximum,
// at the body-fat target, or on a main-lift strength slide. Maintenance: firm at its length.
// Lengths and body-fat thresholds come from the phase (copied from settings when it was created;
// the phase value wins), with the settings as a fallback for missing thresholds. Only a smoothed
// body-fat value (not a single reading) triggers a prompt. The suggested next phase follows the
// flowchart: bulk → maintenance → cut → maintenance → bulk.
import type { SmoothedBodyFat } from '@/domain/bodycomp'
import type {
  Phase,
  PhaseType,
  Settings,
  SwitchPrompt,
  SwitchPromptKind,
  SwitchReason,
} from '@/domain/types'

export interface PhaseSwitchInput {
  phase: Pick<Phase, 'type' | 'plannedWeeks' | 'maxWeeks' | 'bfCeilingPct' | 'bfTargetPct'>
  /** Completed weeks of the phase (the check-in week index). */
  weekIndex: number
  smoothedBf: Pick<SmoothedBodyFat, 'pct' | 'quality'> | null
  /** Main-lift strength slide (cut only); null when not evaluated. */
  strength: { triggered: boolean } | null
  /** Type of the last bulk or cut before this phase; picks the phase after maintenance. */
  lastNonMaintenanceType?: PhaseType | null
}

const PROMPT_KIND: Readonly<Record<PhaseType, SwitchPromptKind>> = {
  bulk: 'end_bulk',
  cut: 'end_cut',
  maintenance: 'end_maintenance',
}

/** The flowchart's next phase: bulk or cut → maintenance; maintenance → the opposite of before. */
export function nextPhaseType(
  current: PhaseType,
  lastNonMaintenanceType: PhaseType | null,
): PhaseType {
  if (current !== 'maintenance') return 'maintenance'
  return lastNonMaintenanceType === 'bulk' ? 'cut' : 'bulk'
}

/** The switch prompt due at this point of a phase, or null. */
export function phaseSwitchPrompt(input: PhaseSwitchInput, s: Settings): SwitchPrompt | null {
  const { phase, weekIndex, strength } = input
  const bf = input.smoothedBf?.quality === 'smoothed' ? input.smoothedBf.pct : null
  const firm: SwitchReason[] = []
  const soft: SwitchReason[] = []

  if (phase.type === 'maintenance') {
    if (weekIndex >= phase.maxWeeks) firm.push('maintenance_length')
  } else {
    if (weekIndex >= phase.maxWeeks) firm.push('max_length')
    else if (weekIndex >= phase.plannedWeeks) soft.push('planned_length')
  }
  if (phase.type === 'bulk' && bf !== null && bf >= (phase.bfCeilingPct ?? s.bulkBfCeilingPct)) {
    firm.push('bf_ceiling')
  }
  if (phase.type === 'cut') {
    if (bf !== null && bf <= (phase.bfTargetPct ?? s.cutBfTargetPct)) firm.push('bf_target')
    if (strength?.triggered) firm.push('strength_slide')
  }

  if (firm.length === 0 && soft.length === 0) return null
  return {
    kind: PROMPT_KIND[phase.type],
    severity: firm.length > 0 ? 'firm' : 'soft',
    reasons: [...soft, ...firm],
    suggestedNext: nextPhaseType(phase.type, input.lastNonMaintenanceType ?? null),
  }
}
