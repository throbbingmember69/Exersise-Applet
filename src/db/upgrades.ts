// Dexie upgrade callbacks. Each runs the same pure migration step that backup import uses
// (db/migrations) on just the tables that step touches, then writes only the rows it changed, so
// history tables are never read or written by an upgrade. Only Dexie calls inside: the upgrade
// transaction must stay alive.
import type { Transaction } from 'dexie'
import { localDateOf } from '@/domain/dates'
import { PRIMARY_KEYS } from './backupSchema'
import {
  V2_PROGRAM_TABLES,
  V3_TABLES,
  v1ToV2,
  v2ToV3,
  type Migration,
  type MigrationContext,
} from './migrations'

type Row = Record<string, unknown>
type TableName = keyof typeof PRIMARY_KEYS

async function runStep(
  tx: Transaction,
  step: Migration,
  tables: readonly TableName[],
  ctx: MigrationContext = {},
): Promise<void> {
  const before: Record<string, Row[]> = {}
  for (const name of tables) before[name] = (await tx.table(name).toArray()) as Row[]
  const after = step.upgradeTables(before, ctx)
  for (const name of tables) {
    const old = before[name]!
    const next = after[name] as Row[]
    const key = PRIMARY_KEYS[name]
    // A step copies a row only when it changes it, so identity tells what to write.
    const unchanged = new Set<Row>(old)
    const put = next.filter((row) => !unchanged.has(row))
    const kept = new Set(next.map((row) => row[key]))
    const removed = old.filter((row) => !kept.has(row[key])).map((row) => row[key])
    if (removed.length > 0) await tx.table(name).bulkDelete(removed as never[])
    if (put.length > 0) await tx.table(name).bulkPut(put)
  }
}

/** Schema v1 → v2 (October 10 2026 program update and `Exercise.formUrl`). */
export function upgradeToV2(tx: Transaction): Promise<void> {
  return runStep(tx, v1ToV2, V2_PROGRAM_TABLES)
}

/** Schema v2 → v3 (October 18 2026 back-focus update and `Muscle.trackedFrom`). */
export function upgradeToV3(tx: Transaction, now: number = Date.now()): Promise<void> {
  // The new muscle groups count from the day the phone actually upgrades.
  return runStep(tx, v2ToV3, V3_TABLES, { today: localDateOf(now) })
}
