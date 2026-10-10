import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, parseBackup, TABLE_NAMES } from '@/db/backupSchema'
import { seedRows } from '@/db/populate'
import { SPEC_SEED } from '@/seed'
import {
  MIGRATIONS,
  MigrationError,
  migrateBackup,
  migrateBackupWith,
  migrateTables,
  v1ToV2 as realV1ToV2,
  type Migration,
} from '.'

function file(schemaVersion: unknown, tables: unknown = { profile: [], setLogs: [] }) {
  return { format: BACKUP_FORMAT, schemaVersion, appVersion: '0.1.0', exportedAt: 0, tables }
}

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x)) deepFreeze(v)
  }
  return x
}

// A hypothetical future chain: v2 renames setLogs.rpe → rir, v3 adds a `tags` array to sessions.
const v1ToV2: Migration = {
  from: 1,
  upgradeTables: (t) => ({
    ...t,
    setLogs: (t.setLogs as { rpe: number }[]).map(({ rpe, ...rest }) => ({
      ...rest,
      rir: 10 - rpe,
    })),
  }),
}
const v2ToV3: Migration = {
  from: 2,
  upgradeTables: (t) => ({
    ...t,
    sessions: ((t.sessions as object[] | undefined) ?? []).map((s) => ({ ...s, tags: [] })),
  }),
}

describe('migrateBackup', () => {
  it('the chain covers every version below the current one, in order', () => {
    expect(MIGRATIONS.map((m) => m.from)).toEqual(
      Array.from({ length: BACKUP_SCHEMA_VERSION - 1 }, (_, i) => i + 1),
    )
  })

  it('returns a current-version file unchanged', () => {
    const raw = deepFreeze(file(BACKUP_SCHEMA_VERSION))
    expect(migrateBackup(raw)).toBe(raw)
  })

  it('refuses a file from a newer schema', () => {
    const raw = file(BACKUP_SCHEMA_VERSION + 1)
    expect(() => migrateBackup(raw)).toThrow(MigrationError)
    try {
      migrateBackup(raw)
    } catch (e) {
      expect(e).toMatchObject({
        kind: 'newer_version',
        version: BACKUP_SCHEMA_VERSION + 1,
        currentVersion: BACKUP_SCHEMA_VERSION,
      })
      expect((e as Error).message).toMatch(/newer version of the app/)
    }
  })

  it('passes anything that is not a recognisable backup through for parseBackup to explain', () => {
    for (const raw of [null, 42, 'text', [1, 2], {}, { format: 'other', schemaVersion: 1 }]) {
      expect(migrateBackup(raw)).toBe(raw)
    }
    for (const version of [undefined, '1', 0, -1, 1.5]) {
      const raw = file(version)
      expect(migrateBackup(raw)).toBe(raw)
    }
  })
})

/** A v1 backup's tables: the spec seed as first shipped (no formUrl) plus some history. */
function v1Tables(): Record<string, unknown[]> {
  const rows = seedRows(SPEC_SEED) as unknown as Record<string, readonly Record<string, unknown>[]>
  const tables: Record<string, unknown[]> = {}
  for (const name of TABLE_NAMES) tables[name] = structuredClone([...(rows[name] ?? [])])
  tables.exercises = tables.exercises!.map((e) => {
    const { formUrl: _formUrl, ...v1 } = e as Record<string, unknown>
    return v1
  })
  tables.nutritionEntries = [
    {
      date: '2026-10-03',
      kcal: 2950,
      proteinG: 180,
      carbsG: null,
      fatG: null,
      steps: 9000,
      updatedAt: 1,
    },
  ]
  return tables
}

describe('v1 → v2 (October 2026 update)', () => {
  it('turns a v1 backup into a valid v2 one, leaving history tables untouched', () => {
    const tables = v1Tables()
    const raw = deepFreeze(file(1, tables))
    const out = migrateBackup(raw) as { schemaVersion: number; tables: Record<string, unknown[]> }
    expect(out.schemaVersion).toBe(2)
    for (const name of ['profile', 'sessions', 'setLogs', 'bodyEntries', 'nutritionEntries']) {
      expect(out.tables[name], name).toBe(tables[name])
    }
    const result = parseBackup(out)
    expect(result.ok ? [] : result.errors).toEqual([])
    const slots = out.tables.programSlots as { id: string; defaultExerciseId: string }[]
    expect(slots.find((s) => s.id === 'slot-upper-1')?.defaultExerciseId).toBe(
      'ex-incline-smith-press',
    )
    expect(slots.some((s) => s.id === 'slot-lower-a-abduction')).toBe(true)
  })

  it('only adds the new field to a damaged file, for validation to report the rest', () => {
    const tables = { exercises: [{ id: 'ex-1' }, 'junk'], programSlots: 'oops' }
    expect(realV1ToV2.upgradeTables(tables)).toEqual({
      exercises: [{ id: 'ex-1', formUrl: null }, 'junk'],
      programSlots: 'oops',
    })
  })
})

describe('a multi-step chain', () => {
  const chain = [v2ToV3, v1ToV2] // declaration order doesn't matter; steps run by version

  it('applies each step in version order and stamps the target version', () => {
    const raw = deepFreeze(
      file(1, { setLogs: [{ id: 's1', rpe: 8 }], sessions: [{ id: 'a' }], profile: [] }),
    )
    expect(migrateBackupWith(raw, chain, 3)).toEqual(
      file(3, { setLogs: [{ id: 's1', rir: 2 }], sessions: [{ id: 'a', tags: [] }], profile: [] }),
    )
  })

  it('starts from the file’s own version', () => {
    const raw = deepFreeze(file(2, { setLogs: [{ id: 's1', rir: 1 }] }))
    expect(migrateBackupWith(raw, chain, 3)).toEqual(
      file(3, { setLogs: [{ id: 's1', rir: 1 }], sessions: [] }),
    )
  })

  it('fails loudly when a step is missing', () => {
    expect(() => migrateTables({}, 1, 3, [v2ToV3])).toThrow(/No migration from schema 1 to 2/)
  })

  it('leaves a file without a tables object for parseBackup to reject', () => {
    const raw = file(1, 'not tables')
    expect(migrateBackupWith(raw, chain, 3)).toBe(raw)
  })
})
