import { displayToLb, formatMass, lbToDisplay } from '@/domain/units'
import type { UnitSystem } from '@/domain/types'
import NumberStepper from './NumberStepper'

/**
 * A load/weight stepper that stores lb and shows the display unit. The ± buttons add the
 * exercise's step in lb, so progression steps stay exact in either unit.
 */
export default function MassInput({
  label,
  valueLb,
  onChangeLb,
  unit,
  stepLb,
  allowNegative = false,
}: {
  label: string
  valueLb: number | null
  onChangeLb: (lb: number | null) => void
  unit: UnitSystem
  stepLb: number
  /** Bodyweight-plus exercises allow negative (assisted) loads. */
  allowNegative?: boolean
}) {
  const shown = valueLb === null ? null : lbToDisplay(valueLb, unit)
  return (
    <NumberStepper
      label={`${label} (${unit})`}
      value={shown}
      step={lbToDisplay(stepLb, unit)}
      min={allowNegative ? Number.NEGATIVE_INFINITY : 0}
      decimals={unit === 'kg' ? 2 : 1}
      format={(v) => formatMass(displayToLb(v, unit), unit)}
      onChange={(v) => onChangeLb(v === null ? null : displayToLb(v, unit))}
    />
  )
}
