import { describe, expect, it } from 'vitest'
import { readTable } from './csvRead'
import { parseScaleCsv } from './scaleCsv'
import {
  firstSheetPath,
  isOldExcel,
  isZip,
  readZip,
  rowsToCsv,
  serialToText,
  sheetRows,
  SpreadsheetError,
} from './xlsx'
import {
  makeStrXlsx,
  makeZip,
  strSheetXml,
  WORKBOOK_RELS_XML,
  WORKBOOK_XML,
} from './xlsxTestFixtures'

const SHEET = (data: string) =>
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="2"/></cols><sheetData>${data}</sheetData></worksheet>`

describe('readZip', () => {
  it('lists stored entries with their bytes', () => {
    const zip = makeStrXlsx([['Measure Time', 'Weight(lb)']])
    expect(isZip(zip)).toBe(true)
    const entries = readZip(zip)
    expect(entries.map((e) => [e.name, e.method])).toEqual([
      ['xl/workbook.xml', 0],
      ['xl/_rels/workbook.xml.rels', 0],
      ['xl/worksheets/sheet1.xml', 0],
    ])
    expect(new TextDecoder().decode(entries[0]!.data)).toBe(WORKBOOK_XML)
  })

  it('refuses damaged files and recognizes old .xls files', () => {
    const zip = makeStrXlsx([['a']])
    expect(() => readZip(zip.subarray(0, zip.length - 30))).toThrow(SpreadsheetError)
    expect(() => readZip(new TextEncoder().encode('Date,Weight\n'))).toThrow(SpreadsheetError)
    expect(isZip(new TextEncoder().encode('Date,Weight'))).toBe(false)
    expect(isOldExcel(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1]))).toBe(true)
  })
})

describe('sheetRows', () => {
  it('reads an Arboleaf-style sheet of text cells, decoding XML entities', () => {
    const rows = sheetRows({
      sheetXml: strSheetXml([
        ['Measure Time', 'Weight(lb)', 'Body Fat(%)', 'Note'],
        ['09/26/2026 08:31:01', '163.7', '14.4', 'A&B <x>'],
        ['09/26/2026 08:30:40', '163.7', '- -', ''],
      ]),
    })
    expect(rows).toEqual([
      ['Measure Time', 'Weight(lb)', 'Body Fat(%)', 'Note'],
      ['09/26/2026 08:31:01', '163.7', '14.4', 'A&B <x>'],
      ['09/26/2026 08:30:40', '163.7', '- -', ''],
    ])
  })

  it('reads shared and inline strings, numbers, booleans, gaps and date-styled serials', () => {
    const sharedStringsXml =
      '<sst><si><t>Date</t></si><si><r><t>Weight</t></r><r><t xml:space="preserve"> (kg)</t></r><rPh><t>x</t></rPh></si><si><t/></si><si/><si><t>After</t></si></sst>'
    const stylesXml =
      '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy/mm/dd\\ hh:mm"/><numFmt numFmtId="165" formatCode="0.0&quot;kg&quot;"/></numFmts>' +
      '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>'
    const sheetXml = SHEET(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Ok?</t></is></c></row>' +
        '<row r="2"><c r="A2" s="2"><v>46290.354166666664</v></c><c r="C2" s="3"><v>74.299999999999997</v></c><c r="D2" t="b"><v>1</v></c></row>' +
        '<row r="3"/>' +
        '<row r="4"><c r="A4" s="1"><v>46291</v></c><c r="B4"/><c r="C4"><f>C2+1</f><v>75.3</v></c><c r="D4" t="s"><v>2</v></c><c r="E4" t="s"><v>4</v></c></row>',
    )
    expect(sheetRows({ sheetXml, sharedStringsXml, stylesXml })).toEqual([
      ['Date', '', 'Weight (kg)', 'Ok?'],
      ['2026-09-25 08:30:00', '', '74.3', 'TRUE'],
      ['2026-09-26', '', '75.3', '', 'After'],
    ])
  })

  it('honours the 1904 date system and cells without references', () => {
    const rows = sheetRows({
      sheetXml: SHEET('<row><c s="1"><v>44828</v></c><c t="str"><v>x</v></c></row>'),
      stylesXml:
        '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>',
      workbookXml: '<workbook><workbookPr date1904="1"/></workbook>',
    })
    expect(rows).toEqual([['2026-09-25', 'x']])
  })
})

describe('helpers', () => {
  it('finds the first sheet through the workbook relationships', () => {
    expect(firstSheetPath(WORKBOOK_XML, WORKBOOK_RELS_XML)).toBe('xl/worksheets/sheet1.xml')
    const rels = WORKBOOK_RELS_XML.replace('worksheets/sheet1.xml', '/xl/worksheets/data.xml')
    expect(firstSheetPath(WORKBOOK_XML, rels)).toBe('xl/worksheets/data.xml')
    expect(firstSheetPath(undefined, undefined)).toBe('xl/worksheets/sheet1.xml')
  })

  it('converts date serials', () => {
    expect(serialToText(46290)).toBe('2026-09-25')
    expect(serialToText(46290.5)).toBe('2026-09-25 12:00:00')
    expect(serialToText(46290 + (8 * 3600 + 31 * 60 + 1) / 86400)).toBe('2026-09-25 08:31:01')
  })

  it('writes rows as CSV that reads back identically', () => {
    const rows = [
      ['a,b', 'say "hi"', 'line\nbreak'],
      [' padded ', '163.7', ''],
    ]
    const csv = rowsToCsv(rows)
    expect(readTable(csv)).toMatchObject({ headers: ['a,b', 'say "hi"', 'line\nbreak'] })
    expect(readTable(csv).rows).toEqual([[' padded ', '163.7', '']])
  })

  it('keeps decimal-comma text cells as decimals (semicolon CSV), but not thousands separators', () => {
    const rows = [
      ['Measure Time', 'Weight(kg)', 'Body Fat(%)', 'Note'],
      ['26.09.2026 08:31:01', '74,3', '16,2', 'a;b'],
    ]
    const csv = rowsToCsv(rows)
    expect(csv.startsWith('sep=;\r\n')).toBe(true)
    expect(readTable(csv)).toMatchObject({ decimalComma: true, rows: [rows[1]] })
    const r = parseScaleCsv(csv)
    expect(r.readings[0]).toMatchObject({ date: '2026-09-26', bodyFatPct: 16.2 })
    expect(r.readings[0]!.weightLb).toBeCloseTo(163.8, 1)
    // "1,740" is a thousands separator next to decimal points: stays comma-separated.
    const us = rowsToCsv([
      ['Time', 'Weight(lb)', 'BMR'],
      ['09/26/2026 08:31', '163.7', '1,740'],
    ])
    expect(us.startsWith('sep=,\r\n')).toBe(true)
    expect(readTable(us).decimalComma).toBe(false)
  })

  it('reads namespace-prefixed workbooks (<x:row>, <x:sheet rel:id>)', () => {
    const sheetXml =
      '<x:worksheet xmlns:x="main"><x:sheetData><x:row r="1"><x:c r="A1" t="str"><x:v>Weight(lb)</x:v></x:c></x:row><x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>163.7</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>'
    expect(sheetRows({ sheetXml })).toEqual([['Weight(lb)'], ['163.7']])
    const workbookXml =
      '<x:workbook xmlns:x="main" xmlns:rel="rels"><x:sheets><x:sheet name="Data" sheetId="1" rel:id="rId3"/></x:sheets></x:workbook>'
    const relsXml =
      '<Relationships><Relationship Id="rId3" Type="worksheet" Target="worksheets/data.xml"/></Relationships>'
    expect(firstSheetPath(workbookXml, relsXml)).toBe('xl/worksheets/data.xml')
  })
})

describe('makeZip fixture', () => {
  it('round-trips through readZip', () => {
    const zip = makeZip([{ name: 'a.txt', data: 'hello' }])
    expect(new TextDecoder().decode(readZip(zip)[0]!.data)).toBe('hello')
  })
})
