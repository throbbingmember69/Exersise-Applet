import { describe, expect, it } from 'vitest'
import { readTable, resolveDates } from './csvRead'

describe('readTable', () => {
  it('strips a BOM, trims headers and detects the delimiter', () => {
    expect(readTable('\uFEFF Date ,Energy (kcal)\n2026-09-25,2500\n\n')).toEqual({
      headers: ['Date', 'Energy (kcal)'],
      rows: [['2026-09-25', '2500']],
      decimalComma: false,
    })
    const semi = readTable('Date;Fat (g)\r\n2026-09-25;80,5')
    expect(semi.decimalComma).toBe(true)
    expect(semi.rows).toEqual([['2026-09-25', '80,5']])
    expect(readTable('Date\tFat (g)\n2026-09-25\t80').rows).toEqual([['2026-09-25', '80']])
  })

  it('uses the delimiter a "sep=" first line names, and drops that line', () => {
    expect(readTable('sep=;\r\nDate;Fat (g)\r\n2026-09-25;80,5')).toEqual({
      headers: ['Date', 'Fat (g)'],
      rows: [['2026-09-25', '80,5']],
      decimalComma: true,
    })
    // A header with more semicolons than commas is still split on commas when told to.
    expect(readTable('sep=,\nNote; a; b,Weight\nx,1').headers).toEqual(['Note; a; b', 'Weight'])
  })
})

describe('resolveDates', () => {
  it('reads Y-M-D with times, and decides D/M/Y vs M/D/Y across the column', () => {
    expect(resolveDates(['2026-09-25 07:05:30', '2026-9-26'])).toEqual({
      order: 'YMD',
      dates: [
        { date: '2026-09-25', second: 425 * 60 + 30 },
        { date: '2026-09-26', second: 0 },
      ],
    })
    expect(resolveDates(['09/10/2026', '25/09/2026']).dates.map((d) => d?.date)).toEqual([
      '2026-10-09',
      '2026-09-25',
    ])
    expect(resolveDates(['09/26/2026 08:31:01', '09/10/2026 7:05 pm']).dates).toEqual([
      { date: '2026-09-26', second: 8 * 3600 + 31 * 60 + 1 },
      { date: '2026-09-10', second: (19 * 60 + 5) * 60 },
    ])
  })

  it('reads month names and returns null for unreadable or impossible dates', () => {
    expect(resolveDates(['Sep 24, 2026']).dates).toEqual([{ date: '2026-09-24', second: 0 }])
    expect(resolveDates(['yesterday', '2026-02-30']).dates).toEqual([null, null])
  })
})
