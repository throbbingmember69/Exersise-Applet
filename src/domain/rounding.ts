// Rounding helpers. Math.round rounds -10.5 to -10, so everything here rounds half away from zero.

/** Round to `decimals` places, half away from zero (2.5 → 3, -2.5 → -3). */
export function roundHalfAway(x: number, decimals = 0): number {
  const f = 10 ** decimals
  // EPSILON nudge so values like 1.005 (stored as 1.00499…) round as written.
  const scaled = Math.abs(x) * f * (1 + Number.EPSILON)
  return (Math.sign(x) * Math.round(scaled)) / f
}

/** Round to the nearest multiple of `step`, half away from zero (e.g. kcal to 50, protein to 5 g). */
export function roundToStep(x: number, step: number): number {
  if (!(step > 0)) throw new RangeError(`step must be > 0, got ${step}`)
  return roundHalfAway(x / step) * step
}

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x))
}

/** Mean of a non-empty list; null for an empty one. */
export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}
