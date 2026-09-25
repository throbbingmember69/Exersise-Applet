// Full JSON backup and restore (user decision: one device, IndexedDB, no cloud). Export dumps every
// table; restore validates the whole file first (JSON → migrate → schema), then replaces every
// table in one transaction, so a bad file or a failed write leaves the current data untouched.
// Restoring a backup with less history than the device asks for confirmation first.
import { MigrationError, migrateBackup } from '@/db/migrations'
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  PRIMARY_KEYS,
  TABLE_NAMES,
  parseBackup,
  type Backup,
  type BackupTables,
  type TableName,
} from '@/db/backupSchema'
import { daysBetween, localDateOf } from '@/domain/dates'
import type { EpochMs, LocalDate } from '@/domain/types'
import { today, type ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { getAppState, loadSettings, setAppState } from '../settings'

/** appState key: when a backup file was last saved (epoch ms). */
export const LAST_BACKUP_AT_KEY = 'lastBackupAt'

/** Rows per table. */
export type TableCounts = { [K in TableName]: number }

/** The logged history a restore could lose: the rows that can't be re-created from the seed. */
export interface HistoryCounts {
  sessions: number
  setLogs: number
  bodyEntries: number
  nutritionEntries: number
  total: number
}

export type ImportResult =
  | { status: 'imported'; counts: TableCounts }
  | { status: 'needs_confirm'; current: HistoryCounts; incoming: HistoryCounts }

export interface ImportOptions {
  /** Go ahead even when the backup holds less history than the device. */
  confirmFewerRows?: boolean
}

/** Dump every table, rows sorted by primary key, so the same data always gives the same file. */
export async function exportBackup(
  ctx: Pick<ServiceCtx, 'db' | 'now'>,
  opts: { appVersion: string },
): Promise<Backup> {
  const { db } = ctx
  const tables = await db.transaction('r', [...TABLE_NAMES], async () => {
    const entries = await Promise.all(
      TABLE_NAMES.map(async (name) => [name, sortByKey(name, await db.table(name).toArray())]),
    )
    return Object.fromEntries(entries) as BackupTables
  })
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: opts.appVersion,
    exportedAt: ctx.now(),
    tables,
  }
}

export function serializeBackup(backup: Backup): string {
  return JSON.stringify(backup)
}

/** Download name, e.g. `exersise-backup-2026-09-24.json`. */
export function backupFileName(date: LocalDate): string {
  return `exersise-backup-${date}.json`
}

/**
 * Replace everything on the device with a backup file's contents.
 *
 * Throws ServiceError 'invalid_backup' (detail.errors lists every problem) for text that isn't a
 * valid backup, 'newer_version' for a file from a newer app, and 'restore_failed' if the database
 * write fails (nothing is changed in that case). Returns `needs_confirm` instead of importing when
 * the file has fewer sessions + sets + body entries + nutrition entries than the device, unless
 * `confirmFewerRows` is set.
 */
export async function importBackup(
  ctx: Pick<ServiceCtx, 'db'>,
  jsonText: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const backup = validateBackupText(jsonText)
  const incoming = historyCounts(backup.tables)
  const { db } = ctx
  try {
    return await db.transaction('rw', [...TABLE_NAMES], async (): Promise<ImportResult> => {
      const current = await currentHistoryCounts(ctx)
      if (incoming.total < current.total && !opts.confirmFewerRows) {
        return { status: 'needs_confirm', current, incoming }
      }
      for (const name of TABLE_NAMES) await db.table(name).clear()
      for (const name of TABLE_NAMES) {
        const rows = backup.tables[name]
        if (rows.length > 0) await db.table(name).bulkAdd(rows)
      }
      return { status: 'imported', counts: tableCounts(backup.tables) }
    })
  } catch (e) {
    if (e instanceof ServiceError) throw e
    throw new ServiceError(
      'restore_failed',
      'The backup could not be written, so nothing was changed. Your current data is untouched.',
      { cause: e instanceof Error ? `${e.name}: ${e.message}` : String(e) },
    )
  }
}

/** Parse, migrate and validate backup text without touching the database. */
export function validateBackupText(jsonText: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw invalid('This file is not a backup: it is not valid JSON.', [reason])
  }
  let migrated: unknown
  try {
    migrated = migrateBackup(raw)
  } catch (e) {
    if (e instanceof MigrationError && e.kind === 'newer_version') {
      throw new ServiceError('newer_version', e.message, {
        version: e.version,
        currentVersion: e.currentVersion,
      })
    }
    if (e instanceof MigrationError) throw invalid(e.message, [e.message])
    throw e
  }
  const parsed = parseBackup(migrated)
  if (!parsed.ok) throw invalid(problemsMessage(parsed.errors.length), parsed.errors)
  const errors = [...uniqueIndexErrors(parsed.backup.tables), ...requiredRowErrors(parsed.backup)]
  if (errors.length > 0) throw invalid(problemsMessage(errors.length), errors)
  return parsed.backup
}

/** Record that a backup file was saved (drives the backup reminder). */
export async function markBackupSaved(ctx: ServiceCtx): Promise<void> {
  await setAppState(ctx, LAST_BACKUP_AT_KEY, ctx.now())
}

export interface BackupReminder {
  lastBackupAt: EpochMs | null
  /** Whole days since the last backup, or null if there has never been one. */
  daysSince: number | null
  /** True once `backupReminderDays` have passed, or when logged data has never been backed up. */
  due: boolean
}

/** Query: when the last backup was saved and whether a reminder is due. */
export async function getBackupReminder(
  ctx: Pick<ServiceCtx, 'db' | 'now'>,
): Promise<BackupReminder> {
  const { db } = ctx
  const [settings, stored, sessions, nutrition, weighIns] = await Promise.all([
    loadSettings(ctx),
    getAppState<unknown>(ctx, LAST_BACKUP_AT_KEY),
    db.sessions.count(),
    db.nutritionEntries.count(),
    db.bodyEntries.filter((b) => b.source === 'user').count(),
  ])
  const lastBackupAt = typeof stored === 'number' && Number.isFinite(stored) ? stored : null
  if (lastBackupAt === null) {
    // Nothing but the seed yet: nothing to lose.
    return { lastBackupAt, daysSince: null, due: sessions + nutrition + weighIns > 0 }
  }
  const daysSince = daysBetween(localDateOf(lastBackupAt), today(ctx))
  return { lastBackupAt, daysSince, due: daysSince >= settings.backupReminderDays }
}

export async function currentHistoryCounts(ctx: Pick<ServiceCtx, 'db'>): Promise<HistoryCounts> {
  const { db } = ctx
  const [sessions, setLogs, bodyEntries, nutritionEntries] = await Promise.all([
    db.sessions.count(),
    db.setLogs.count(),
    db.bodyEntries.count(),
    db.nutritionEntries.count(),
  ])
  return withTotal({ sessions, setLogs, bodyEntries, nutritionEntries })
}

function historyCounts(tables: BackupTables): HistoryCounts {
  return withTotal({
    sessions: tables.sessions.length,
    setLogs: tables.setLogs.length,
    bodyEntries: tables.bodyEntries.length,
    nutritionEntries: tables.nutritionEntries.length,
  })
}

function withTotal(c: Omit<HistoryCounts, 'total'>): HistoryCounts {
  return { ...c, total: c.sessions + c.setLogs + c.bodyEntries + c.nutritionEntries }
}

function tableCounts(tables: BackupTables): TableCounts {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, tables[n].length])) as TableCounts
}

function sortByKey<T>(name: TableName, rows: T[]): T[] {
  const pk = PRIMARY_KEYS[name]
  const key = (row: T) => String((row as Record<string, unknown>)[pk])
  return rows.sort((a, b) => {
    const x = key(a)
    const y = key(b)
    return x < y ? -1 : x > y ? 1 : 0
  })
}

/** Dexie unique indexes (beyond primary keys, which parseBackup checks) that bulkAdd would trip. */
function uniqueIndexErrors(t: BackupTables): string[] {
  return [
    ...duplicates(
      'gymExerciseSettings',
      'gymId + exerciseId',
      t.gymExerciseSettings.map((r) => [r.gymId, r.exerciseId]),
    ),
    ...duplicates(
      'gymSlotOverrides',
      'gymId + slotId',
      t.gymSlotOverrides.map((r) => [r.gymId, r.slotId]),
    ),
    ...duplicates(
      'checkIns',
      'phaseId + dueDate',
      t.checkIns.map((r) => [r.phaseId, r.dueDate]),
    ),
    ...duplicates(
      'suggestions',
      'key',
      t.suggestions.map((r) => [r.key]),
    ),
  ]
}

function duplicates(
  table: TableName,
  label: string,
  keys: readonly (readonly unknown[])[],
): string[] {
  const errors: string[] = []
  const seen = new Map<string, number>()
  keys.forEach((parts, i) => {
    const key = JSON.stringify(parts)
    const first = seen.get(key)
    if (first === undefined) seen.set(key, i)
    else errors.push(`tables.${table}[${i}]: duplicate ${label} (also at [${first}])`)
  })
  return errors
}

function requiredRowErrors(backup: Backup): string[] {
  return backup.tables.profile.length === 1
    ? []
    : [`tables.profile: expected exactly 1 profile row, got ${backup.tables.profile.length}`]
}

function problemsMessage(n: number): string {
  return n === 1
    ? 'This backup file has a problem and was not restored.'
    : `This backup file has ${n} problems and was not restored.`
}

function invalid(message: string, errors: readonly string[]): ServiceError {
  return new ServiceError('invalid_backup', message, { errors })
}
