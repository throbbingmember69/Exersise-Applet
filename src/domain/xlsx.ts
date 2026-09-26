// Reading the first sheet of an Excel .xlsx file (the Arboleaf app exports one) as rows of text,
// without a library: an .xlsx is a zip of XML parts. This module finds the parts in the zip and
// turns the sheet XML into rows; inflating compressed parts is async and lives in
// `platform/spreadsheet.ts`.
//
// Cells: shared strings, inline strings, formula results (cached values), booleans and numbers.
// A number whose cell style is a date format becomes "YYYY-MM-DD HH:MM:SS" text, so the CSV
// importers read it like any other date. Only what the importers need is supported: no merged
// cells, rich formatting or multiple sheets.

export class SpreadsheetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpreadsheetError'
  }
}

// ── Zip ─────────────────────────────────────────────────────────────────────

export interface ZipEntry {
  name: string
  /** 0 = stored, 8 = deflate. */
  method: number
  /** The entry's bytes as stored in the zip (compressed when method is 8). */
  data: Uint8Array
}

/** A zip file starts with a local file header ("PK\x03\x04"). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/** An old binary Excel (.xls) file starts with the OLE2 signature. */
export function isOldExcel(bytes: Uint8Array): boolean {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

/** List a zip's entries from its central directory. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)
  const bad = () => new SpreadsheetError('This file is damaged or isn’t a spreadsheet.')

  // The end-of-central-directory record is in the last 22 + 65,535 (comment) bytes.
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw bad()
  const count = u16(eocd + 10)
  let at = u32(eocd + 16)
  const names = new TextDecoder()
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(at) !== 0x02014b50) throw bad()
    const method = u16(at + 10)
    const compressed = u32(at + 20)
    const nameLen = u16(at + 28)
    const extraLen = u16(at + 30)
    const commentLen = u16(at + 32)
    const local = u32(at + 42)
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLen))
    if (compressed === 0xffffffff || local === 0xffffffff) {
      throw new SpreadsheetError('This spreadsheet is too large to open here.')
    }
    if (local + 30 > bytes.length || u32(local) !== 0x04034b50) throw bad()
    const start = local + 30 + u16(local + 26) + u16(local + 28)
    if (start + compressed > bytes.length) throw bad()
    entries.push({ name, method, data: bytes.subarray(start, start + compressed) })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

// ── XML ─────────────────────────────────────────────────────────────────────

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[ref] ?? whole
  })
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1]!] = decodeXml(m[2] ?? m[3] ?? '')
  }
  return out
}

/** The text of every <t> element (skipping phonetic <rPh> runs). */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of clean.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g))
    out += decodeXml(m[1] ?? '')
  return out
}

/** Drop namespace prefixes from element names (<x:row> → <row>); some generators write them. */
function unprefix(xml: string): string {
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1')
}

// ── Workbook parts ──────────────────────────────────────────────────────────

/** Zip path of the workbook's first sheet (via workbook.xml and its relationships). */
export function firstSheetPath(
  workbookXml: string | undefined,
  relsXml: string | undefined,
): string {
  const fallback = 'xl/worksheets/sheet1.xml'
  const sheet = workbookXml && unprefix(workbookXml).match(/<sheet\b[^>]*>/)?.[0]
  // The relationship id is "r:id" by convention, but any namespace prefix is allowed.
  const id = sheet
    ? Object.entries(attrs(sheet)).find(([k]) => /^[\w.-]+:id$/.test(k))?.[1]
    : undefined
  if (!id || !relsXml) return fallback
  for (const m of unprefix(relsXml).matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0])
    if (a.Id !== id || !a.Target) continue
    const target = a.Target
    return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  }
  return fallback
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  // Self-closing <si/> first, so it isn't read as an opening tag.
  return [...xml.matchAll(/<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    textOf(m[1] ?? ''),
  )
}

/** Built-in number formats that show dates or times. */
function builtinDate(id: number): boolean {
  return (
    (id >= 14 && id <= 22) ||
    (id >= 27 && id <= 36) ||
    (id >= 45 && id <= 47) ||
    (id >= 50 && id <= 58)
  )
}

function customDate(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]/gi, '')
  return /[dmyhs]/i.test(bare)
}

/** For each cell style index: does it format numbers as a date/time? */
function dateStyles(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return []
  const custom = new Map<number, string>()
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const a = attrs(m[0])
    if (a.numFmtId && a.formatCode !== undefined) custom.set(Number(a.numFmtId), a.formatCode)
  }
  const xfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attrs(m[0]).numFmtId ?? 0)
    const code = custom.get(id)
    return code !== undefined ? customDate(code) : builtinDate(id)
  })
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** An Excel date serial as "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" (the wall-clock time stored). */
export function serialToText(serial: number, date1904 = false): string {
  const days = serial + (date1904 ? 1462 : 0)
  const seconds = Math.round((days - 25569) * 86400)
  const d = new Date(seconds * 1000)
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  if (seconds % 86400 === 0) return date
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function columnIndex(ref: string): number | null {
  const letters = /^([A-Z]+)/i.exec(ref)?.[1]
  if (!letters) return null
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export interface SheetParts {
  sheetXml: string
  sharedStringsXml?: string
  stylesXml?: string
  workbookXml?: string
}

/** The sheet's rows as text cells (missing cells are ''; empty rows are kept out). */
export function sheetRows(parts: SheetParts): string[][] {
  const shared = sharedStrings(parts.sharedStringsXml && unprefix(parts.sharedStringsXml))
  const isDate = dateStyles(parts.stylesXml && unprefix(parts.stylesXml))
  const date1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*["'](1|true)["']/.test(
    unprefix(parts.workbookXml ?? ''),
  )
  const sheetXml = unprefix(parts.sheetXml)
  const data = sheetXml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/)?.[1] ?? ''
  const rows: string[][] = []
  for (const row of data.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = []
    let next = 0
    for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(c[1] ?? '')
      const col = (a.r ? columnIndex(a.r) : null) ?? next
      next = col + 1
      const body = c[2] ?? ''
      const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]
      let text = ''
      switch (a.t) {
        case 's':
          text = v !== undefined ? (shared[Number(v)] ?? '') : ''
          break
        case 'inlineStr':
          text = textOf(body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? '')
          break
        case 'b':
          text = v === undefined ? '' : v.trim() === '1' ? 'TRUE' : 'FALSE'
          break
        case 'str':
        case 'e':
        case 'd':
          text = v !== undefined ? decodeXml(v) : ''
          break
        default: {
          if (v === undefined || v.trim() === '') break
          const n = Number(v)
          if (!Number.isFinite(n)) text = decodeXml(v)
          else if (a.s !== undefined && isDate[Number(a.s)]) text = serialToText(n, date1904)
          else text = String(n)
        }
      }
      while (cells.length < col) cells.push('')
      cells[col] = text
    }
    if (cells.some((x) => x.trim() !== '')) rows.push(cells)
  }
  return rows
}

/** "74,3" (not "1,740", a thousands separator) and "74.3". */
const DECIMAL_COMMA = /^-?\d+,\d{1,2}$/
const DECIMAL_POINT = /^-?\d+\.\d+$/

/**
 * Rows as CSV text for the CSV importers, starting with a "sep=" line so the delimiter isn't
 * guessed again. When text cells use decimal commas ("74,3") and no cell has a decimal point,
 * it's semicolon-separated, which the importers read as decimal-comma numbers.
 */
export function rowsToCsv(rows: readonly (readonly string[])[]): string {
  const values = rows.slice(1).flat()
  const decimalComma =
    values.some((v) => DECIMAL_COMMA.test(v.trim())) &&
    !values.some((v) => DECIMAL_POINT.test(v.trim()))
  const delimiter = decimalComma ? ';' : ','
  const needsQuotes = decimalComma ? /[";\r\n]|^\s|\s$/ : /[",\r\n]|^\s|\s$/
  const cell = (s: string) => (needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return [`sep=${delimiter}`, ...rows.map((r) => r.map(cell).join(delimiter))].join('\r\n')
}
