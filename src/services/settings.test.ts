import { afterEach, describe, expect, it } from 'vitest'
import { DB_TABLES } from '@/db/schema'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import { SEED, SEED_VERSION } from '@/seed'
import { createTestCtx } from './context'
import {
  getAppState,
  loadProfile,
  loadSettingOverrides,
  loadSettings,
  resetSettings,
  setAppState,
  updateProfile,
  updateSettings,
} from './settings'

const ctxs: ReturnType<typeof createTestCtx>[] = []
function ctx(opts?: Parameters<typeof createTestCtx>[0]) {
  const c = createTestCtx(opts)
  ctxs.push(c)
  return c
}

afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

describe('first-launch seed', () => {
  it('writes the spec profile, baseline, library, program and start loads', async () => {
    const c = ctx()
    expect(await c.db.profile.toArray()).toEqual([SEED.profile])
    expect(await c.db.bodyEntries.toArray()).toEqual([...SEED.bodyEntries])
    expect(await c.db.exercises.count()).toBe(SEED.exercises.length)
    expect(await c.db.programDays.count()).toBe(5)
    expect(await c.db.programSlots.count()).toBe(34)
    expect(await c.db.trackStarts.count()).toBe(SEED.trackStarts.length)
    expect(await c.db.muscles.count()).toBe(13)
    expect(await c.db.gyms.count()).toBe(1)
    expect(await getAppState(c, 'seedVersion')).toBe(SEED_VERSION)
    expect(await loadSettingOverrides(c)).toEqual({})
  })

  it('leaves session, nutrition and phase tables empty', async () => {
    const c = ctx()
    for (const t of ['sessions', 'setLogs', 'nutritionEntries', 'phases', 'checkIns'] as const) {
      expect(await c.db.table(t).count(), t).toBe(0)
    }
  })

  it('can create an empty database', async () => {
    const c = ctx({ seed: false })
    for (const t of DB_TABLES) expect(await c.db.table(t).count(), t).toBe(0)
  })

  it('never mutates the shared seed constants', async () => {
    const before = JSON.stringify(SEED)
    const c = ctx()
    await c.db.profile.update('me', { name: 'changed' })
    expect(JSON.stringify(SEED)).toBe(before)
  })
})

describe('settings', () => {
  it('resolves to the registry defaults on a fresh database', async () => {
    expect(await loadSettings(ctx())).toEqual(DEFAULT_SETTINGS)
  })

  it('stores overrides and drops them when set back to the default', async () => {
    const c = ctx()
    await updateSettings(c, { activityFactor: 1.6, dropPct: 7.5 })
    expect(await loadSettingOverrides(c)).toEqual({ activityFactor: 1.6, dropPct: 7.5 })
    expect((await loadSettings(c)).activityFactor).toBe(1.6)
    await updateSettings(c, { activityFactor: 1.55 })
    expect(await loadSettingOverrides(c)).toEqual({ dropPct: 7.5 })
  })

  it('rejects unknown keys and out-of-bounds values without writing', async () => {
    const c = ctx()
    await expect(updateSettings(c, { dropPct: 50 })).rejects.toThrow(/between 5 and 20/)
    await expect(
      updateSettings(c, { nope: 1 } as unknown as Parameters<typeof updateSettings>[1]),
    ).rejects.toMatchObject({ code: 'unknown_setting' })
    await expect(updateSettings(c, { dropPct: Number.NaN })).rejects.toMatchObject({
      code: 'invalid_setting',
    })
    expect(await loadSettingOverrides(c)).toEqual({})
  })

  it('snaps values to the registry step so integer settings stay integers', async () => {
    const c = ctx()
    await updateSettings(c, { cutStepsAlternative: 2100.5, activityFactor: 1.6123, dropPct: 7.3 })
    expect(await loadSettingOverrides(c)).toEqual({
      cutStepsAlternative: 2000,
      activityFactor: 1.6,
      dropPct: 7.5,
    })
  })

  it('resets some or all overrides', async () => {
    const c = ctx()
    await updateSettings(c, { activityFactor: 1.6, dropPct: 7.5 })
    await resetSettings(c, ['dropPct'])
    expect(await loadSettingOverrides(c)).toEqual({ activityFactor: 1.6 })
    await resetSettings(c)
    expect(await loadSettingOverrides(c)).toEqual({})
  })
})

describe('profile', () => {
  it('acceptance: switching lb/kg changes only profile.units, never stored data', async () => {
    const c = ctx()
    const snapshot = async () => {
      const out: Record<string, unknown> = {}
      for (const t of DB_TABLES) out[t] = await c.db.table(t).toArray()
      return out
    }
    const before = await snapshot()
    await updateProfile(c, { units: 'kg' })
    const after = await snapshot()
    expect((after.profile as { units: string }[])[0]!.units).toBe('kg')
    for (const t of DB_TABLES) {
      if (t === 'profile') continue
      expect(after[t], t).toEqual(before[t])
    }
    const {
      units: _u,
      updatedAt: _a,
      ...restBefore
    } = (before.profile as object[])[0] as Record<string, unknown>
    const {
      units: _u2,
      updatedAt: _a2,
      ...restAfter
    } = (after.profile as object[])[0] as Record<string, unknown>
    expect(restAfter).toEqual(restBefore)
  })

  it('validates height and age', async () => {
    const c = ctx()
    await expect(updateProfile(c, { heightIn: 0 })).rejects.toThrow(RangeError)
    await expect(updateProfile(c, { ageYears: 22.5 })).rejects.toThrow(RangeError)
    expect((await loadProfile(c)).heightIn).toBe(71)
  })

  it('stamps updatedAt from the context clock', async () => {
    const c = ctx({ startMs: 1_800_000_000_000 })
    await updateProfile(c, { name: 'Scrimblo' })
    expect(await loadProfile(c)).toMatchObject({ name: 'Scrimblo', updatedAt: 1_800_000_000_000 })
  })
})

describe('app state', () => {
  it('round-trips values', async () => {
    const c = ctx()
    await setAppState(c, 'lastGymId', 'gym-1')
    expect(await getAppState<string>(c, 'lastGymId')).toBe('gym-1')
    expect(await getAppState(c, 'missing')).toBeUndefined()
  })
})
