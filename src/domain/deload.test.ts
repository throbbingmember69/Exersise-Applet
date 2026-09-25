import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, resolveSettings } from '@/domain/settings/registry'
import { deloadStatus, deloadTrigger } from './deload'

const S = DEFAULT_SETTINGS
const sessions = (...pain: boolean[]) => pain.map((jointPain, i) => ({ id: `s${i}`, jointPain }))

describe('deloadTrigger', () => {
  it('suggests a deload at 3 concurrent stalls, with a sorted, de-duplicated fingerprint', () => {
    const r = deloadTrigger(
      {
        stalledSeries: ['ex-ohp|*', 'ex-smith-squat|gym-1', 'ex-deadlift|*', 'ex-ohp|*'],
        recentSessions: sessions(false, false, false),
      },
      S,
    )
    expect(r).toEqual({
      suggest: true,
      reasons: ['stalls'],
      fingerprint: 'deload;stalls=ex-deadlift|*,ex-ohp|*,ex-smith-squat|gym-1',
    })
  })

  it('does not suggest at 2 stalls', () => {
    expect(
      deloadTrigger({ stalledSeries: ['a|*', 'b|*'], recentSessions: sessions(false) }, S),
    ).toEqual({ suggest: false, reasons: [], fingerprint: null })
  })

  it('suggests on joint pain in 2 of the last 3 sessions (oldest first)', () => {
    const r = deloadTrigger(
      { stalledSeries: [], recentSessions: sessions(false, true, false, true) },
      S,
    )
    expect(r).toEqual({
      suggest: true,
      reasons: ['joint_pain'],
      fingerprint: 'deload;joint_pain=s1,s3',
    })
  })

  it('ignores joint pain older than the window', () => {
    const r = deloadTrigger(
      { stalledSeries: [], recentSessions: sessions(true, true, false, false) },
      S,
    )
    expect(r.suggest).toBe(false)
  })

  it('reports both reasons', () => {
    const r = deloadTrigger(
      { stalledSeries: ['a|*', 'b|*', 'c|*'], recentSessions: sessions(true, true) },
      S,
    )
    expect(r.reasons).toEqual(['stalls', 'joint_pain'])
    expect(r.fingerprint).toBe('deload;stalls=a|*,b|*,c|*;joint_pain=s0,s1')
  })

  it('uses the configured thresholds', () => {
    const s = resolveSettings({
      deloadStallCount: 2,
      deloadJointPainHits: 1,
      deloadJointPainWindow: 1,
    })
    expect(deloadTrigger({ stalledSeries: ['a|*', 'b|*'], recentSessions: [] }, s).suggest).toBe(
      true,
    )
    expect(
      deloadTrigger({ stalledSeries: [], recentSessions: sessions(true, false) }, s).suggest,
    ).toBe(false)
    expect(
      deloadTrigger({ stalledSeries: [], recentSessions: sessions(false, true) }, s).suggest,
    ).toBe(true)
  })

  it('handles an empty joint-pain window', () => {
    const s = { ...S, deloadJointPainWindow: 0, deloadJointPainHits: 1 }
    expect(deloadTrigger({ stalledSeries: [], recentSessions: sessions(true) }, s).suggest).toBe(
      false,
    )
  })
})

describe('deloadStatus', () => {
  it('is inactive when no deload was accepted', () => {
    expect(deloadStatus({ acceptedAt: null, endedAt: null, deloadSessionsSince: 0 }, S)).toEqual({
      active: false,
      remaining: 0,
      total: 5,
    })
  })

  it('runs for 5 deload sessions', () => {
    const status = (n: number) =>
      deloadStatus({ acceptedAt: 1_000, endedAt: null, deloadSessionsSince: n }, S)
    expect(status(0)).toEqual({ active: true, remaining: 5, total: 5 })
    expect(status(2)).toEqual({ active: true, remaining: 3, total: 5 })
    expect(status(4)).toEqual({ active: true, remaining: 1, total: 5 })
    expect(status(5)).toEqual({ active: false, remaining: 0, total: 5 })
  })

  it('ends early when ended after it was accepted, but not by an older end', () => {
    expect(
      deloadStatus({ acceptedAt: 1_000, endedAt: 2_000, deloadSessionsSince: 1 }, S).active,
    ).toBe(false)
    expect(deloadStatus({ acceptedAt: 1_000, endedAt: 500, deloadSessionsSince: 1 }, S)).toEqual({
      active: true,
      remaining: 4,
      total: 5,
    })
  })

  it('uses the configured length', () => {
    const s = resolveSettings({ deloadSessions: 3 })
    expect(deloadStatus({ acceptedAt: 1, endedAt: null, deloadSessionsSince: 2 }, s)).toEqual({
      active: true,
      remaining: 1,
      total: 3,
    })
  })
})
