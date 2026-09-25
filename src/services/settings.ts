// Settings, profile and app-state access shared by every service. Settings are stored as
// overrides and merged over the registry defaults on read.
import {
  isSettingKey,
  resolveSettings,
  settingMeta,
  type Settings,
  type SettingKey,
} from '@/domain/settings/registry'
import { roundHalfAway, roundToStep } from '@/domain/rounding'
import type { UserProfile } from '@/domain/types'
import type { ServiceCtx } from './context'
import { ServiceError } from './errors'

const SETTINGS_ID = 'singleton'
const PROFILE_ID = 'me'

export async function loadSettings(ctx: Pick<ServiceCtx, 'db'>): Promise<Settings> {
  const row = await ctx.db.settings.get(SETTINGS_ID)
  return resolveSettings(row?.values)
}

/** Stored overrides only (what differs from the defaults). */
export async function loadSettingOverrides(
  ctx: Pick<ServiceCtx, 'db'>,
): Promise<Partial<Record<SettingKey, number>>> {
  return (await ctx.db.settings.get(SETTINGS_ID))?.values ?? {}
}

/**
 * Set one or more settings. Values are validated against the registry bounds; a value equal to
 * the default removes the override.
 */
export async function updateSettings(
  ctx: ServiceCtx,
  patch: Partial<Record<SettingKey, number>>,
): Promise<void> {
  // Values snap to the registry step (e.g. whole steps/day), so stored settings always match what
  // the settings screen can show and backups stay valid (integer-valued settings stay integers).
  const snapped: [SettingKey, number][] = []
  for (const [key, value] of Object.entries(patch)) {
    if (!isSettingKey(key)) throw new ServiceError('unknown_setting', `Unknown setting: ${key}`)
    const meta = settingMeta(key)
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ServiceError('invalid_setting', `${meta.label} must be a number`)
    }
    const v = roundHalfAway(roundToStep(value, meta.step), 6)
    if (v < meta.min || v > meta.max) {
      throw new ServiceError(
        'invalid_setting',
        `${meta.label} must be between ${meta.min} and ${meta.max}`,
      )
    }
    snapped.push([key, v])
  }
  await ctx.db.transaction('rw', ctx.db.settings, async () => {
    const values: Partial<Record<SettingKey, number>> = {
      ...((await ctx.db.settings.get(SETTINGS_ID))?.values ?? {}),
    }
    for (const [key, value] of snapped) {
      if (value === settingMeta(key).default) delete values[key]
      else values[key] = value
    }
    await ctx.db.settings.put({ id: SETTINGS_ID, values, updatedAt: ctx.now() })
  })
}

export async function resetSettings(ctx: ServiceCtx, keys?: readonly SettingKey[]): Promise<void> {
  await ctx.db.transaction('rw', ctx.db.settings, async () => {
    const current = (await ctx.db.settings.get(SETTINGS_ID))?.values ?? {}
    const values: Partial<Record<SettingKey, number>> = keys ? { ...current } : {}
    for (const key of keys ?? []) delete values[key]
    await ctx.db.settings.put({ id: SETTINGS_ID, values, updatedAt: ctx.now() })
  })
}

export async function loadProfile(ctx: Pick<ServiceCtx, 'db'>): Promise<UserProfile> {
  const profile = await ctx.db.profile.get(PROFILE_ID)
  if (!profile) throw new Error('Profile missing: the database was not seeded')
  return profile
}

export type ProfilePatch = Partial<Omit<UserProfile, 'id' | 'updatedAt'>>

/** Update profile fields. Switching units touches only `units`: stored data stays in lb. */
export async function updateProfile(ctx: ServiceCtx, patch: ProfilePatch): Promise<void> {
  if (patch.heightIn !== undefined && !(patch.heightIn > 0)) {
    throw new RangeError('Height must be positive')
  }
  if (patch.ageYears !== undefined && !(Number.isInteger(patch.ageYears) && patch.ageYears > 0)) {
    throw new RangeError('Age must be a positive whole number')
  }
  await ctx.db.transaction('rw', ctx.db.profile, async () => {
    const current = await loadProfile(ctx)
    await ctx.db.profile.put({ ...current, ...patch, id: PROFILE_ID, updatedAt: ctx.now() })
  })
}

export async function getAppState<T>(
  ctx: Pick<ServiceCtx, 'db'>,
  key: string,
): Promise<T | undefined> {
  return (await ctx.db.appState.get(key))?.value as T | undefined
}

export async function setAppState(
  ctx: Pick<ServiceCtx, 'db'>,
  key: string,
  value: unknown,
): Promise<void> {
  await ctx.db.appState.put({ key, value })
}
