// Test helpers: build small .xlsx files (zips of XML parts) in memory. Used by tests only.

export interface ZipPart {
  name: string
  /** Stored bytes (already deflated when method is 8). */
  data: Uint8Array | string
  method?: 0 | 8
}

/** A minimal zip: local headers, a central directory and the end record (CRCs left at 0). */
export function makeZip(parts: readonly ZipPart[]): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const p of parts) {
    const name = enc.encode(p.name)
    const data = typeof p.data === 'string' ? enc.encode(p.data) : p.data
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, p.method ?? 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const dir = new Uint8Array(46 + name.length)
    const dv = new DataView(dir.buffer)
    dv.setUint32(0, 0x02014b50, true)
    dv.setUint16(10, p.method ?? 0, true)
    dv.setUint32(20, data.length, true)
    dv.setUint32(24, data.length, true)
    dv.setUint16(28, name.length, true)
    dv.setUint32(42, offset, true)
    dir.set(name, 46)
    chunks.push(local, data)
    central.push(dir)
    offset += local.length + data.length
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, parts.length, true)
  ev.setUint16(10, parts.length, true)
  ev.setUint32(12, dirSize, true)
  ev.setUint32(16, offset, true)
  const all = [...chunks, ...central, end]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of all) {
    out.set(c, at)
    at += c.length
  }
  return out
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A sheet like the Arboleaf export's: every cell a formula-string (t="str") value. */
export function strSheetXml(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map(
      (r, i) =>
        `<row r="${i + 1}">${r
          .map((v, j) => `<c r="${colName(j)}${i + 1}" t="str"><v>${esc(v)}</v></c>`)
          .join('')}</row>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

export const WORKBOOK_XML =
  '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'

export const WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'

/** An .xlsx (stored, uncompressed) with one sheet of text cells, shaped like Arboleaf's. */
export function makeStrXlsx(rows: readonly (readonly string[])[]): Uint8Array {
  return makeZip([
    { name: 'xl/workbook.xml', data: WORKBOOK_XML },
    { name: 'xl/_rels/workbook.xml.rels', data: WORKBOOK_RELS_XML },
    { name: 'xl/worksheets/sheet1.xml', data: strSheetXml(rows) },
  ])
}
