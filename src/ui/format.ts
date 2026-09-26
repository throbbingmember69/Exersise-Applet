// Display formatting shared by every screen (docs/UI.md "Numbers and copy").
import { formatMass } from '@/domain/units'
import type { LoadType, LocalDate, Regime, UnitSystem } from '@/domain/types'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const shortDateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const intFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/** A LocalDate at local noon (never `new Date('YYYY-MM-DD')`, which is UTC midnight). */
function atNoon(date: LocalDate): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, 12)
}

/** "Mon 28 Sep" (locale order). */
export function formatDate(date: LocalDate): string {
  return dateFmt.format(atNoon(date))
}

/** "28 Sep". */
export function formatShortDate(date: LocalDate): string {
  return shortDateFmt.format(atNoon(date))
}

/** "3,000 kcal". */
export function formatKcal(kcal: number): string {
  return `${intFmt.format(Math.round(kcal))} kcal`
}

/** Whole grams: "150 g". */
export function formatGrams(g: number): string {
  return `${intFmt.format(Math.round(g))} g`
}

export function formatInt(n: number): string {
  return intFmt.format(Math.round(n))
}

/** Signed whole number: "+150", "−100", "0". */
export function formatSigned(n: number): string {
  const r = Math.round(n)
  return r > 0 ? `+${intFmt.format(r)}` : r < 0 ? `−${intFmt.format(-r)}` : '0'
}

/**
 * A load as the lifter reads it: "220 lb", "70 lb per hand", chin-ups "+50 lb" / "−20 lb"
 * (assisted), bodyweight only "BW".
 */
export function formatLoad(
  loadLb: number | null,
  ex: { loadType: LoadType; perHand: boolean },
  unit: UnitSystem,
): string {
  if (loadLb === null) return '—'
  if (ex.loadType === 'bodyweight_plus') {
    if (Math.abs(loadLb) < 1e-9) return 'BW'
    return `${loadLb > 0 ? '+' : '−'}${formatMass(Math.abs(loadLb), unit)} ${unit}`
  }
  return `${formatMass(loadLb, unit)} ${unit}${ex.perHand ? ' per hand' : ''}`
}

/** "6–10" or "12". */
export function formatRange(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`
}

/** "2 min", "90 s", "2–3 min", "1:30–2 min". */
export function formatRest(minSec: number, maxSec: number): string {
  const one = (s: number) =>
    s % 60 === 0
      ? `${s / 60}`
      : s < 60
        ? `${s} s`
        : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  if (minSec === maxSec)
    return minSec % 60 === 0 && minSec > 0 ? `${minSec / 60} min` : `${minSec} s`
  if (minSec < 60 && maxSec < 60) return `${minSec}–${maxSec} s`
  const lo = minSec < 60 ? `${minSec} s` : one(minSec)
  return `${lo}–${one(maxSec)} min`
}

/** "4 × 6–10 · RIR 1–2 · rest 2–3 min". */
export function formatRegime(r: Regime, sets = r.sets): string {
  return `${sets} × ${formatRange(r.repMin, r.repMax)} · RIR ${formatRange(r.rirMin, r.rirMax)} · rest ${formatRest(r.restMinSec, r.restMaxSec)}`
}

/** "mm:ss" for a countdown (negative → "+mm:ss" overtime). */
export function formatClock(ms: number): string {
  const over = ms < 0
  const total = Math.round(Math.abs(ms) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${over ? '+' : ''}${m}:${String(s).padStart(2, '0')}`
}

/** Sets as "220×10, 10, 9" (same load) or "220×10, 230×8" (mixed). */
export function formatSets(
  sets: readonly { loadLb: number; reps: number }[],
  ex: { loadType: LoadType; perHand: boolean },
  unit: UnitSystem,
): string {
  if (sets.length === 0) return '—'
  const first = sets[0]!
  const same = sets.every((s) => Math.abs(s.loadLb - first.loadLb) < 1e-9)
  const load = (lb: number) =>
    formatLoad(lb, { ...ex, perHand: false }, unit).replace(` ${unit}`, '')
  if (same) return `${load(first.loadLb)} ${unit} × ${sets.map((s) => s.reps).join(', ')}`
  return sets.map((s) => `${load(s.loadLb)}×${s.reps}`).join(', ') + ` ${unit}`
}
