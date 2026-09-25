import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  isSettingKey,
  outOfEvidenceRange,
  resolveSettings,
  SETTINGS_REGISTRY,
  type SettingKey,
} from './registry'

// Every row of the spec's "Default settings" table, with the tag it's given there.
const SPEC_DEFAULTS: { row: string; keys: [SettingKey, number][]; tag: 'Evidence' | 'Heuristic' }[] = [
  { row: 'Activity factor', keys: [['activityFactor', 1.55]], tag: 'Heuristic' },
  { row: 'Trend smoothing α', keys: [['trendAlpha', 0.1]], tag: 'Heuristic' },
  { row: 'Energy per lb of trend change', keys: [['kcalPerLb', 3500]], tag: 'Heuristic' },
  {
    row: 'Maintenance window',
    keys: [
      ['tdeeWindowMinDays', 14],
      ['tdeeWindowMaxDays', 21],
      ['tdeeMinLoggedPct', 80],
    ],
    tag: 'Heuristic',
  },
  { row: 'Max weekly target change', keys: [['tdeeMaxWeeklyChangeKcal', 150]], tag: 'Heuristic' },
  {
    row: 'Bulk rate band',
    keys: [
      ['bulkRateMinPct', 0.25],
      ['bulkRateMaxPct', 0.5],
    ],
    tag: 'Evidence',
  },
  {
    row: 'Cut rate band',
    keys: [
      ['cutRateMinPct', -0.75],
      ['cutRateMaxPct', -0.5],
    ],
    tag: 'Evidence',
  },
  {
    row: 'Maintenance band',
    keys: [
      ['maintRateMinPct', -0.25],
      ['maintRateMaxPct', 0.25],
    ],
    tag: 'Heuristic',
  },
  { row: 'Bulk protein', keys: [['bulkProteinGPerKgBw', 2.0]], tag: 'Evidence' },
  { row: 'Cut protein', keys: [['cutProteinGPerKgLbm', 2.7]], tag: 'Evidence' },
  { row: 'Fat share', keys: [['fatPct', 25]], tag: 'Evidence' },
  {
    row: 'Weekly volume band',
    keys: [
      ['weeklyVolumeMin', 10],
      ['weeklyVolumeMax', 20],
    ],
    tag: 'Evidence',
  },
  { row: 'Session cap', keys: [['sessionCap', 11]], tag: 'Evidence' },
  { row: 'Stall window', keys: [['stallWindow', 3]], tag: 'Heuristic' },
  {
    row: 'Miss rule',
    keys: [
      ['missesBeforeDrop', 2],
      ['dropPct', 10],
    ],
    tag: 'Heuristic',
  },
  { row: 'Bulk body-fat ceiling', keys: [['bulkBfCeilingPct', 18]], tag: 'Heuristic' },
  { row: 'Cut body-fat target', keys: [['cutBfTargetPct', 12]], tag: 'Heuristic' },
  {
    row: 'Max bulk / cut length',
    keys: [
      ['bulkMaxWeeks', 26],
      ['cutMaxWeeks', 16],
    ],
    tag: 'Heuristic',
  },
]

describe('settings registry', () => {
  it('has unique keys', () => {
    const keys = SETTINGS_REGISTRY.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each(SPEC_DEFAULTS)('maps the spec row "$row" with its default and tag', ({ keys, tag }) => {
    for (const [key, value] of keys) {
      const meta = SETTINGS_REGISTRY.find((m) => m.key === key)
      expect(meta, key).toBeDefined()
      expect(meta!.default).toBe(value)
      expect(meta!.tag).toBe(tag)
      expect(DEFAULT_SETTINGS[key]).toBe(value)
    }
  })

  it('makes every setting editable: a real range containing the default', () => {
    // Acceptance: "Every setting tagged Heuristic is editable" (Evidence ones are too).
    for (const m of SETTINGS_REGISTRY) {
      expect(m.min, m.key).toBeLessThan(m.max)
      expect(m.step, m.key).toBeGreaterThan(0)
      expect(m.default, m.key).toBeGreaterThanOrEqual(m.min)
      expect(m.default, m.key).toBeLessThanOrEqual(m.max)
      expect(m.help.length, m.key).toBeGreaterThan(0)
    }
  })

  it('gives Evidence settings an evidence range that contains the default', () => {
    for (const m of SETTINGS_REGISTRY) {
      if (m.tag !== 'Evidence') continue
      expect('evidenceRange' in m, m.key).toBe(true)
      expect(outOfEvidenceRange(m.key, m.default), m.key).toBe(false)
    }
  })

  it('keeps rate bands ordered numerically', () => {
    const s = DEFAULT_SETTINGS
    expect(s.bulkRateMinPct).toBeLessThan(s.bulkRateMaxPct)
    expect(s.cutRateMinPct).toBeLessThan(s.cutRateMaxPct)
    expect(s.maintRateMinPct).toBeLessThan(s.maintRateMaxPct)
    expect(s.tdeeWindowMinDays).toBeLessThanOrEqual(s.tdeeWindowMaxDays)
  })
})

describe('resolveSettings', () => {
  it('merges stored overrides over defaults', () => {
    const s = resolveSettings({ activityFactor: 1.6 })
    expect(s.activityFactor).toBe(1.6)
    expect(s.trendAlpha).toBe(0.1)
  })

  it('ignores unknown keys and non-numeric values, and clamps to bounds', () => {
    const s = resolveSettings({ nope: 5, trendAlpha: 'x', dropPct: 99, activityFactor: Number.NaN })
    expect(isSettingKey('nope')).toBe(false)
    expect('nope' in s).toBe(false)
    expect(s.trendAlpha).toBe(0.1)
    expect(s.dropPct).toBe(20)
    expect(s.activityFactor).toBe(1.55)
  })

  it('returns defaults for empty input and freezes the result', () => {
    expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(Object.isFrozen(resolveSettings({}))).toBe(true)
  })

  it('flags Evidence values set outside their range', () => {
    expect(outOfEvidenceRange('bulkProteinGPerKgBw', 2.5)).toBe(true)
    expect(outOfEvidenceRange('bulkProteinGPerKgBw', 1.8)).toBe(false)
    expect(outOfEvidenceRange('activityFactor', 2)).toBe(false)
  })
})
