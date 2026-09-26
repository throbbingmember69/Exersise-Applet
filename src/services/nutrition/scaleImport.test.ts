import { afterEach, describe, expect, it } from 'vitest'
import { kgToLb } from '@/domain/units'
import { SEED_DATE } from '@/seed'
import { createTestCtx } from '../context'
import { isServiceError } from '../errors'
import { saveWeighIn, voidBodyEntry } from './body'
import { importScaleReadings, previewScaleImport } from './scaleImport'

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

const FILE = [
  'Time,Weight(lb),BMI,Body Fat(%),Subcutaneous Fat(%),Visceral Fat,Skeletal Muscle(%),Muscle Mass(lb)',
  `${SEED_DATE} 07:10,163.2,22.8,14.4,12.8,5,55.2,132.1`,
  '2026-09-25 07:05,162.8,22.7,14.2,12.6,5,55.4,131.9',
  '2026-09-25 19:40,164.0,22.9,14.8,12.9,5,55.0,132.3',
  '2026-09-26 07:00,163.0,22.7,140,12.6,5,55.4,131.9',
  '2026-09-27 07:00,,,,,,,',
  '2026-10-05 07:00,162.0,22.6,14.0,12.5,5,55.5,131.8',
].join('\n')

describe('previewScaleImport', () => {
  it('plans each day: seed day filled, earliest reading, implausible values dropped, future skipped', async () => {
    const c = ctx()
    const p = await previewScaleImport(c, { text: FILE })
    expect(p.massUnit).toBe('lb')
    expect(p.needsUnit).toBe(false)
    expect(p.recognized).toMatchObject({
      date: 'Time',
      weight: 'Weight(lb)',
      bodyFatPct: 'Body Fat(%)',
    })
    expect(p.days.map((d) => [d.reading.date, d.status])).toEqual([
      [SEED_DATE, 'update'],
      ['2026-09-25', 'new'],
      ['2026-09-26', 'new'],
      ['2026-10-05', 'future'],
    ])
    expect(p.days[1]!.values.weightLb).toBe(162.8) // 07:05, not 19:40
    expect(p.days[2]!.values.bodyFatPct).toBeNull()
    expect(p.days[2]!.problems).toEqual(['Body fat % 140 is outside 2–70'])
    expect(p.warnings).toEqual(['Row 6: no readable values, skipped.'])
    expect(p.counts).toMatchObject({ new: 2, update: 1, future: 1 })
    expect(await c.db.bodyEntries.count()).toBe(1) // preview writes nothing
  })

  it('marks days already logged: same values vs different (replaced unless keeping)', async () => {
    const c = ctx()
    await saveWeighIn(c, { date: '2026-09-25', weightLb: 162.8, confirmed: true })
    await saveWeighIn(c, { date: '2026-09-26', weightLb: 170, confirmed: true })
    const p = await previewScaleImport(c, { text: FILE, replaceExisting: false })
    const status = (d: string) => p.days.find((x) => x.reading.date === d)?.status
    // 09-25 has the same weight; the file adds scale fields too, so it isn't "same".
    expect(status('2026-09-25')).toBe('exists')
    expect(status('2026-09-26')).toBe('exists')
    const r = await previewScaleImport(c, { text: FILE })
    expect(r.days.find((x) => x.reading.date === '2026-09-26')?.status).toBe('update')
  })

  it('asks for the unit when the file has none, and converts kg', async () => {
    const c = ctx()
    const text = 'Time,Weight,Body Fat(%)\n2026-09-25 07:00,74.0,14.3'
    expect((await previewScaleImport(c, { text })).needsUnit).toBe(true)
    await expect(importScaleReadings(c, { text })).rejects.toSatisfy((e) =>
      isServiceError(e, 'unit_needed'),
    )
    await importScaleReadings(c, { text, massUnit: 'kg' })
    expect((await c.db.bodyEntries.get('2026-09-25' as never))?.weightLb).toBeCloseTo(kgToLb(74), 9)
  })
})

describe('importScaleReadings', () => {
  it('adds new days, fills the seed day and keeps logged days when asked to', async () => {
    const c = ctx()
    await saveWeighIn(c, { date: '2026-09-26', weightLb: 170, confirmed: true })
    const result = await importScaleReadings(c, { text: FILE, replaceExisting: false })
    expect(result).toEqual({ added: 1, updated: 1, skipped: 2 })
    expect(await c.db.bodyEntries.get(SEED_DATE)).toMatchObject({
      source: 'user',
      weightLb: 163.2,
      bodyFatPct: 14.4,
      muscleMassLb: 132.1,
    })
    expect(await c.db.bodyEntries.get('2026-09-25' as never)).toMatchObject({
      source: 'user',
      weightLb: 162.8,
      skeletalMusclePct: 55.4,
      visceralRating: 5,
    })
    expect((await c.db.bodyEntries.get('2026-09-26' as never))?.weightLb).toBe(170)
    expect(await c.db.bodyEntries.get('2026-10-05' as never)).toBeUndefined()
  })

  it('by default replaces logged days (imported data wins) and restores deleted ones', async () => {
    const c = ctx()
    await saveWeighIn(c, { date: '2026-09-26', weightLb: 170, confirmed: true })
    await saveWeighIn(c, { date: '2026-09-25', weightLb: 150, confirmed: true })
    await voidBodyEntry(c, '2026-09-25')
    await importScaleReadings(c, { text: FILE })
    expect(await c.db.bodyEntries.get('2026-09-26' as never)).toMatchObject({ weightLb: 163 })
    expect(await c.db.bodyEntries.get('2026-09-25' as never)).toMatchObject({
      weightLb: 162.8,
      voidedAt: null,
    })
  })

  it('is idempotent: importing the same file twice changes nothing the second time', async () => {
    const c = ctx()
    await importScaleReadings(c, { text: FILE })
    const before = await c.db.bodyEntries.toArray()
    expect(await importScaleReadings(c, { text: FILE })).toMatchObject({ added: 0 })
    expect((await previewScaleImport(c, { text: FILE })).counts.same).toBe(3)
    expect(await c.db.bodyEntries.toArray()).toEqual(before)
  })

  it('refuses an empty file', async () => {
    await expect(importScaleReadings(ctx(), { text: '  ' })).rejects.toSatisfy((e) =>
      isServiceError(e, 'empty_file'),
    )
  })
})
