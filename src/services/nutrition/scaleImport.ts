// Import a smart-scale CSV export (e.g. the Arboleaf app's) into the body log: one reading per day
// (the earliest), weights and scale fields. The preview shows exactly what will happen per day
// before anything is written; the import is one transaction.
import { compareLocalDate } from '@/domain/dates'
import {
  parseScaleCsv,
  type DateOrder,
  type MassUnit,
  type ScaleField,
  type ScaleReading,
} from '@/domain/scaleCsv'
import type { BodyEntry, LocalDate } from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { BODY_RANGES } from './body'

type Values = Pick<
  BodyEntry,
  | 'weightLb'
  | 'bodyFatPct'
  | 'muscleMassLb'
  | 'skeletalMusclePct'
  | 'subcutFatPct'
  | 'visceralRating'
>
const KEYS = [
  'weightLb',
  'bodyFatPct',
  'muscleMassLb',
  'skeletalMusclePct',
  'subcutFatPct',
  'visceralRating',
] as const satisfies readonly (keyof Values)[]

/**
 * What importing does with a day:
 * new: no entry yet; update: fills or replaces an entry (always for the seed baseline, and for
 * logged days when replacing); same: already logged with these values; exists: logged
 * differently, kept (not replacing); future: dated after today; invalid: nothing plausible.
 */
export type ImportDayStatus = 'new' | 'update' | 'same' | 'exists' | 'future' | 'invalid'

export interface ImportDay {
  reading: ScaleReading
  /** The values that would be written (implausible ones dropped). */
  values: Values
  status: ImportDayStatus
  /** Values dropped as implausible, e.g. "Body fat % 140 is outside 2–70". */
  problems: string[]
  existing: Values | null
}

export interface ScaleImportPreview {
  headers: string[]
  /** Recognized columns: field → header. */
  recognized: Partial<Record<ScaleField | 'date', string>>
  ignoredColumns: string[]
  dateOrder: DateOrder | null
  massUnit: MassUnit | null
  /** A weight or muscle-mass column exists but its unit couldn't be told: ask lb or kg. */
  needsUnit: boolean
  warnings: string[]
  days: ImportDay[]
  counts: Record<ImportDayStatus, number>
}

export interface ScaleImportInput {
  text: string
  /** Override the detected mass unit (the preview's unit picker). */
  massUnit?: MassUnit
  /** Replace values on days that already have a (different) entry. */
  replaceExisting?: boolean
}

const EPS = 0.05

function plausible(values: Values): { values: Values; problems: string[] } {
  const out = { ...values }
  const problems: string[] = []
  for (const k of KEYS) {
    const v = out[k]
    if (v === null) continue
    const { min, max, label } = BODY_RANGES[k]
    if (!(v >= min && v <= max)) {
      problems.push(`${label} ${Math.round(v * 10) / 10} is outside ${min}–${max}`)
      out[k] = null
    }
  }
  return { values: out, problems }
}

function valuesOf(r: ScaleReading): Values {
  return {
    weightLb: r.weightLb,
    bodyFatPct: r.bodyFatPct,
    muscleMassLb: r.muscleMassLb,
    skeletalMusclePct: r.skeletalMusclePct,
    subcutFatPct: r.subcutFatPct,
    visceralRating: r.visceralRating,
  }
}

function sameAs(existing: BodyEntry, v: Values): boolean {
  return KEYS.every((k) => {
    const incoming = v[k]
    if (incoming === null) return true
    const cur = existing[k]
    return cur !== null && Math.abs(cur - incoming) < EPS
  })
}

function plan(
  text: string,
  entries: readonly BodyEntry[],
  todayDate: LocalDate,
  opts: ScaleImportInput,
): ScaleImportPreview {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ServiceError('empty_file', 'The file is empty.')
  }
  const parsed = parseScaleCsv(text, opts.massUnit ? { massUnit: opts.massUnit } : {})
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const counts: Record<ImportDayStatus, number> = {
    new: 0,
    update: 0,
    same: 0,
    exists: 0,
    future: 0,
    invalid: 0,
  }
  const days = parsed.readings.map((reading): ImportDay => {
    const { values, problems } = plausible(valuesOf(reading))
    const existing = byDate.get(reading.date) ?? null
    let status: ImportDayStatus
    if (compareLocalDate(reading.date, todayDate) > 0) status = 'future'
    else if (KEYS.every((k) => values[k] === null)) status = 'invalid'
    else if (!existing) status = 'new'
    else if (existing.source === 'seed') status = 'update'
    else if (existing.voidedAt === null && sameAs(existing, values)) status = 'same'
    else status = opts.replaceExisting ? 'update' : 'exists'
    counts[status]++
    return {
      reading,
      values,
      status,
      problems,
      existing: existing ? (Object.fromEntries(KEYS.map((k) => [k, existing[k]])) as Values) : null,
    }
  })
  const recognized: ScaleImportPreview['recognized'] = {}
  if (parsed.columns.date !== null) recognized.date = parsed.headers[parsed.columns.date]
  for (const [f, i] of Object.entries(parsed.columns.fields) as [ScaleField, number][]) {
    recognized[f] = parsed.headers[i]
  }
  const hasMass =
    parsed.columns.fields.weight !== undefined || parsed.columns.fields.muscleMass !== undefined
  return {
    headers: parsed.headers,
    recognized,
    ignoredColumns: parsed.columns.ignored,
    dateOrder: parsed.dateOrder,
    massUnit: parsed.massUnit,
    needsUnit: hasMass && parsed.massUnit === null,
    warnings: parsed.warnings,
    days,
    counts,
  }
}

/** What an import would do, day by day (reads only). */
export async function previewScaleImport(
  ctx: Pick<ServiceCtx, 'db' | 'now'>,
  input: ScaleImportInput,
): Promise<ScaleImportPreview> {
  const entries = await ctx.db.bodyEntries.toArray()
  return plan(input.text, entries, today(ctx), input)
}

export interface ScaleImportResult {
  added: number
  updated: number
  skipped: number
}

/**
 * Import the readings: new days are added, the seed baseline's day is filled in, and logged days
 * are replaced only with `replaceExisting` (a deleted day is then restored). Imported weigh-ins
 * are user entries, like typed ones. Refuses a file whose mass unit is unknown.
 */
export async function importScaleReadings(
  ctx: ServiceCtx,
  input: ScaleImportInput,
): Promise<ScaleImportResult> {
  const { db } = ctx
  const now = ctx.now()
  return db.transaction('rw', db.bodyEntries, async () => {
    const entries = await db.bodyEntries.toArray()
    const preview = plan(input.text, entries, today(ctx), input)
    if (preview.needsUnit) {
      throw new ServiceError('unit_needed', 'Choose whether the file’s weights are in lb or kg.')
    }
    const byDate = new Map(entries.map((e) => [e.date, e]))
    const writes: BodyEntry[] = []
    let added = 0
    let updated = 0
    for (const day of preview.days) {
      if (day.status !== 'new' && day.status !== 'update') continue
      const current = byDate.get(day.reading.date)
      const imported = Object.fromEntries(
        KEYS.filter((k) => day.values[k] !== null).map((k) => [k, day.values[k]]),
      ) as Partial<Values>
      writes.push({
        date: day.reading.date,
        weightLb: null,
        bodyFatPct: null,
        muscleMassLb: null,
        skeletalMusclePct: null,
        subcutFatPct: null,
        visceralRating: null,
        note: '',
        createdAt: now,
        ...current,
        ...imported,
        source: imported.weightLb !== undefined || !current ? 'user' : current.source,
        updatedAt: now,
        voidedAt: null,
      })
      if (current) updated++
      else added++
    }
    if (writes.length > 0) await db.bodyEntries.bulkPut(writes)
    return { added, updated, skipped: preview.days.length - added - updated }
  })
}
