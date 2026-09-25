import { afterEach, describe, expect, it } from 'vitest'
import { SEED } from '@/seed'
import { AppDB } from './schema'

const names: string[] = []
afterEach(async () => {
  for (const name of names.splice(0)) await new AppDB(name, { seed: false }).delete()
})

describe('seeding', () => {
  it('seeds a database that exists but was never populated', async () => {
    const name = `populate-${crypto.randomUUID()}`
    names.push(name)
    const empty = new AppDB(name, { seed: false })
    await empty.open()
    expect(await empty.profile.count()).toBe(0)
    empty.close()

    const db = new AppDB(name)
    expect(await db.profile.toArray()).toEqual([SEED.profile])
    expect(await db.programSlots.count()).toBe(34)
    db.close()
  })

  it('never re-seeds over existing data', async () => {
    const name = `populate-${crypto.randomUUID()}`
    names.push(name)
    const first = new AppDB(name)
    await first.profile.update('me', { name: 'Kept' })
    await first.exercises.delete('ex-hyper-y-w')
    first.close()

    const again = new AppDB(name)
    expect((await again.profile.get('me'))?.name).toBe('Kept')
    expect(await again.exercises.get('ex-hyper-y-w')).toBeUndefined()
    again.close()
  })
})
