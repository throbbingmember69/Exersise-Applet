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
})

describe('resolveDates', () => {
  it('reads Y-M-D with times, and decides D/M/Y vs M/D/Y across the column', () => {
    expect(resolveDates(['2026-09-25 07:05', '2026-9-26'])).toEqual({
      order: 'YMD',
      dates: [
        { date: '2026-09-25', minute: 425 },
        { date: '2026-09-26', minute: 0 },
      ],
    })
    expect(resolveDates(['09/10/2026', '25/09/2026']).dates.map((d) => d?.date)).toEqual([
      '2026-10-09',
      '2026-09-25',
    ])
    expect(resolveDates(['09/10/2026 7:05 pm']).dates).toEqual([
      { date: '2026-09-10', minute: 19 * 60 + 5 },
    ])
  })

  it('reads month names and returns null for unreadable or impossible dates', () => {
    expect(resolveDates(['Sep 24, 2026']).dates).toEqual([{ date: '2026-09-24', minute: 0 }])
    expect(resolveDates(['yesterday', '2026-02-30']).dates).toEqual([null, null])
  })
})
