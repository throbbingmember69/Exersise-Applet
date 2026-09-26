// Import a Cronometer CSV export (Daily Nutrition or Servings) into the intake log. Imported data
// wins: a day in the file replaces the calories and macros stored for that day, typed or not
// (the user's decision). Steps are never touched, and a macro the file doesn't have is kept.
// The preview shows what happens per day before anything is written; the import is one
// transaction.
import {
  CRONOMETER_FIELDS,
  parseCronometerCsv,
  type CronometerCsvResult,
  type CronometerDay,
  type CronometerField,
  type CronometerKind,
} from '@/domain/cronometerCsv'
import type { DateOrder } from '@/domain/csvRead'
import { compareLocalDate } from '@/domain/dates'
import type { LocalDate, NutritionEntry } from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { MAX_DAILY_KCAL } from './intake'

type Values = Pick<NutritionEntry, CronometerField>
/** Values from the file; fields it doesn't have are left out. */
type Incoming = Partial<Record<CronometerField, number>>

/**
 * What importing does with a day: new (no entry yet), update (replaces different values),
 * same (already has these values), future (dated after today), invalid (implausible values).
 */
export type CronometerDayStatus = 'new' | 'update' | 'same' | 'future' | 'invalid'

export interface CronometerImportDay {
  day: CronometerDay
  /** The values that would be written (fields the file doesn't have are left out). */
  values: Incoming
  status: CronometerDayStatus
  /** Why the day is invalid, e.g. "Calories 16,000 is over 15,000". */
  problems: string[]
  existing: Values | null
}

export interface CronometerImportPreview {
  kind: CronometerKind | null
  recognized: CronometerCsvResult['recognized']
  ignoredCount: number
  dateOrder: DateOrder | null
  warnings: string[]
  days: CronometerImportDay[]
  counts: Record<CronometerDayStatus, number>
}

export interface CronometerImportInput {
  text: string
}

/** Tolerances for "already has these values" (kcal, grams). */
const EPS: Readonly<Record<CronometerField, number>> = {
  kcal: 0.5,
  proteinG: 0.05,
  carbsG: 0.05,
  fatG: 0.05,
}

const LABELS: Readonly<Record<CronometerField, string>> = {
  kcal: 'Calories',
  proteinG: 'Protein',
  carbsG: 'Carbs',
  fatG: 'Fat',
}

function check(values: Incoming): string[] {
  const problems: string[] = []
  for (const f of CRONOMETER_FIELDS) {
    const v = values[f]
    if (v === undefined) continue
    if (v < 0) problems.push(`${LABELS[f]} ${Math.round(v)} is below 0`)
    else if (f === 'kcal' && v > MAX_DAILY_KCAL) {
      problems.push(
        `Calories ${Math.round(v).toLocaleString('en-US')} is over ${MAX_DAILY_KCAL.toLocaleString('en-US')}`,
      )
    }
  }
  return problems
}

function plan(
  text: string,
  entries: readonly NutritionEntry[],
  todayDate: LocalDate,
): CronometerImportPreview {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ServiceError('empty_file', 'The file is empty.')
  }
  const parsed = parseCronometerCsv(text)
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const counts: Record<CronometerDayStatus, number> = {
    new: 0,
    update: 0,
    same: 0,
    future: 0,
    invalid: 0,
  }
  const days = parsed.days.map((day): CronometerImportDay => {
    const values: Incoming = {}
    for (const f of CRONOMETER_FIELDS) {
      const v = day[f]
      if (v !== null) values[f] = v
    }
    const problems = check(values)
    const existing = byDate.get(day.date) ?? null
    let status: CronometerDayStatus
    if (compareLocalDate(day.date, todayDate) > 0) status = 'future'
    else if (problems.length > 0) status = 'invalid'
    else if (!existing) status = 'new'
    else if (
      CRONOMETER_FIELDS.every((f) => {
        const v = values[f]
        const cur = existing[f]
        return v === undefined || (cur !== null && Math.abs(cur - v) < EPS[f])
      })
    )
      status = 'same'
    else status = 'update'
    counts[status]++
    return {
      day,
      values,
      status,
      problems,
      existing: existing
        ? {
            kcal: existing.kcal,
            proteinG: existing.proteinG,
            carbsG: existing.carbsG,
            fatG: existing.fatG,
          }
        : null,
    }
  })
  return {
    kind: parsed.kind,
    recognized: parsed.recognized,
    ignoredCount: parsed.ignoredCount,
    dateOrder: parsed.dateOrder,
    warnings: parsed.warnings,
    days,
    counts,
  }
}

/** What an import would do, day by day (reads only). */
export async function previewCronometerImport(
  ctx: Pick<ServiceCtx, 'db' | 'now'>,
  input: CronometerImportInput,
): Promise<CronometerImportPreview> {
  const entries = await ctx.db.nutritionEntries.toArray()
  return plan(input.text, entries, today(ctx))
}

export interface CronometerImportResult {
  added: number
  updated: number
  skipped: number
}

/** Import the days: new days are added, and days with different values are replaced. */
export async function importCronometer(
  ctx: ServiceCtx,
  input: CronometerImportInput,
): Promise<CronometerImportResult> {
  const { db } = ctx
  const now = ctx.now()
  return db.transaction('rw', db.nutritionEntries, async () => {
    const entries = await db.nutritionEntries.toArray()
    const preview = plan(input.text, entries, today(ctx))
    const byDate = new Map(entries.map((e) => [e.date, e]))
    const writes: NutritionEntry[] = []
    let added = 0
    let updated = 0
    for (const d of preview.days) {
      if (d.status !== 'new' && d.status !== 'update') continue
      const current = byDate.get(d.day.date)
      writes.push({
        date: d.day.date,
        kcal: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        steps: null,
        ...current,
        ...d.values,
        updatedAt: now,
      })
      if (current) updated++
      else added++
    }
    if (writes.length > 0) await db.nutritionEntries.bulkPut(writes)
    return { added, updated, skipped: preview.days.length - added - updated }
  })
}
