// Dexie upgrade callbacks. Each runs the same pure migration step that backup import uses
// (db/migrations) on just the tables that step touches, then writes only the rows it changed, so
// history tables are never read or written by an upgrade. Only Dexie calls inside: the upgrade
// transaction must stay alive.
import type { Transaction } from 'dexie'
import { PRIMARY_KEYS } from './backupSchema'
import { V2_PROGRAM_TABLES, v1ToV2 } from './migrations'

type Row = Record<string, unknown>

/** Schema v1 → v2 (October 2026 program update and `Exercise.formUrl`). */
export async function upgradeToV2(tx: Transaction): Promise<void> {
  const before: Record<string, Row[]> = {}
  for (const name of V2_PROGRAM_TABLES) before[name] = (await tx.table(name).toArray()) as Row[]
  const after = v1ToV2.upgradeTables(before)
  for (const name of V2_PROGRAM_TABLES) {
    const old = before[name]!
    const next = after[name] as Row[]
    const key = PRIMARY_KEYS[name]
    // The step copies a row only when it changes it, so identity tells what to write.
    const unchanged = new Set<Row>(old)
    const put = next.filter((row) => !unchanged.has(row))
    const kept = new Set(next.map((row) => row[key]))
    const removed = old.filter((row) => !kept.has(row[key])).map((row) => row[key])
    if (removed.length > 0) await tx.table(name).bulkDelete(removed as never[])
    if (put.length > 0) await tx.table(name).bulkPut(put)
  }
}
