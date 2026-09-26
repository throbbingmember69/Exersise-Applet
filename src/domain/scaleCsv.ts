// Smart-scale CSV exports (Arboleaf and similar): find the columns by their headers, parse the
// readings and keep one per day, the earliest (the spec's "weigh in every morning" rule).
//
// The export format isn't documented, so everything is detected rather than hard-coded:
// - delimiter (comma, semicolon or tab), quoted fields, a UTF-8 BOM;
// - columns by header keywords, with the mass unit from the header ("Weight(kg)"), else from the
//   values ("75.3kg"), else unknown (the caller asks the user);
// - dates as Y-M-D, M/D/Y or D/M/Y (decided across all rows: a first part over 12 means D/M/Y),
//   or with a month name ("Sep 24, 2026"), with an optional 12- or 24-hour time.
// Values like "--" or empty cells are missing, not zero. Nothing here validates plausibility;
// the importer does that.
import { parseNumberCell, readTable, resolveDates, type DateOrder } from './csvRead'
import type { LocalDate } from './types'
import { kgToLb } from './units'

export { parseNumberCell, readDelimited, type DateOrder } from './csvRead'

export type MassUnit = 'lb' | 'kg'

export type ScaleField =
  'weight' | 'bodyFatPct' | 'muscleMass' | 'skeletalMusclePct' | 'subcutFatPct' | 'visceralRating'

export interface ScaleColumns {
  /** Column index of the date/time, or null when none was found. */
  date: number | null
  fields: Partial<Record<ScaleField, number>>
  /** Headers of columns that weren't recognized (shown in the preview). */
  ignored: string[]
}

export interface ScaleReading {
  date: LocalDate
  /** Minutes after midnight (0 when the export has no time). */
  minuteOfDay: number
  /** Raw date text, for the preview. */
  rawDate: string
  weightLb: number | null
  bodyFatPct: number | null
  muscleMassLb: number | null
  skeletalMusclePct: number | null
  subcutFatPct: number | null
  visceralRating: number | null
}

export interface ScaleCsvResult {
  headers: string[]
  columns: ScaleColumns
  dateOrder: DateOrder | null
  /** Mass unit used for weight and muscle mass (null = couldn't tell; pass one in). */
  massUnit: MassUnit | null
  /** One reading per date, the earliest, oldest date first. */
  readings: ScaleReading[]
  /** Rows read (before keeping one per day). */
  rowCount: number
  /** Human-readable problems: rows skipped and why. */
  warnings: string[]
}

// ── Columns ─────────────────────────────────────────────────────────────────

function norm(h: string): string {
  return h
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim()
}

function unitOf(text: string): MassUnit | null {
  const t = text.toLowerCase()
  if (/\bkgs?\b|\(kg\)|kg$/.test(t)) return 'kg'
  if (/\blbs?\b|\(lbs?\)|lbs?$/.test(t)) return 'lb'
  return null
}

/** Recognize the columns this app stores. */
export function detectColumns(headers: readonly string[]): ScaleColumns {
  const fields: Partial<Record<ScaleField, number>> = {}
  let date: number | null = null
  const ignored: string[] = []
  const take = (field: ScaleField, i: number) => {
    if (fields[field] === undefined) {
      fields[field] = i
      return true
    }
    return false
  }
  headers.forEach((raw, i) => {
    const h = norm(raw)
    let used = false
    if (
      /(date|time|datum|measur)/.test(h) &&
      !/(weight|fat|muscle|water|bone|bmr|protein)/.test(h)
    ) {
      if (date === null) {
        date = i
        used = true
      }
    } else if (/visceral/.test(h)) used = take('visceralRating', i)
    else if (/subcutaneous/.test(h))
      used = /%|rate|percent/.test(h) || !unitOf(h) ? take('subcutFatPct', i) : false
    else if (/skeletal/.test(h))
      used = /%|rate|percent/.test(h) || !unitOf(h) ? take('skeletalMusclePct', i) : false
    else if (/muscle/.test(h) && !/(rate|%|percent|skeletal)/.test(h)) used = take('muscleMass', i)
    else if (
      /(body ?fat|^fat\b|bfr|fat ?rate)/.test(h) &&
      !/(free|mass|weight|subcutaneous|visceral)/.test(h)
    )
      used = take('bodyFatPct', i)
    else if (
      /^weight\b|^body ?weight/.test(h) &&
      !/(free|lean|standard|ideal|target|control|goal)/.test(h)
    )
      used = take('weight', i)
    if (!used) ignored.push(raw.trim())
  })
  return { date, fields, ignored }
}

// ── Whole file ──────────────────────────────────────────────────────────────

/** Parse a scale export. `massUnit` overrides the detected unit (the preview's unit picker). */
export function parseScaleCsv(text: string, opts: { massUnit?: MassUnit } = {}): ScaleCsvResult {
  const { headers, rows, decimalComma } = readTable(text)
  const columns = detectColumns(headers)
  const warnings: string[] = []

  const empty: ScaleCsvResult = {
    headers,
    columns,
    dateOrder: null,
    massUnit: null,
    readings: [],
    rowCount: rows.length,
    warnings,
  }
  if (columns.date === null) {
    warnings.push('No date column found.')
    return empty
  }
  if (Object.keys(columns.fields).length === 0) {
    warnings.push('No weight or body-composition columns found.')
    return empty
  }

  // Mass unit: header first, then any value's suffix.
  const massCols = [columns.fields.weight, columns.fields.muscleMass].filter(
    (i): i is number => i !== undefined,
  )
  let massUnit: MassUnit | null =
    opts.massUnit ?? massCols.map((i) => unitOf(headers[i] ?? '')).find((u) => u !== null) ?? null
  if (!massUnit) {
    for (const r of rows) {
      const u = massCols.map((i) => unitOf((r[i] ?? '').trim())).find((x) => x !== null)
      if (u) {
        massUnit = u
        break
      }
    }
  }

  const rawDates = rows.map((r) => (r[columns.date!] ?? '').trim())
  const { order: dateOrder, dates } = resolveDates(rawDates)

  const toLb = (v: number | null) =>
    v === null ? null : massUnit === 'kg' ? kgToLb(v) : massUnit === 'lb' ? v : null
  const byDate = new Map<LocalDate, ScaleReading>()
  rows.forEach((r, i) => {
    const d = dates[i]
    const raw = rawDates[i]!
    if (!d) {
      warnings.push(`Row ${i + 2}: unreadable date "${raw}", skipped.`)
      return
    }
    const cell = (f: ScaleField) => {
      const idx = columns.fields[f]
      return idx === undefined ? null : parseNumberCell(r[idx] ?? '', decimalComma)
    }
    const reading: ScaleReading = {
      date: d.date,
      minuteOfDay: d.minute,
      rawDate: raw,
      weightLb: toLb(cell('weight')),
      bodyFatPct: cell('bodyFatPct'),
      muscleMassLb: toLb(cell('muscleMass')),
      skeletalMusclePct: cell('skeletalMusclePct'),
      subcutFatPct: cell('subcutFatPct'),
      visceralRating: cell('visceralRating'),
    }
    const values = [
      reading.weightLb,
      reading.bodyFatPct,
      reading.muscleMassLb,
      reading.skeletalMusclePct,
      reading.subcutFatPct,
      reading.visceralRating,
    ]
    if (values.every((v) => v === null)) {
      warnings.push(`Row ${i + 2}: no readable values, skipped.`)
      return
    }
    const kept = byDate.get(d.date)
    if (!kept || reading.minuteOfDay < kept.minuteOfDay) byDate.set(d.date, reading)
  })

  return {
    ...empty,
    dateOrder,
    massUnit,
    readings: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  }
}
