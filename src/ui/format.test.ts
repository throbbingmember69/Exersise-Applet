import { describe, expect, it } from 'vitest'
import { kgToLb } from '@/domain/units'
import type { LocalDate, Regime } from '@/domain/types'
import {
  formatClock,
  formatDate,
  formatKcal,
  formatLoad,
  formatRegime,
  formatRest,
  formatSets,
  formatSigned,
} from './format'

const bar = { loadType: 'machine' as const, perHand: false }
const db = { loadType: 'dumbbell' as const, perHand: true }
const chin = { loadType: 'bodyweight_plus' as const, perHand: false }

describe('format', () => {
  it('formats loads the way the lifter reads them', () => {
    expect(formatLoad(220, bar, 'lb')).toBe('220 lb')
    expect(formatLoad(70, db, 'lb')).toBe('70 lb per hand')
    expect(formatLoad(50, chin, 'lb')).toBe('+50 lb')
    expect(formatLoad(-20, chin, 'lb')).toBe('−20 lb')
    expect(formatLoad(0, chin, 'lb')).toBe('BW')
    expect(formatLoad(kgToLb(100), bar, 'kg')).toBe('100 kg')
    expect(formatLoad(null, bar, 'lb')).toBe('—')
  })

  it('formats regimes and rest', () => {
    const r: Regime = {
      sets: 4,
      repMin: 6,
      repMax: 10,
      rirMin: 1,
      rirMax: 2,
      restMinSec: 120,
      restMaxSec: 180,
    }
    expect(formatRegime(r)).toBe('4 × 6–10 · RIR 1–2 · rest 2–3 min')
    expect(formatRegime(r, 2)).toBe('2 × 6–10 · RIR 1–2 · rest 2–3 min')
    expect(formatRest(90, 90)).toBe('90 s')
    expect(formatRest(120, 120)).toBe('2 min')
    expect(formatRest(90, 120)).toBe('1:30–2 min')
    expect(formatRest(45, 50)).toBe('45–50 s')
  })

  it('formats numbers, clocks and set lists', () => {
    expect(formatKcal(3000)).toMatch(/^3.000 kcal$/) // thousands separator depends on locale
    expect(formatSigned(150)).toBe('+150')
    expect(formatSigned(-100)).toBe('−100')
    expect(formatClock(125_000)).toBe('2:05')
    expect(formatClock(-40_000)).toBe('+0:40')
    expect(
      formatSets(
        [
          { loadLb: 220, reps: 10 },
          { loadLb: 220, reps: 9 },
        ],
        bar,
        'lb',
      ),
    ).toBe('220 lb × 10, 9')
    expect(formatSets([{ loadLb: 50, reps: 6 }], chin, 'lb')).toBe('+50 lb × 6')
    expect(
      formatSets(
        [
          { loadLb: 220, reps: 10 },
          { loadLb: 230, reps: 8 },
        ],
        bar,
        'lb',
      ),
    ).toBe('220×10, 230×8 lb')
  })

  it('formats a LocalDate on the right day', () => {
    expect(formatDate('2026-09-28' as LocalDate)).toMatch(/28/)
  })
})
