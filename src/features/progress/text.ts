import type { MetricValue } from '@/domain/e1rm'
import type { LoadType, UnitSystem } from '@/domain/types'
import { formatMass } from '@/domain/units'
import { formatLoad } from '@/ui/format'

/** "e1RM 367.5 lb" or "40 lb × 18" (reps-at-load exercises). */
export function metricText(
  v: MetricValue,
  ex: { loadType: LoadType; perHand: boolean },
  unit: UnitSystem,
): string {
  return v.kind === 'e1rm'
    ? `e1RM ${formatMass(v.displayLb, unit)} ${unit}`
    : `${formatLoad(v.loadLb, ex, unit)} × ${v.reps}`
}
