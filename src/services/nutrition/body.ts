// Body log commands: daily weigh-ins and weekly smart-scale readings (one BodyEntry per date).
// Body entries are editable in place (finding #2) and can't be dated after today. A weigh-in more
// than weighInConfirmDeviationPct from the reference weight on its date needs confirming first
// (typo guard): the trend, or the seed baseline before any real weigh-in (G9), so the first
// reading (the trend's T0) is checked too. A user weigh-in on the seed baseline's date takes that
// row over (source 'user'), keeping its scale fields. Voiding is a soft delete; re-entering a
// voided date restores that row and applies the new values on top (its other fields are kept).
import { bodyweightOn, buildTrend } from '@/domain/trend'
import type { BodyEntry, LocalDate } from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { loadSettings } from '../settings'
import { checkNotFuture, toLocalDate } from './queries'

type Measurements = Pick<
  BodyEntry,
  | 'weightLb'
  | 'bodyFatPct'
  | 'muscleMassLb'
  | 'skeletalMusclePct'
  | 'subcutFatPct'
  | 'visceralRating'
>

const MEASUREMENT_KEYS = [
  'weightLb',
  'bodyFatPct',
  'muscleMassLb',
  'skeletalMusclePct',
  'subcutFatPct',
  'visceralRating',
] as const satisfies readonly (keyof Measurements)[]

/** Plausible ranges: anything outside is treated as a typo. */
const RANGES: Readonly<Record<keyof Measurements, { min: number; max: number; label: string }>> = {
  weightLb: { min: 50, max: 1000, label: 'Weight (lb)' },
  bodyFatPct: { min: 2, max: 70, label: 'Body fat %' },
  muscleMassLb: { min: 1, max: 1000, label: 'Muscle mass (lb)' },
  skeletalMusclePct: { min: 0, max: 100, label: 'Skeletal muscle %' },
  subcutFatPct: { min: 0, max: 100, label: 'Subcutaneous fat %' },
  visceralRating: { min: 1, max: 60, label: 'Visceral fat rating' },
}

export interface WeighInInput {
  date: string
  weightLb: number
  /** The user confirmed a reading far from the trend. */
  confirmed?: boolean
}

export type WeighInResult =
  | { status: 'saved' }
  | {
      status: 'needs_confirm'
      /** The reference weight: the trend, or the seed baseline before any real weigh-in. */
      trendLb: number
      weightSource: 'trend' | 'seed'
      /** Signed % difference from the reference (positive = above). */
      deviationPct: number
    }

/** Save the day's weight (upsert by date). Asks for confirmation when far from the trend. */
export async function saveWeighIn(ctx: ServiceCtx, input: WeighInInput): Promise<WeighInResult> {
  const date = checkNotFuture(toLocalDate(input.date), today(ctx))
  const weightLb = checkValue('weightLb', input.weightLb)
  if (!input.confirmed) {
    const check = await typoCheck(ctx, date, weightLb)
    if (check) return check
  }
  await writeEntry(ctx, date, { weightLb }, true)
  return { status: 'saved' }
}

export type ScaleReadingInput = {
  date: string
  /** The user confirmed a weight far from the trend. */
  confirmed?: boolean
} & {
  /** Omitted = keep the stored value; null = clear it. */
  [K in keyof Measurements]?: number | null
}

/** Save smart-scale fields for a date (patch: omitted fields kept, null clears). */
export async function saveScaleReading(
  ctx: ServiceCtx,
  input: ScaleReadingInput,
): Promise<WeighInResult> {
  const date = checkNotFuture(toLocalDate(input.date), today(ctx))
  const patch: Partial<Measurements> = {}
  for (const key of MEASUREMENT_KEYS) {
    const value = input[key]
    if (value === undefined) continue
    patch[key] = value === null ? null : checkValue(key, value)
  }
  if (Object.keys(patch).length === 0) {
    throw new ServiceError('empty_patch', 'Enter at least one reading')
  }
  if (typeof patch.weightLb === 'number' && !input.confirmed) {
    const check = await typoCheck(ctx, date, patch.weightLb)
    if (check) return check
  }
  await writeEntry(ctx, date, patch, patch.weightLb !== undefined)
  return { status: 'saved' }
}

/** Soft-delete the entry on a date (excluded from the trend and body fat; restorable). */
export async function voidBodyEntry(ctx: ServiceCtx, date: string): Promise<void> {
  const d = toLocalDate(date)
  const { db } = ctx
  await db.transaction('rw', db.bodyEntries, async () => {
    const entry = await db.bodyEntries.get(d)
    if (!entry) throw notFound(d)
    if (entry.voidedAt === null) await db.bodyEntries.update(d, { voidedAt: ctx.now() })
  })
}

/** Undo a void. */
export async function restoreBodyEntry(ctx: ServiceCtx, date: string): Promise<void> {
  const d = toLocalDate(date)
  const { db } = ctx
  await db.transaction('rw', db.bodyEntries, async () => {
    const entry = await db.bodyEntries.get(d)
    if (!entry) throw notFound(d)
    if (entry.voidedAt !== null) await db.bodyEntries.update(d, { voidedAt: null })
  })
}

function notFound(date: LocalDate): ServiceError {
  return new ServiceError('not_found', `No body entry on ${date}`, { date })
}

function checkValue(key: keyof Measurements, value: unknown): number {
  const { min, max, label } = RANGES[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ServiceError(`invalid_${key}`, `${label} must be between ${min} and ${max}`, {
      value,
    })
  }
  return value
}

/**
 * Compare a reading with the reference weight on its date: the trend, else the seed baseline
 * (before any real weigh-in), both without that date's own entry (so editing a day compares
 * against the other days). No reference → no check.
 */
async function typoCheck(
  ctx: Pick<ServiceCtx, 'db'>,
  date: LocalDate,
  weightLb: number,
): Promise<WeighInResult | null> {
  const [settings, entries] = await Promise.all([loadSettings(ctx), ctx.db.bodyEntries.toArray()])
  const current = entries.find((e) => e.date === date)
  if (current && current.source === 'user' && current.voidedAt === null) {
    if (current.weightLb === weightLb) return null
  }
  const others = entries.filter((e) => e.date !== date)
  const reference = bodyweightOn(buildTrend(others, settings), others, date)
  if (!reference) return null
  const deviationPct = ((weightLb - reference.weightLb) / reference.weightLb) * 100
  if (Math.abs(deviationPct) <= settings.weighInConfirmDeviationPct) return null
  return {
    status: 'needs_confirm',
    trendLb: reference.weightLb,
    weightSource: reference.source,
    deviationPct,
  }
}

function blankEntry(date: LocalDate, now: number): BodyEntry {
  return {
    date,
    weightLb: null,
    bodyFatPct: null,
    muscleMassLb: null,
    skeletalMusclePct: null,
    subcutFatPct: null,
    visceralRating: null,
    source: 'user',
    note: '',
    createdAt: now,
    updatedAt: now,
    voidedAt: null,
  }
}

/**
 * Upsert the entry on `date`. `claimsWeight`: the user set (or cleared) the weight, so a seed row
 * becomes theirs. A voided row is restored and patched, never replaced by a blank entry (its
 * other fields, such as the seed baseline's scale reading, are kept).
 */
async function writeEntry(
  ctx: ServiceCtx,
  date: LocalDate,
  patch: Partial<Measurements>,
  claimsWeight: boolean,
): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.bodyEntries, async () => {
    const existing = await db.bodyEntries.get(date)
    const base: BodyEntry = existing ? { ...existing, voidedAt: null } : blankEntry(date, now)
    const next: BodyEntry = {
      ...base,
      ...patch,
      source: claimsWeight ? 'user' : base.source,
      updatedAt: now,
    }
    if (MEASUREMENT_KEYS.every((k) => next[k] === null)) {
      throw new ServiceError('empty_entry', 'This would leave the entry empty; delete it instead', {
        date,
      })
    }
    await db.bodyEntries.put(next)
  })
}
