// First-launch content: the spec's profile and baseline, muscles, exercise library, program and
// start loads, plus the settings singleton (empty overrides = registry defaults). Runs inside
// Dexie's 'populate' transaction, which only fires when the database is first created.
import type Dexie from 'dexie'
import type { Transaction } from 'dexie'
import type { AppStateRow, SettingsRow } from '@/domain/types'
import { SEED, SEED_EPOCH_MS, SEED_VERSION, type SeedData } from '@/seed'

export const APP_STATE_SEED_VERSION = 'seedVersion'

/** Rows written on first launch, per table. */
export function seedRows(seed: SeedData = SEED) {
  const settings: SettingsRow = { id: 'singleton', values: {}, updatedAt: SEED_EPOCH_MS }
  const appState: AppStateRow[] = [{ key: APP_STATE_SEED_VERSION, value: SEED_VERSION }]
  return {
    profile: [seed.profile],
    settings: [settings],
    appState,
    muscles: seed.muscles,
    gyms: seed.gyms,
    exercises: seed.exercises,
    gymExerciseSettings: seed.gymExerciseSettings,
    programDays: seed.programDays,
    programSlots: seed.programSlots,
    gymSlotOverrides: seed.gymSlotOverrides,
    trackStarts: seed.trackStarts,
    bodyEntries: seed.bodyEntries,
  } as const
}

/** Dexie 'populate' handler. Only synchronous Dexie calls: the transaction must stay alive. */
export function populateSeed(tx: Transaction): void {
  for (const [table, rows] of Object.entries(seedRows())) {
    // structuredClone: the seed constants are shared module state and must never be mutated.
    void tx.table(table).bulkAdd(structuredClone([...rows]))
  }
}

/**
 * Dexie 'ready' fallback: seed a database that exists but was never populated (e.g. a first
 * launch interrupted after the stores were created). A restored backup always has a profile.
 */
export async function ensureSeeded(db: Dexie): Promise<void> {
  if ((await db.table('profile').count()) > 0) return
  await db.transaction('rw', Object.keys(seedRows()), async () => {
    if ((await db.table('profile').count()) > 0) return
    for (const [table, rows] of Object.entries(seedRows())) {
      await db.table(table).bulkPut(structuredClone([...rows]))
    }
  })
}
