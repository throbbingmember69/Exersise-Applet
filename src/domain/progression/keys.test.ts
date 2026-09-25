import { describe, expect, it } from 'vitest'
import { SHARED_GYM_SCOPE } from '../types'
import { gymScope, parseTrackKey, seriesKey, trackKey } from './keys'

describe('track and series keys', () => {
  it('scopes machines per gym and shares free weights', () => {
    expect(gymScope(true, 'gym-1')).toBe('gym-1')
    expect(gymScope(false, 'gym-1')).toBe(SHARED_GYM_SCOPE)
  })

  it('builds and parses track keys', () => {
    const key = trackKey('day-lower-a', 'ex-leg-extension', 'gym-1')
    expect(key).toBe('day-lower-a|ex-leg-extension|gym-1')
    expect(parseTrackKey(key)).toEqual({
      programDayId: 'day-lower-a',
      exerciseId: 'ex-leg-extension',
      scope: 'gym-1',
    })
  })

  it('keeps the same exercise on two days as separate tracks but one series', () => {
    const a = trackKey('day-lower-a', 'ex-leg-extension', 'gym-1')
    const b = trackKey('day-lower-b', 'ex-leg-extension', 'gym-1')
    expect(a).not.toBe(b)
    expect(seriesKey('ex-leg-extension', 'gym-1')).toBe('ex-leg-extension|gym-1')
  })

  it('rejects ids containing the separator and malformed keys', () => {
    expect(() => trackKey('a|b', 'x', '*')).toThrow(RangeError)
    expect(() => seriesKey('', '*')).toThrow(RangeError)
    expect(() => parseTrackKey('a|b')).toThrow(RangeError)
  })
})
