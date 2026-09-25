import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { PhaseType } from '@/domain/types'
import { nextPhaseType, phaseSwitchPrompt, type PhaseSwitchInput } from './phaseSwitch'

const s = DEFAULT_SETTINGS

const PHASES = {
  bulk: { type: 'bulk', plannedWeeks: 20, maxWeeks: 26, bfCeilingPct: 18, bfTargetPct: null },
  cut: { type: 'cut', plannedWeeks: 14, maxWeeks: 16, bfCeilingPct: null, bfTargetPct: 12 },
  maintenance: {
    type: 'maintenance',
    plannedWeeks: 4,
    maxWeeks: 4,
    bfCeilingPct: null,
    bfTargetPct: null,
  },
} as const satisfies Record<PhaseType, PhaseSwitchInput['phase']>

function prompt(type: PhaseType, weekIndex: number, extra: Partial<PhaseSwitchInput> = {}) {
  return phaseSwitchPrompt(
    { phase: PHASES[type], weekIndex, smoothedBf: null, strength: null, ...extra },
    s,
  )
}

const smoothed = (pct: number) => ({ pct, quality: 'smoothed' as const })

describe('bulk prompts', () => {
  it('stays quiet before the planned length', () => {
    expect(prompt('bulk', 19, { smoothedBf: smoothed(17.9) })).toBeNull()
  })

  it('gives a soft note at the planned length and a firm prompt at the maximum', () => {
    expect(prompt('bulk', 20)).toEqual({
      kind: 'end_bulk',
      severity: 'soft',
      reasons: ['planned_length'],
      suggestedNext: 'maintenance',
    })
    expect(prompt('bulk', 25)?.severity).toBe('soft')
    expect(prompt('bulk', 26)).toEqual({
      kind: 'end_bulk',
      severity: 'firm',
      reasons: ['max_length'],
      suggestedNext: 'maintenance',
    })
  })

  it('prompts firmly at any week once smoothed body fat reaches the ceiling', () => {
    expect(prompt('bulk', 5, { smoothedBf: smoothed(18) })).toEqual({
      kind: 'end_bulk',
      severity: 'firm',
      reasons: ['bf_ceiling'],
      suggestedNext: 'maintenance',
    })
    expect(prompt('bulk', 21, { smoothedBf: smoothed(18.5) })?.reasons).toEqual([
      'planned_length',
      'bf_ceiling',
    ])
  })

  it('ignores a single body-fat reading and a strength slide', () => {
    expect(prompt('bulk', 5, { smoothedBf: { pct: 25, quality: 'single' } })).toBeNull()
    expect(prompt('bulk', 5, { strength: { triggered: true } })).toBeNull()
  })

  it('uses the phase’s own ceiling, falling back to the setting', () => {
    const own = { ...PHASES.bulk, bfCeilingPct: 20 }
    expect(
      phaseSwitchPrompt({ phase: own, weekIndex: 5, smoothedBf: smoothed(19), strength: null }, s),
    ).toBeNull()
    const none = { ...PHASES.bulk, bfCeilingPct: null }
    expect(
      phaseSwitchPrompt({ phase: none, weekIndex: 5, smoothedBf: smoothed(18), strength: null }, s)
        ?.reasons,
    ).toEqual(['bf_ceiling'])
  })
})

describe('cut prompts', () => {
  it('gives a soft note at 14 weeks and a firm prompt at 16', () => {
    expect(prompt('cut', 13)).toBeNull()
    expect(prompt('cut', 14)).toMatchObject({ kind: 'end_cut', severity: 'soft' })
    expect(prompt('cut', 16)).toMatchObject({ severity: 'firm', reasons: ['max_length'] })
  })

  it('prompts firmly at the body-fat target or on a strength slide', () => {
    expect(prompt('cut', 4, { smoothedBf: smoothed(12.1) })).toBeNull()
    expect(prompt('cut', 4, { smoothedBf: smoothed(12) })?.reasons).toEqual(['bf_target'])
    expect(prompt('cut', 4, { strength: { triggered: false } })).toBeNull()
    expect(prompt('cut', 4, { strength: { triggered: true } })).toEqual({
      kind: 'end_cut',
      severity: 'firm',
      reasons: ['strength_slide'],
      suggestedNext: 'maintenance',
    })
    expect(
      prompt('cut', 16, { smoothedBf: smoothed(11), strength: { triggered: true } })?.reasons,
    ).toEqual(['max_length', 'bf_target', 'strength_slide'])
  })

  it('falls back to the settings target when the phase has none', () => {
    const none = { ...PHASES.cut, bfTargetPct: null }
    expect(
      phaseSwitchPrompt({ phase: none, weekIndex: 4, smoothedBf: smoothed(12), strength: null }, s)
        ?.reasons,
    ).toEqual(['bf_target'])
  })
})

describe('maintenance prompts', () => {
  it('prompts firmly at the maintenance length and suggests the flowchart’s next phase', () => {
    expect(prompt('maintenance', 3)).toBeNull()
    expect(prompt('maintenance', 4, { lastNonMaintenanceType: 'bulk' })).toEqual({
      kind: 'end_maintenance',
      severity: 'firm',
      reasons: ['maintenance_length'],
      suggestedNext: 'cut',
    })
    expect(prompt('maintenance', 4, { lastNonMaintenanceType: 'cut' })?.suggestedNext).toBe('bulk')
    expect(prompt('maintenance', 4)?.suggestedNext).toBe('bulk')
  })

  it('ignores body fat and strength', () => {
    expect(
      prompt('maintenance', 2, { smoothedBf: smoothed(30), strength: { triggered: true } }),
    ).toBeNull()
  })
})

describe('nextPhaseType', () => {
  it('follows bulk → maintenance → cut → maintenance → bulk', () => {
    expect(nextPhaseType('bulk', null)).toBe('maintenance')
    expect(nextPhaseType('maintenance', 'bulk')).toBe('cut')
    expect(nextPhaseType('cut', 'bulk')).toBe('maintenance')
    expect(nextPhaseType('maintenance', 'cut')).toBe('bulk')
    expect(nextPhaseType('maintenance', null)).toBe('bulk')
  })
})
