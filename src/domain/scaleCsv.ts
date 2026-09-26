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
import { isLocalDate } from './dates'
import type { LocalDate } from './types'
import { kgToLb } from './units'

export type MassUnit = 'lb' | 'kg'
export type DateOrder = 'YMD' | 'MDY' | 'DMY' | 'named'

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

// ── CSV reading ─────────────────────────────────────────────────────────────

/** RFC 4180-ish reader: quoted fields ("" escapes), CRLF/LF/CR line ends, any delimiter. */
export function readDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field.trim() === '') {
      quoted = true
      field = ''
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const)
  counts.sort((a, b) => b[1] - a[1])
  return counts[0]![1] > 0 ? counts[0]![0] : ','
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

// ── Values ──────────────────────────────────────────────────────────────────

/** A number from a cell like "75.3", "75.3kg", "16,2 %" (decimal comma), or null for "--". */
export function parseNumberCell(cell: string, decimalComma: boolean): number | null {
  let t = cell.trim().replace(/[^\d.,+\-–—]/g, '')
  if (t === '' || /^[-–—]+$/.test(t)) return null
  if (decimalComma) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

interface DateParts {
  a: number
  b: number
  c: number
  minute: number
  order: 'Y' | 'x' | 'named'
}

function timeOf(h?: string, m?: string, ampm?: string): number {
  if (h === undefined || m === undefined) return 0
  let hour = Number(h)
  const ap = ampm?.toLowerCase()
  if (ap === 'pm' && hour < 12) hour += 12
  if (ap === 'am' && hour === 12) hour = 0
  return hour * 60 + Number(m)
}

function splitDate(raw: string): DateParts | null {
  const s = raw.trim()
  const TIME = String.raw`(?:[ T,]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(am|pm)?)?`
  let m = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}`, 'i').exec(s)
  if (m) return { a: +m[1]!, b: +m[2]!, c: +m[3]!, minute: timeOf(m[4], m[5], m[6]), order: 'Y' }
  m = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})${TIME}`, 'i').exec(s)
  if (m) return { a: +m[1]!, b: +m[2]!, c: +m[3]!, minute: timeOf(m[4], m[5], m[6]), order: 'x' }
  m = new RegExp(String.raw`^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})${TIME}`, 'i').exec(s)
  if (m) {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1
    if (month === 0) return null
    return { a: +m[3]!, b: month, c: +m[2]!, minute: timeOf(m[4], m[5], m[6]), order: 'named' }
  }
  return null
}

function toLocal(y: number, mo: number, d: number): LocalDate | null {
  const year = y < 100 ? 2000 + y : y
  const s = `${String(year).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isLocalDate(s) ? s : null
}

// ── Whole file ──────────────────────────────────────────────────────────────

/** Parse a scale export. `massUnit` overrides the detected unit (the preview's unit picker). */
export function parseScaleCsv(text: string, opts: { massUnit?: MassUnit } = {}): ScaleCsvResult {
  const clean = text.replace(/^\uFEFF/, '')
  const firstLine = clean.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const delimiter = detectDelimiter(firstLine)
  const decimalComma = delimiter === ';'
  const [headerRow = [], ...rows] = readDelimited(clean, delimiter)
  const headers = headerRow.map((h) => h.trim())
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

  // Date order across all rows.
  const parts = rows.map((r) => splitDate(r[columns.date!] ?? ''))
  const numeric = parts.filter((p): p is DateParts => p !== null && p.order === 'x')
  let dateOrder: DateOrder | null = null
  if (parts.some((p) => p?.order === 'Y')) dateOrder = 'YMD'
  else if (parts.some((p) => p?.order === 'named')) dateOrder = 'named'
  else if (numeric.length > 0) dateOrder = numeric.some((p) => p.a > 12) ? 'DMY' : 'MDY'

  const toLb = (v: number | null) =>
    v === null ? null : massUnit === 'kg' ? kgToLb(v) : massUnit === 'lb' ? v : null
  const byDate = new Map<LocalDate, ScaleReading>()
  rows.forEach((r, i) => {
    const p = parts[i]
    const raw = (r[columns.date!] ?? '').trim()
    let date: LocalDate | null = null
    if (p) {
      if (p.order === 'Y' || p.order === 'named') date = toLocal(p.a, p.b, p.c)
      else date = dateOrder === 'DMY' ? toLocal(p.c, p.b, p.a) : toLocal(p.c, p.a, p.b)
    }
    if (!date) {
      warnings.push(`Row ${i + 2}: unreadable date "${raw}", skipped.`)
      return
    }
    const cell = (f: ScaleField) => {
      const idx = columns.fields[f]
      return idx === undefined ? null : parseNumberCell(r[idx] ?? '', decimalComma)
    }
    const reading: ScaleReading = {
      date,
      minuteOfDay: p!.minute,
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
    const kept = byDate.get(date)
    if (!kept || reading.minuteOfDay < kept.minuteOfDay) byDate.set(date, reading)
  })

  return {
    ...empty,
    dateOrder,
    massUnit,
    readings: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  }
}
