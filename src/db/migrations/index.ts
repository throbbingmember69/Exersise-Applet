// Ordered, pure schema migrations. Each step upgrades every table's rows from schema version N to
// N + 1. Backup import runs the chain on older files before validating them, and a future Dexie
// `db.version(N + 1).upgrade()` callback can run the same step, so both paths share one transform.
//
// To add schema v2:
//   1. write `v1ToV2: Migration = { from: 1, upgradeTables: (tables) => ({ ...tables, … }) }`
//   2. append it to MIGRATIONS
//   3. bump BACKUP_SCHEMA_VERSION (and the row schemas in db/backupSchema.ts) to match.
// Steps are pure: they return new objects and never mutate their input.
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION } from '@/db/backupSchema'

/** Raw (unvalidated) rows per table name, as found in a backup file of some older version. */
export type RawTables = Readonly<Record<string, unknown>>

export interface Migration {
  /** Schema version this step reads; it produces version `from + 1`. */
  from: number
  /** Pure transform of every table's rows. */
  upgradeTables: (tables: RawTables) => RawTables
}

/** The chain, oldest first. Empty while v1 is the only schema (v1 → v1 is the identity). */
export const MIGRATIONS: readonly Migration[] = []

export type MigrationErrorKind = 'newer_version' | 'missing_step'

/** The file's schema can't be brought to the current version. */
export class MigrationError extends Error {
  constructor(
    readonly kind: MigrationErrorKind,
    readonly version: number,
    readonly currentVersion: number,
    message: string,
  ) {
    super(message)
    this.name = 'MigrationError'
  }
}

/**
 * Upgrade a parsed backup file to BACKUP_SCHEMA_VERSION. A file that doesn't look like a backup
 * (not an object, wrong format marker, missing or non-integer version) is returned unchanged so
 * `parseBackup` can explain what's wrong with it. Throws MigrationError for a version newer than
 * this app understands.
 */
export function migrateBackup(raw: unknown): unknown {
  return migrateBackupWith(raw, MIGRATIONS, BACKUP_SCHEMA_VERSION)
}

/** `migrateBackup` with an explicit chain and target (lets tests exercise a multi-step chain). */
export function migrateBackupWith(
  raw: unknown,
  chain: readonly Migration[],
  targetVersion: number,
): unknown {
  if (!isPlainObject(raw) || raw.format !== BACKUP_FORMAT) return raw
  const version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return raw
  if (version > targetVersion) {
    throw new MigrationError(
      'newer_version',
      version,
      targetVersion,
      `This backup was made by a newer version of the app (schema ${version}; this app reads ` +
        `schema ${targetVersion}). Update the app, then restore.`,
    )
  }
  if (version === targetVersion || !isPlainObject(raw.tables)) return raw
  return {
    ...raw,
    schemaVersion: targetVersion,
    tables: migrateTables(raw.tables, version, targetVersion, chain),
  }
}

/** Run the steps that take `tables` from version `from` to version `to`, in order. */
export function migrateTables(
  tables: RawTables,
  from: number,
  to: number,
  chain: readonly Migration[] = MIGRATIONS,
): RawTables {
  let out = tables
  for (let v = from; v < to; v++) {
    const step = chain.find((m) => m.from === v)
    if (!step) {
      throw new MigrationError(
        'missing_step',
        from,
        to,
        `No migration from schema ${v} to ${v + 1}; this backup can't be restored.`,
      )
    }
    out = step.upgradeTables(out)
  }
  return out
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}
