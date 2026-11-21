// Smart-scale CSV exports (Arboleaf and similar): find the columns by their headers, parse the
// readings and keep one per day (the spec's "weigh in every morning" rule). A day's first weigh-in
// is its earliest reading plus every reading within `clusterMin` minutes of it: the scale often
// logs a weight-only or still-settling reading first and the full body-composition one seconds
// later (one export has 166.1, 165.3, 163.4 and 162.9 lb inside five minutes). The import keeps
// that weigh-in's LAST reading with body-composition values (else its last reading), whole: every
// value comes from that one reading, never mixed across readings. `spreadLb` reports how far the
// weigh-in's weights differ, so the preview can flag an unsettled one. Later weigh-ins that day
// (an evening reading) are ignored.
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
import { DEFAULT_SETTINGS } from './settings/registry'
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
  /** Minutes after midnight of the kept reading (0 when the export has no time). */
  minuteOfDay: number
  /** Raw date text of the kept reading, for the preview. */
  rawDate: string
  /** Readings in the day's first weigh-in (1 = a single reading). */
  readingCount: number
  /** Heaviest minus lightest weight across the weigh-in's readings (0 for one; null without weights). */
  spreadLb: number | null
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
  /** One reading per date (the first weigh-in's last full reading, whole), oldest first. */
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

const VALUE_KEYS = [
  'weightLb',
  'bodyFatPct',
  'muscleMassLb',
  'skeletalMusclePct',
  'subcutFatPct',
  'visceralRating',
] as const satisfies readonly (keyof ScaleReading)[]

/**
 * Parse a scale export. `massUnit` overrides the detected unit (the preview's unit picker);
 * `clusterMin` is the settings' scaleClusterMin (how close readings must be to count as one weigh-in).
 */
export function parseScaleCsv(
  text: string,
  opts: { massUnit?: MassUnit; clusterMin?: number } = {},
): ScaleCsvResult {
  const clusterSec = (opts.clusterMin ?? DEFAULT_SETTINGS.scaleClusterMin) * 60
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
  const byDate = new Map<LocalDate, { second: number; reading: ScaleReading }[]>()
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
      minuteOfDay: Math.floor(d.second / 60),
      rawDate: raw,
      readingCount: 1,
      spreadLb: null,
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
    const day = byDate.get(d.date)
    if (day) day.push({ second: d.second, reading })
    else byDate.set(d.date, [{ second: d.second, reading }])
  })

  const readings = [...byDate.values()].map((day) => {
    // Stable sort: readings with the same time keep file order.
    const sorted = [...day].sort((a, b) => a.second - b.second)
    const first = sorted[0]!.second
    const weighIn = sorted.filter((x) => x.second - first <= clusterSec).map((x) => x.reading)
    const kept =
      lastWhere(weighIn, hasComposition) ?? lastWhere(weighIn, hasWeight) ?? weighIn.at(-1)!
    const weights = weighIn.map((r) => r.weightLb).filter((w): w is number => w !== null)
    return {
      ...kept,
      readingCount: weighIn.length,
      spreadLb: weights.length === 0 ? null : Math.max(...weights) - Math.min(...weights),
    }
  })

  return {
    ...empty,
    dateOrder,
    massUnit,
    readings: readings.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  }
}

const COMPOSITION_KEYS = VALUE_KEYS.filter((k) => k !== 'weightLb')

function hasComposition(r: ScaleReading): boolean {
  return COMPOSITION_KEYS.some((k) => r[k] !== null)
}

function hasWeight(r: ScaleReading): boolean {
  return r.weightLb !== null
}

function lastWhere<T>(xs: readonly T[], pred: (x: T) => boolean): T | undefined {
  for (let i = xs.length - 1; i >= 0; i--) if (pred(xs[i]!)) return xs[i]
  return undefined
}
