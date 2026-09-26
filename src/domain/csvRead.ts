// Reading CSV exports from other apps (smart scale, Cronometer): the delimiter, quoting, BOM,
// number cells and dates are detected rather than assumed, since none of these formats is
// documented. Header matching and plausibility checks belong to each importer.
import { isLocalDate } from './dates'
import type { LocalDate } from './types'

export type DateOrder = 'YMD' | 'MDY' | 'DMY' | 'named'

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

export interface Table {
  /** Trimmed header cells. */
  headers: string[]
  rows: string[][]
  /** Semicolon-delimited files use decimal commas ("16,2"). */
  decimalComma: boolean
}

/** Split a whole export into trimmed headers and rows (BOM stripped, delimiter detected). */
export function readTable(text: string): Table {
  const clean = text.replace(/^\uFEFF/, '')
  const firstLine = clean.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const delimiter = detectDelimiter(firstLine)
  const [headerRow = [], ...rows] = readDelimited(clean, delimiter)
  return { headers: headerRow.map((h) => h.trim()), rows, decimalComma: delimiter === ';' }
}

/** A number from a cell like "75.3", "75.3kg", "16,2 %" (decimal comma), or null for "--". */
export function parseNumberCell(cell: string, decimalComma: boolean): number | null {
  let t = cell.trim().replace(/[^\d.,+\-–—]/g, '')
  if (t === '' || /^[-–—]+$/.test(t)) return null
  if (decimalComma) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ── Dates ───────────────────────────────────────────────────────────────────

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

export interface ResolvedDate {
  date: LocalDate
  /** Minutes after midnight (0 when the cell has no time). */
  minute: number
}

/**
 * Read a column of date cells: Y-M-D, M/D/Y or D/M/Y (decided across all cells: a first part
 * over 12 means D/M/Y), or a month name ("Sep 24, 2026"), each with an optional 12- or 24-hour
 * time. Unreadable or impossible dates come back as null.
 */
export function resolveDates(cells: readonly string[]): {
  order: DateOrder | null
  dates: (ResolvedDate | null)[]
} {
  const parts = cells.map(splitDate)
  const numeric = parts.filter((p): p is DateParts => p !== null && p.order === 'x')
  let order: DateOrder | null = null
  if (parts.some((p) => p?.order === 'Y')) order = 'YMD'
  else if (parts.some((p) => p?.order === 'named')) order = 'named'
  else if (numeric.length > 0) order = numeric.some((p) => p.a > 12) ? 'DMY' : 'MDY'
  const dates = parts.map((p): ResolvedDate | null => {
    if (!p) return null
    const date =
      p.order === 'Y' || p.order === 'named'
        ? toLocal(p.a, p.b, p.c)
        : order === 'DMY'
          ? toLocal(p.c, p.b, p.a)
          : toLocal(p.c, p.a, p.b)
    return date ? { date, minute: p.minute } : null
  })
  return { order, dates }
}
