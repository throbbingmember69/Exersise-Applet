// Services receive their dependencies explicitly so tests can use a throwaway database and a
// fixed clock. The UI gets the app-wide context from `useServices()`.
import { AppDB } from '@/db/schema'
import { localDateOf } from '@/domain/dates'
import type { LocalDate } from '@/domain/types'
import { SPEC_SEED, type SeedData } from '@/seed'

export interface ServiceCtx {
  db: AppDB
  /** Current instant (epoch ms). */
  now: () => number
  /** Id generator for new rows. */
  newId: () => string
}

export function today(ctx: Pick<ServiceCtx, 'now'>): LocalDate {
  return localDateOf(ctx.now())
}

let appCtx: ServiceCtx | null = null

/** The app-wide context (real database, wall clock, random UUIDs). */
export function getAppCtx(): ServiceCtx {
  appCtx ??= {
    db: new AppDB(),
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
  }
  return appCtx
}

/**
 * A context for tests: isolated database, controllable clock, sequential ids. The database is
 * seeded with the spec's original program (SPEC_SEED: the tables the spec's numbers come from)
 * unless `seed` is false (empty), true (the live first-launch seed) or another SeedData.
 */
export function createTestCtx(
  opts: { dbName?: string; startMs?: number; seed?: boolean | SeedData } = {},
) {
  let t = opts.startMs ?? Date.UTC(2026, 8, 24, 12)
  let n = 0
  const seed = opts.seed === undefined ? SPEC_SEED : opts.seed
  const ctx: ServiceCtx & { setNow: (ms: number) => void; advance: (ms: number) => void } = {
    db: new AppDB(opts.dbName ?? `test-${crypto.randomUUID()}`, { seed }),
    now: () => t,
    newId: () => `id-${String(++n).padStart(4, '0')}`,
    setNow: (ms) => {
      t = ms
    },
    advance: (ms) => {
      t += ms
    },
  }
  return ctx
}
