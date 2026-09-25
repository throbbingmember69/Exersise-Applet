import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION } from '@/db/backupSchema'
import {
  MIGRATIONS,
  MigrationError,
  migrateBackup,
  migrateBackupWith,
  migrateTables,
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

  it('returns a current-version file unchanged (v1 is the identity)', () => {
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
