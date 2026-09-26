// Plain-language explanations of suggestions and outcomes (docs/UI.md: say why in one line).
import type { DeloadReason } from '@/domain/deload'
import type { Branch, Notice } from '@/domain/types'

export function deloadReasonText(reasons: readonly DeloadReason[]): string {
  return reasons
    .map((r) => (r === 'stalls' ? 'several lifts stalled' : 'joint pain flagged'))
    .join(' and ')
}

/** Why the logger pre-filled this load (the flowchart branch that produced the suggestion). */
export function suggestionWhy(
  s: { branch: Branch; isCalibration: boolean; missStreakBefore: number },
  step: string,
): string {
  if (s.isCalibration) {
    return 'Find a working load for the rep range; this session sets your starting point.'
  }
  switch (s.branch) {
    case 'start':
      return 'Starting load from your program.'
    case 'calibrated':
      return 'Load from your calibration session.'
    case 'step':
      return `Every set hit the top of the range last time → +${step}.`
    case 'same_plus_rep':
      return 'Same load; aim for one more rep per set.'
    case 'same_after_miss':
      return 'A set fell short last time: same load, get back into the range.'
    case 'drop':
      return 'Short of the range twice in a row → load dropped.'
    case 'calibration':
      return 'Calibration session.'
  }
}

/** Short notices shown under an exercise. */
export function noticeText(n: Notice): string | null {
  switch (n.code) {
    case 'deload':
      return 'Deload: fewer sets, lighter load.'
    case 'mixed_loads':
      return 'Last time used different loads; the lowest one counts.'
    case 'missing_sets':
      return 'Some sets were missing last time.'
    case 'no_bodyweight':
      return 'Enter your bodyweight so this counts toward e1RM.'
    case 'calibration_needed':
    case 'recalibrate':
      return null // shown as a badge
  }
}
