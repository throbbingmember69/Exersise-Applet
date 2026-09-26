import { afterEach, describe, expect, it } from 'vitest'
import { createTestCtx } from '../context'
import { isServiceError } from '../errors'
import { importCronometer, previewCronometerImport } from './cronometerImport'
import { saveIntake } from './intake'
import { getTodayNutrition } from './queries'

type Ctx = ReturnType<typeof createTestCtx>
const ctxs: Ctx[] = []
function ctx(): Ctx {
  // Today = 2026-10-01 (after every file date except the "future" one).
  const c = createTestCtx({ startMs: Date.UTC(2026, 9, 1, 18) })
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

const DAILY = [
  'Date,Energy (kcal),Carbs (g),Net Carbs (g),Fat (g),Protein (g),Completed',
  '2026-09-25,2712,301,263,82,158,true',
  '2026-09-26,2988,340,300,91,162,true',
  '2026-09-27,16500,900,850,500,300,false',
  '2026-09-28,2500,280,250,80,150,false',
  '2026-10-05,2600,290,260,85,155,false',
].join('\n')

const SERVINGS = [
  'Day,Time,Group,Food Name,Energy (kcal),Carbs (g),Fat (g),Protein (g)',
  '2026-09-30,07:30,Breakfast,Oats,300,54,5,10',
  '2026-09-30,12:00,Lunch,Chicken breast,330,0,7,62',
  '2026-10-01,08:00,Breakfast,Eggs,215,1,14,19',
].join('\n')

const date = (d: string) => d as never

describe('previewCronometerImport', () => {
  it('plans each day: new, replaces typed values, same, implausible and future', async () => {
    const c = ctx()
    await saveIntake(c, { date: '2026-09-26', kcal: 2000, steps: 9000 })
    await saveIntake(c, { date: '2026-09-28', kcal: 2500, proteinG: 150, carbsG: 280, fatG: 80 })
    const p = await previewCronometerImport(c, { text: DAILY })
    expect(p.kind).toBe('daily')
    expect(p.days.map((d) => [d.day.date, d.status])).toEqual([
      ['2026-09-25', 'new'],
      ['2026-09-26', 'update'],
      ['2026-09-27', 'invalid'],
      ['2026-09-28', 'same'],
      ['2026-10-05', 'future'],
    ])
    expect(p.days[1]!.existing).toEqual({ kcal: 2000, proteinG: null, carbsG: null, fatG: null })
    expect(p.days[2]!.problems).toEqual(['Calories 16,500 is over 15,000'])
    expect(p.counts).toEqual({ new: 1, update: 1, same: 1, future: 1, invalid: 1 })
    expect(await c.db.nutritionEntries.count()).toBe(2) // preview writes nothing
  })

  it('refuses an empty file', async () => {
    await expect(previewCronometerImport(ctx(), { text: ' \n' })).rejects.toSatisfy((e) =>
      isServiceError(e, 'empty_file'),
    )
  })
})

describe('importCronometer', () => {
  it('imported values win over typed ones, and steps are kept', async () => {
    const c = ctx()
    await saveIntake(c, { date: '2026-09-26', kcal: 2000, proteinG: 120, steps: 9000 })
    expect(await importCronometer(c, { text: DAILY })).toEqual({
      added: 2,
      updated: 1,
      skipped: 2,
    })
    expect(await c.db.nutritionEntries.get(date('2026-09-26'))).toMatchObject({
      kcal: 2988,
      proteinG: 162,
      carbsG: 340,
      fatG: 91,
      steps: 9000,
    })
    expect(await c.db.nutritionEntries.get(date('2026-09-25'))).toMatchObject({
      kcal: 2712,
      steps: null,
    })
    expect(await c.db.nutritionEntries.get(date('2026-09-27'))).toBeUndefined()
    expect(await c.db.nutritionEntries.get(date('2026-10-05'))).toBeUndefined()
  })

  it('keeps a typed macro the file has no column for', async () => {
    const c = ctx()
    await saveIntake(c, { date: '2026-09-25', kcal: 1800, proteinG: 140 })
    await importCronometer(c, { text: 'Date,Energy (kcal)\n2026-09-25,2400' })
    expect(await c.db.nutritionEntries.get(date('2026-09-25'))).toMatchObject({
      kcal: 2400,
      proteinG: 140,
    })
  })

  it('sums a Servings export, and the imported day counts as logged today', async () => {
    const c = ctx()
    await importCronometer(c, { text: SERVINGS })
    expect(await c.db.nutritionEntries.get(date('2026-09-30'))).toMatchObject({
      kcal: 630,
      proteinG: 72,
      carbsG: 54,
      fatG: 12,
    })
    const view = await getTodayNutrition(c, { date: date('2026-10-01') })
    expect(view.intake).toMatchObject({ kcal: 215, proteinG: 19 })
  })

  it('is idempotent: importing the same file twice changes nothing the second time', async () => {
    const c = ctx()
    await importCronometer(c, { text: DAILY })
    const before = await c.db.nutritionEntries.toArray()
    expect(await importCronometer(c, { text: DAILY })).toMatchObject({ added: 0, updated: 0 })
    expect((await previewCronometerImport(c, { text: DAILY })).counts.same).toBe(3)
    expect(await c.db.nutritionEntries.toArray()).toEqual(before)
  })
})
