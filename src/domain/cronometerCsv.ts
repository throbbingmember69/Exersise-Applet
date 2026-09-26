// Cronometer CSV exports: calories and macros per day. Two exports are understood:
// - Daily Nutrition: one row per day ("Date", "Energy (kcal)", …, 80+ nutrient columns);
// - Servings: one row per food ("Day", "Time", "Food Name", …), summed per day.
// Only energy, protein, total carbs and total fat are read ("Net Carbs", "Saturated",
// "Trans-Fats" and the other nutrients are ignored). Energy in kJ is converted to kcal.
// A day with no calories counts as not logged. Plausibility is the importer's job.
import { parseNumberCell, readTable, resolveDates, type DateOrder } from './csvRead'
import type { LocalDate } from './types'

export type CronometerKind = 'daily' | 'servings'
export type CronometerField = 'kcal' | 'proteinG' | 'carbsG' | 'fatG'

export const CRONOMETER_FIELDS = [
  'kcal',
  'proteinG',
  'carbsG',
  'fatG',
] as const satisfies readonly CronometerField[]

/** kJ per kcal (thermochemical calorie). */
const KJ_PER_KCAL = 4.184

export interface CronometerDay {
  date: LocalDate
  kcal: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  /** Rows summed into this day (foods, for a Servings export). */
  rows: number
}

export interface CronometerCsvResult {
  kind: CronometerKind | null
  headers: string[]
  /** Recognized columns: field (or 'date') → header. */
  recognized: Partial<Record<CronometerField | 'date', string>>
  /** How many columns weren't used (Cronometer exports dozens of nutrients). */
  ignoredCount: number
  dateOrder: DateOrder | null
  /** Days with calories logged, oldest first. */
  days: CronometerDay[]
  rowCount: number
  /** Human-readable problems: rows or days skipped and why. */
  warnings: string[]
}

function norm(h: string): string {
  return h.toLowerCase().replace(/\s+/g, ' ').trim()
}

interface Columns {
  kind: CronometerKind | null
  date: number | null
  fields: Partial<Record<CronometerField, number>>
  kj: boolean
}

function detect(headers: readonly string[]): Columns {
  const h = headers.map(norm)
  const servings = h.some((x) => x === 'food name') || h.includes('day')
  const dateIdx = h.findIndex((x) => (servings ? x === 'day' : x === 'date'))
  const find = (re: RegExp) => {
    const i = h.findIndex((x) => re.test(x))
    return i === -1 ? undefined : i
  }
  const kcalIdx = find(/^(energy|calories) ?\(kcal\)$/)
  const kjIdx = kcalIdx === undefined ? find(/^energy ?\(kj\)$/) : undefined
  const fields: Partial<Record<CronometerField, number>> = {}
  const set = (f: CronometerField, i: number | undefined) => {
    if (i !== undefined) fields[f] = i
  }
  set('kcal', kcalIdx ?? kjIdx)
  set('proteinG', find(/^protein ?\(g\)$/))
  set('carbsG', find(/^(total )?(carbs|carbohydrates?) ?\(g\)$/))
  set('fatG', find(/^(total )?fat ?\(g\)$/))
  return {
    kind: dateIdx === -1 ? null : servings ? 'servings' : 'daily',
    date: dateIdx === -1 ? null : dateIdx,
    fields,
    kj: kcalIdx === undefined && kjIdx !== undefined,
  }
}

/** Parse a Cronometer Daily Nutrition or Servings export into per-day totals. */
export function parseCronometerCsv(text: string): CronometerCsvResult {
  const { headers, rows, decimalComma } = readTable(text)
  const cols = detect(headers)
  const warnings: string[] = []
  const recognized: CronometerCsvResult['recognized'] = {}
  if (cols.date !== null) recognized.date = headers[cols.date]
  for (const f of CRONOMETER_FIELDS) {
    const i = cols.fields[f]
    if (i !== undefined) recognized[f] = headers[i]
  }
  const result: CronometerCsvResult = {
    kind: cols.kind,
    headers,
    recognized,
    ignoredCount: headers.length - Object.keys(recognized).length,
    dateOrder: null,
    days: [],
    rowCount: rows.length,
    warnings,
  }
  if (cols.date === null) {
    warnings.push('No "Date" or "Day" column found. Is this a Cronometer export?')
    return result
  }
  if (cols.fields.kcal === undefined) {
    warnings.push('No energy (calories) column found.')
    return result
  }

  const rawDates = rows.map((r) => (r[cols.date!] ?? '').trim())
  const { order, dates } = resolveDates(rawDates)
  result.dateOrder = order
  const byDate = new Map<LocalDate, CronometerDay>()
  rows.forEach((r, i) => {
    const d = dates[i]
    if (!d) {
      warnings.push(`Row ${i + 2}: unreadable date "${rawDates[i]}", skipped.`)
      return
    }
    const cell = (f: CronometerField): number | null => {
      const idx = cols.fields[f]
      if (idx === undefined) return null
      const v = parseNumberCell(r[idx] ?? '', decimalComma)
      return v !== null && f === 'kcal' && cols.kj ? v / KJ_PER_KCAL : v
    }
    const day = byDate.get(d.date)
    if (cols.kind === 'daily') {
      if (day) warnings.push(`Row ${i + 2}: ${d.date} appears twice; the later row is used.`)
      byDate.set(d.date, {
        date: d.date,
        kcal: cell('kcal'),
        proteinG: cell('proteinG'),
        carbsG: cell('carbsG'),
        fatG: cell('fatG'),
        rows: 1,
      })
      return
    }
    // Servings: sum the foods. A blank cell in a present column counts as 0 for that food.
    const next: CronometerDay = day ?? {
      date: d.date,
      kcal: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      rows: 0,
    }
    for (const f of CRONOMETER_FIELDS) {
      if (cols.fields[f] === undefined) continue
      next[f] = (next[f] ?? 0) + (cell(f) ?? 0)
    }
    next.rows++
    byDate.set(d.date, next)
  })

  const all = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const logged = all.filter((d) => d.kcal !== null && d.kcal > 0)
  const empty = all.length - logged.length
  if (empty > 0) {
    warnings.push(
      `${empty} day${empty > 1 ? 's' : ''} with no calories logged ${empty > 1 ? 'were' : 'was'} skipped.`,
    )
  }
  result.days = logged
  return result
}
