import { afterEach, describe, expect, it } from 'vitest'
import { parseLocalDate } from '@/domain/dates'
import { createTestCtx } from '../context'
import { isServiceError } from '../errors'
import { clearIntake, saveIntake } from './intake'

const ctxs: ReturnType<typeof createTestCtx>[] = []
function ctx() {
  const c = createTestCtx()
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

async function expectServiceError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(isServiceError(err, code), `expected ServiceError ${code}, got ${String(err)}`).toBe(true)
}

const date = parseLocalDate('2026-09-25')

describe('saveIntake', () => {
  it('creates the day’s entry with only the fields given', async () => {
    const c = ctx()
    const saved = await saveIntake(c, { date, kcal: 1200 })
    expect(saved).toEqual({
      date,
      kcal: 1200,
      proteinG: null,
      carbsG: null,
      fatG: null,
      steps: null,
      updatedAt: c.now(),
    })
    expect(await c.db.nutritionEntries.get(date)).toEqual(saved)
  })

  it('patches the running total: omitted fields are kept, null clears one', async () => {
    const c = ctx()
    await saveIntake(c, { date, kcal: 1200, proteinG: 60, steps: 4000 })
    c.advance(3_600_000)
    await saveIntake(c, { date, kcal: 2950, carbsG: 400, fatG: 82 })
    expect(await c.db.nutritionEntries.get(date)).toEqual({
      date,
      kcal: 2950,
      proteinG: 60,
      carbsG: 400,
      fatG: 82,
      steps: 4000,
      updatedAt: c.now(),
    })
    await saveIntake(c, { date, steps: null, proteinG: 148 })
    expect(await c.db.nutritionEntries.get(date)).toMatchObject({
      kcal: 2950,
      proteinG: 148,
      steps: null,
    })
    expect(await c.db.nutritionEntries.count()).toBe(1)
  })

  it('removes the entry when every field is cleared', async () => {
    const c = ctx()
    await saveIntake(c, { date, kcal: 2000, steps: 8000 })
    expect(await saveIntake(c, { date, kcal: null, steps: null })).toBeNull()
    expect(await c.db.nutritionEntries.get(date)).toBeUndefined()
  })

  it('accepts zero and validates non-negative numbers, whole steps and the date', async () => {
    const c = ctx()
    expect(await saveIntake(c, { date, kcal: 0, steps: 0 })).toMatchObject({ kcal: 0, steps: 0 })
    await expectServiceError(saveIntake(c, { date, kcal: -1 }), 'invalid_kcal')
    await expectServiceError(saveIntake(c, { date, proteinG: -5 }), 'invalid_proteinG')
    await expectServiceError(saveIntake(c, { date, carbsG: Number.NaN }), 'invalid_carbsG')
    await expectServiceError(
      saveIntake(c, { date, fatG: Number.POSITIVE_INFINITY }),
      'invalid_fatG',
    )
    await expectServiceError(saveIntake(c, { date, steps: 1000.5 }), 'invalid_steps')
    await expectServiceError(saveIntake(c, { date, steps: -10 }), 'invalid_steps')
    await expectServiceError(saveIntake(c, { date }), 'empty_patch')
    await expectServiceError(saveIntake(c, { date: '2026-13-01', kcal: 100 }), 'invalid_date')
    expect(await c.db.nutritionEntries.get(date)).toMatchObject({ kcal: 0, steps: 0 })
  })
})

describe('clearIntake', () => {
  it('removes the day so it counts as not logged; clearing an empty day is a no-op', async () => {
    const c = ctx()
    await saveIntake(c, { date, kcal: 2500 })
    await saveIntake(c, { date: '2026-09-26', kcal: 2600 })
    await clearIntake(c, date)
    expect(await c.db.nutritionEntries.get(date)).toBeUndefined()
    expect(await c.db.nutritionEntries.count()).toBe(1)
    await clearIntake(c, date)
    await expectServiceError(clearIntake(c, 'yesterday'), 'invalid_date')
  })
})
