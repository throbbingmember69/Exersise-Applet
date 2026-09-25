// Mass is always stored in lb at full precision. kg exists only at the display/input edge.
import { roundHalfAway } from './rounding'
import type { UnitSystem } from './types'

export const KG_PER_LB = 0.45359237
export const CM_PER_IN = 2.54

/** Tolerance for comparing stored loads (lb). Loads are sums of 2.5/5/10 steps, so 1e-6 is ample. */
export const LOAD_EPSILON = 1e-6

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB
}

/** Convert a stored lb value to the display unit. Never rounds. */
export function lbToDisplay(lb: number, unit: UnitSystem): number {
  return unit === 'kg' ? lbToKg(lb) : lb
}

/** Convert a value typed in the display unit to lb for storage. Never rounds. */
export function displayToLb(value: number, unit: UnitSystem): number {
  return unit === 'kg' ? kgToLb(value) : value
}

/**
 * The only place masses are rounded for display: at most `dp` decimals, trailing zeros trimmed.
 * formatMass(220, 'lb') === '220'; formatMass(kgToLb(100), 'kg') === '100'.
 */
export function formatMass(lb: number, unit: UnitSystem, dp = 1): string {
  const v = roundHalfAway(lbToDisplay(lb, unit), dp)
  return trimNumber(v, dp)
}

/** Same as formatMass but with the unit suffix: "220 lb", "100 kg". */
export function formatMassWithUnit(lb: number, unit: UnitSystem, dp = 1): string {
  return `${formatMass(lb, unit, dp)} ${unit}`
}

/** Weekly rate as mass per week in the display unit, e.g. "+0.6 lb/wk". */
export function formatRatePerWeek(ratePct: number, trendLb: number, unit: UnitSystem): string {
  const massPerWeek = (ratePct / 100) * trendLb
  const v = roundHalfAway(lbToDisplay(massPerWeek, unit), unit === 'kg' ? 2 : 1)
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
  return `${sign}${trimNumber(Math.abs(v), 2)} ${unit}/wk`
}

export function inToCm(inches: number): number {
  return inches * CM_PER_IN
}

export function cmToIn(cm: number): number {
  return cm / CM_PER_IN
}

export function loadsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < LOAD_EPSILON
}

function trimNumber(v: number, dp: number): string {
  // toFixed then strip trailing zeros ("37.50" → "37.5", "220.0" → "220"); avoid "-0".
  const s = (Object.is(v, -0) ? 0 : v).toFixed(dp)
  return dp > 0 ? s.replace(/\.?0+$/, '') : s
}
