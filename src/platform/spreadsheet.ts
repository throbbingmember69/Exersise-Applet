// Reading an import file chosen by the user as CSV text: CSV/TSV files as they are, and Excel
// .xlsx files (the Arboleaf app's export) converted from their first sheet. Compressed .xlsx parts
// are inflated with the browser's DecompressionStream (Chrome 80+), so no zip library is needed.
import {
  firstSheetPath,
  isOldExcel,
  isZip,
  readZip,
  rowsToCsv,
  sheetRows,
  SpreadsheetError,
  type ZipEntry,
} from '@/domain/xlsx'

/** The file picker's `accept` list for import files. */
export const IMPORT_FILE_ACCEPT =
  '.csv,.tsv,.txt,.xlsx,text/csv,text/plain,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function inflate(entry: ZipEntry): Promise<Uint8Array> {
  if (entry.method === 0) return entry.data
  if (entry.method !== 8) {
    throw new SpreadsheetError('This spreadsheet uses a compression this app can’t read.')
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new SpreadsheetError('This browser can’t open Excel files. Export a CSV instead.')
  }
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  // Write and read concurrently so a large part can't stall on backpressure.
  const writing = writer
    .write(entry.data as Uint8Array<ArrayBuffer>)
    .then(() => writer.close())
    .catch(() => undefined)
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      length += value.length
    }
  } catch {
    throw new SpreadsheetError('This file is damaged or isn’t a spreadsheet.')
  }
  await writing
  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

async function readXlsx(bytes: Uint8Array): Promise<string> {
  const entries = new Map(readZip(bytes).map((e) => [e.name, e]))
  const decoder = new TextDecoder()
  const part = async (name: string) => {
    const e = entries.get(name)
    return e ? decoder.decode(await inflate(e)) : undefined
  }
  const workbookXml = await part('xl/workbook.xml')
  const sheetPath = firstSheetPath(workbookXml, await part('xl/_rels/workbook.xml.rels'))
  const sheetXml = await part(sheetPath)
  if (sheetXml === undefined) throw new SpreadsheetError('This spreadsheet has no sheet to read.')
  const rows = sheetRows({
    sheetXml,
    sharedStringsXml: await part('xl/sharedStrings.xml'),
    stylesXml: await part('xl/styles.xml'),
    workbookXml,
  })
  return rowsToCsv(rows)
}

/** A chosen import file as CSV text (an .xlsx file's first sheet is converted). */
export async function readTableFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isZip(bytes)) return readXlsx(bytes)
  if (isOldExcel(bytes)) {
    throw new SpreadsheetError('Old .xls files aren’t supported. Save it as .xlsx or CSV.')
  }
  return new TextDecoder().decode(bytes)
}
