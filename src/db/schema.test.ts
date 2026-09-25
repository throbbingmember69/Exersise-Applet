import { afterEach, describe, expect, it } from 'vitest'
import { AppDB, DB_TABLES } from './schema'

let db: AppDB | null = null

afterEach(async () => {
  if (db) {
    db.close()
    await db.delete()
    db = null
  }
})

describe('AppDB schema', () => {
  it('declares exactly the contract tables', async () => {
    db = new AppDB(`schema-test-${DB_TABLES.length}`)
    await db.open()
    expect(db.tables.map((t) => t.name).sort()).toEqual([...DB_TABLES].sort())
  })

  it('enforces unique compound indexes', async () => {
    db = new AppDB('schema-test-unique')
    await db.gymSlotOverrides.add({ id: 'o1', gymId: 'gym-1', slotId: 's1', exerciseId: 'e1' })
    await expect(
      db.gymSlotOverrides.add({ id: 'o2', gymId: 'gym-1', slotId: 's1', exerciseId: 'e2' }),
    ).rejects.toThrow()
  })
})
