import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { dropLoad } from './drop'

describe('dropLoad', () => {
  it('drops floor(10% × load ÷ step) whole steps (the spec examples)', () => {
    expect(dropLoad(220, 10, 10, false)).toBe(200)
    expect(dropLoad(230, 10, 10, false)).toBe(210)
    expect(dropLoad(315, 10, 10, false)).toBe(285)
    expect(dropLoad(50, 5, 10, true)).toBe(45)
  })

  it('drops at least one step', () => {
    expect(dropLoad(40, 2.5, 10, false)).toBe(37.5)
    expect(dropLoad(20, 5, 10, false)).toBe(15)
    expect(dropLoad(53, 5, 10, false)).toBe(48)
  })

  it('lets bodyweight-plus go to zero or below (assisted) and clamps everything else at 0', () => {
    expect(dropLoad(0, 5, 10, true)).toBe(-5)
    expect(dropLoad(-20, 5, 10, true)).toBe(-25)
    expect(dropLoad(5, 10, 10, false)).toBe(0)
    expect(dropLoad(0, 5, 10, false)).toBe(0)
  })

  it('is not thrown off by binary error at whole-step boundaries', () => {
    // 17.5% × 700 ÷ 2.5 evaluates to 48.999… in floating point; it is 49 steps.
    expect(dropLoad(700, 2.5, 17.5, false)).toBe(700 - 49 * 2.5)
  })

  it('treats a 0% cut as no cut', () => {
    expect(dropLoad(220, 10, 0, false)).toBe(220)
  })

  it('rejects a non-positive step', () => {
    expect(() => dropLoad(220, 0, 10, false)).toThrow(RangeError)
    expect(() => dropLoad(220, -5, 10, false)).toThrow(RangeError)
  })

  it('always drops a whole number of steps, at least one and no more than pct allows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }),
        fc.constantFrom(1, 2.5, 5, 10),
        fc.double({ min: 1, max: 30, noNaN: true }),
        (k, stepLb, pct) => {
          const base = k * stepLb
          const raw = dropLoad(base, stepLb, pct, true)
          const steps = (base - raw) / stepLb
          expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9)
          expect(steps).toBeGreaterThanOrEqual(1)
          expect(steps).toBeLessThanOrEqual(Math.max(1, (pct / 100) * k + 1e-9))
          expect(dropLoad(base, stepLb, pct, false)).toBe(Math.max(0, raw))
        },
      ),
    )
  })
})
