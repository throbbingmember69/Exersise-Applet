// Daily intake commands. A NutritionEntry is the day's running total, editable all day (finding
// #2): saves are patches (omitted fields kept, null clears). kcal is what counts a day as logged
// for maintenance and check-ins; macros and steps are optional (finding #53). Entries can't be
// dated after today, and a daily kcal above MAX_DAILY_KCAL is refused as a typo.
import type { LocalDate, NutritionEntry } from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { checkNotFuture, toLocalDate } from './queries'

/** Typo guard for a day's kcal (a sanity bound, not a tunable engine value). */
export const MAX_DAILY_KCAL = 15000

type IntakeFields = Pick<NutritionEntry, 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'steps'>

const FIELDS = [
  'kcal',
  'proteinG',
  'carbsG',
  'fatG',
  'steps',
] as const satisfies readonly (keyof IntakeFields)[]

const LABELS: Readonly<Record<keyof IntakeFields, string>> = {
  kcal: 'Calories',
  proteinG: 'Protein (g)',
  carbsG: 'Carbs (g)',
  fatG: 'Fat (g)',
  steps: 'Steps',
}

export type IntakeInput = { date: string } & {
  /** Omitted = keep the stored value; null = clear it. */
  [K in keyof IntakeFields]?: number | null
}

/** Upsert the day's intake. Returns the saved entry, or null when the patch cleared it. */
export async function saveIntake(
  ctx: ServiceCtx,
  input: IntakeInput,
): Promise<NutritionEntry | null> {
  const date = checkNotFuture(toLocalDate(input.date), today(ctx))
  const patch: Partial<IntakeFields> = {}
  for (const key of FIELDS) {
    const value = input[key]
    if (value === undefined) continue
    patch[key] = value === null ? null : checkValue(key, value)
  }
  if (Object.keys(patch).length === 0) {
    throw new ServiceError('empty_patch', 'Enter at least one value')
  }
  const { db } = ctx
  const now = ctx.now()
  return db.transaction('rw', db.nutritionEntries, async () => {
    const existing = await db.nutritionEntries.get(date)
    const next: NutritionEntry = {
      date,
      kcal: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      steps: null,
      ...existing,
      ...patch,
      updatedAt: now,
    }
    if (FIELDS.every((k) => next[k] === null)) {
      if (existing) await db.nutritionEntries.delete(date)
      return null
    }
    await db.nutritionEntries.put(next)
    return next
  })
}

/** Remove the day's intake entry (the day then counts as not logged). */
export async function clearIntake(ctx: ServiceCtx, date: string): Promise<void> {
  const d: LocalDate = toLocalDate(date)
  await ctx.db.transaction('rw', ctx.db.nutritionEntries, async () => {
    await ctx.db.nutritionEntries.delete(d)
  })
}

function checkValue(key: keyof IntakeFields, value: unknown): number {
  const label = LABELS[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ServiceError(`invalid_${key}`, `${label} must be a number of 0 or more`, { value })
  }
  if (key === 'steps' && !Number.isInteger(value)) {
    throw new ServiceError('invalid_steps', 'Steps must be a whole number', { value })
  }
  if (key === 'kcal' && value > MAX_DAILY_KCAL) {
    throw new ServiceError(
      'implausible_kcal',
      `Calories must be ${MAX_DAILY_KCAL.toLocaleString('en-US')} or less for a day`,
      { value, max: MAX_DAILY_KCAL },
    )
  }
  return value
}
