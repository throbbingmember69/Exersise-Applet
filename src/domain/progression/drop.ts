// Load drops in whole steps, shared by the miss rule and the deload load cut.
//
// drop = max(1, floor(pct × |load| ÷ step)) steps, counted from the current load, so the result is
// always settable on the equipment and light loads still drop at least one step
// (220/10 → 200, 40/2.5 → 37.5, +50/5 → +45). Bodyweight-plus loads are the added load and may go
// to zero or below (assisted); every other load is clamped at 0. A 0% cut is no cut.

/** Guards floor() against binary error in pct × load ÷ step (17.5% × 700 ÷ 2.5 = 48.999…). */
const STEP_EPSILON = 1e-9

/** The load `pct` percent lighter, in whole steps (minimum one step). */
export function dropLoad(
  baseLb: number,
  stepLb: number,
  pct: number,
  allowNegative: boolean,
): number {
  if (!(stepLb > 0)) throw new RangeError(`stepLb must be > 0, got ${stepLb}`)
  if (!(pct > 0)) return baseLb
  const steps = Math.max(1, Math.floor(((pct / 100) * Math.abs(baseLb)) / stepLb + STEP_EPSILON))
  const dropped = baseLb - steps * stepLb
  return allowNegative ? dropped : Math.max(0, dropped)
}
