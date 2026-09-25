import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  cmToIn,
  displayToLb,
  formatMass,
  formatMassWithUnit,
  formatRatePerWeek,
  inToCm,
  kgToLb,
  lbToDisplay,
  loadsEqual,
} from './units'

describe('unit conversion', () => {
  it('matches the spec profile conversions', () => {
    expect(lbToDisplay(163, 'kg')).toBeCloseTo(73.94, 2)
    expect(inToCm(71)).toBeCloseTo(180.34, 2)
    expect(cmToIn(inToCm(71))).toBeCloseTo(71, 10)
  })

  it('lb display is the identity and never rounds', () => {
    expect(lbToDisplay(37.5, 'lb')).toBe(37.5)
    expect(displayToLb(220, 'lb')).toBe(220)
  })

  it('formats with trimmed decimals', () => {
    expect(formatMass(220, 'lb')).toBe('220')
    expect(formatMass(37.5, 'lb')).toBe('37.5')
    expect(formatMass(163, 'kg')).toBe('73.9')
    expect(formatMassWithUnit(163, 'lb')).toBe('163 lb')
    expect(formatMass(-0.01, 'lb')).toBe('0')
  })

  it('formats weekly rates as mass per week', () => {
    expect(formatRatePerWeek(0.5, 163, 'lb')).toBe('+0.8 lb/wk')
    expect(formatRatePerWeek(-0.625, 163, 'lb')).toBe('−1 lb/wk')
    expect(formatRatePerWeek(0, 163, 'kg')).toBe('±0 kg/wk')
  })

  it('compares loads with a tolerance', () => {
    expect(loadsEqual(0.1 + 0.2, 0.3)).toBe(true)
    expect(loadsEqual(37.5, 40)).toBe(false)
  })
})

describe('units property: switching lb/kg changes display only', () => {
  it('a whole-kg entry displays back unchanged', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (kg) => {
        const stored = displayToLb(kg, 'kg')
        expect(formatMass(stored, 'kg')).toBe(String(kg))
      }),
    )
  })

  it('a lb entry to 0.5 lb displays back unchanged', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2000 }), (halfPounds) => {
        const lb = halfPounds / 2
        expect(formatMass(displayToLb(lb, 'lb'), 'lb')).toBe(String(lb))
      }),
    )
  })

  it('kg ↔ lb round-trips at full precision', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), (lb) => {
        expect(kgToLb(lbToDisplay(lb, 'kg'))).toBeCloseTo(lb, 9)
      }),
    )
  })
})
