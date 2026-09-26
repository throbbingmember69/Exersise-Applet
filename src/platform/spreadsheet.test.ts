import { describe, expect, it } from 'vitest'
import { SpreadsheetError } from '@/domain/xlsx'
import {
  makeStrXlsx,
  makeZip,
  strSheetXml,
  WORKBOOK_RELS_XML,
  WORKBOOK_XML,
} from '@/domain/xlsxTestFixtures'
import { readTableFile } from './spreadsheet'

async function deflateRaw(text: string): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  const writing = writer.write(new TextEncoder().encode(text)).then(() => writer.close())
  const reader = stream.readable.getReader()
  const chunks: number[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(...value)
  }
  await writing
  return new Uint8Array(chunks)
}

const ROWS = [
  ['Measure Time', 'Weight(lb)', 'Body Fat(%)'],
  ['09/26/2026 08:31:01', '163.7', '14.4'],
  ['09/26/2026 08:30:40', '163.7', '- -'],
]

describe('readTableFile', () => {
  it('returns CSV files as text', async () => {
    const text = 'Date,Energy (kcal)\n2026-09-25,2500\n'
    expect(await readTableFile(new Blob([text]))).toBe(text)
  })

  it('converts an Arboleaf-style .xlsx (stored parts) to CSV', async () => {
    const csv = await readTableFile(new Blob([makeStrXlsx(ROWS) as Uint8Array<ArrayBuffer>]))
    expect(csv).toBe(
      'sep=,\r\nMeasure Time,Weight(lb),Body Fat(%)\r\n09/26/2026 08:31:01,163.7,14.4\r\n09/26/2026 08:30:40,163.7,- -',
    )
  })

  it('inflates deflate-compressed parts', async () => {
    const zip = makeZip([
      { name: 'xl/workbook.xml', data: await deflateRaw(WORKBOOK_XML), method: 8 },
      { name: 'xl/_rels/workbook.xml.rels', data: await deflateRaw(WORKBOOK_RELS_XML), method: 8 },
      { name: 'xl/worksheets/sheet1.xml', data: await deflateRaw(strSheetXml(ROWS)), method: 8 },
    ])
    const csv = await readTableFile(new Blob([zip as Uint8Array<ArrayBuffer>]))
    expect(csv.split('\r\n')).toHaveLength(4)
    expect(csv).toContain('09/26/2026 08:30:40,163.7,- -')
  })

  it('explains old .xls files, damaged files and a missing sheet', async () => {
    await expect(
      readTableFile(new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])])),
    ).rejects.toThrow(/Old \.xls files/)
    const zip = makeStrXlsx(ROWS)
    await expect(
      readTableFile(new Blob([zip.subarray(0, 40) as Uint8Array<ArrayBuffer>])),
    ).rejects.toBeInstanceOf(SpreadsheetError)
    const noSheet = makeZip([{ name: 'xl/workbook.xml', data: WORKBOOK_XML }])
    await expect(readTableFile(new Blob([noSheet as Uint8Array<ArrayBuffer>]))).rejects.toThrow(
      /no sheet/,
    )
  })
})
