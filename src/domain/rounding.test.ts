import { describe, expect, it } from 'vitest'
import { clamp, mean, roundHalfAway, roundToStep } from './rounding'

describe('roundHalfAway', () => {
  it('rounds halves away from zero', () => {
    expect(roundHalfAway(2.5)).toBe(3)
    expect(roundHalfAway(-2.5)).toBe(-3)
    expect(roundHalfAway(-10.5)).toBe(-11)
    expect(roundHalfAway(2.4)).toBe(2)
  })

  it('rounds to decimals, including binary-inexact halves', () => {
    expect(roundHalfAway(1.005, 2)).toBe(1.01)
    expect(roundHalfAway(37.45, 1)).toBe(37.5)
    expect(roundHalfAway(-0.05, 1)).toBe(-0.1)
  })
})

describe('roundToStep', () => {
  it('rounds kcal to 50 and protein to 5 as in the spec', () => {
    expect(roundToStep(2712.6, 50)).toBe(2700)
    expect(roundToStep(3018.2, 50)).toBe(3000)
    expect(roundToStep(2203.2, 50)).toBe(2200)
    expect(roundToStep(147.9, 5)).toBe(150)
    expect(roundToStep(171.1, 5)).toBe(170)
    expect(roundToStep(2725, 50)).toBe(2750)
    expect(roundToStep(-75, 50)).toBe(-100)
  })

  it('rejects non-positive steps', () => {
    expect(() => roundToStep(10, 0)).toThrow(RangeError)
  })
})

describe('clamp and mean', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })

  it('averages and returns null for empty input', () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(mean([])).toBeNull()
  })
})
