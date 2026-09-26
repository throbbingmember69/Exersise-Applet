import { describe, expect, it } from 'vitest'
import { parseCronometerCsv } from './cronometerCsv'

// Shaped like Cronometer's Daily Nutrition export (a few of its many nutrient columns).
const DAILY = [
  'Date,Energy (kcal),Alcohol (g),Caffeine (mg),Water (g),Carbs (g),Fiber (g),Net Carbs (g),Fat (g),Monounsaturated (g),Saturated (g),Trans-Fats (g),Protein (g),Completed',
  '2026-09-24,2712.4,0.0,95.0,2100.3,301.2,38.1,263.1,82.6,30.2,24.1,0.2,158.3,true',
  '2026-09-25,2988.0,0.0,190.0,2400.0,340.0,40.0,300.0,91.0,33.0,27.0,0.1,162.0,false',
  '2026-09-26,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,false',
].join('\r\n')

// Shaped like the Servings export: one row per food.
const SERVINGS = [
  'Day,Time,Group,Food Name,Amount,Energy (kcal),Carbs (g),Net Carbs (g),Fat (g),Protein (g),Category',
  '2026-09-25,07:30,Breakfast,"Oats, rolled",80 g,300.8,54.0,46.0,5.2,10.6,Grains',
  '2026-09-25,12:15,Lunch,Chicken breast,200 g,330.0,0.0,0.0,7.2,62.0,Meat',
  '2026-09-25,18:00,Dinner,Water,500 ml,0.0,,,,,Beverages',
  '2026-09-26,08:00,Breakfast,Eggs,3 large,215.0,1.1,1.1,14.3,18.9,Eggs',
].join('\n')

describe('parseCronometerCsv', () => {
  it('reads a Daily Nutrition export: total carbs and fat, not net carbs or fat subtypes', () => {
    const r = parseCronometerCsv(DAILY)
    expect(r.kind).toBe('daily')
    expect(r.dateOrder).toBe('YMD')
    expect(r.recognized).toEqual({
      date: 'Date',
      kcal: 'Energy (kcal)',
      proteinG: 'Protein (g)',
      carbsG: 'Carbs (g)',
      fatG: 'Fat (g)',
    })
    expect(r.ignoredCount).toBe(9)
    expect(r.days).toEqual([
      { date: '2026-09-24', kcal: 2712.4, proteinG: 158.3, carbsG: 301.2, fatG: 82.6, rows: 1 },
      { date: '2026-09-25', kcal: 2988, proteinG: 162, carbsG: 340, fatG: 91, rows: 1 },
    ])
    expect(r.warnings).toEqual(['1 day with no calories logged was skipped.'])
  })

  it('sums a Servings export per day (a blank cell counts as 0 for that food)', () => {
    const r = parseCronometerCsv(SERVINGS)
    expect(r.kind).toBe('servings')
    expect(r.recognized.date).toBe('Day')
    const [d25, d26] = r.days
    expect(d25).toMatchObject({ date: '2026-09-25', rows: 3 })
    expect(d25!.kcal).toBeCloseTo(630.8, 9)
    expect(d25!.proteinG).toBeCloseTo(72.6, 9)
    expect(d25!.carbsG).toBeCloseTo(54, 9)
    expect(d25!.fatG).toBeCloseTo(12.4, 9)
    expect(d26).toMatchObject({ date: '2026-09-26', kcal: 215, proteinG: 18.9, rows: 1 })
  })

  it('converts kJ to kcal, strips a BOM and reads semicolons with decimal commas', () => {
    const r = parseCronometerCsv(
      '\uFEFFDate;Energy (kJ);Protein (g);Carbs (g);Fat (g)\n2026-09-25;12552;160,5;300;80',
    )
    expect(r.days).toHaveLength(1)
    expect(r.days[0]!.kcal).toBeCloseTo(3000, 9)
    expect(r.days[0]!.proteinG).toBe(160.5)
  })

  it('leaves macros out when their columns are missing', () => {
    const r = parseCronometerCsv('Date,Energy (kcal)\n2026-09-25,2500')
    expect(r.days).toEqual([
      { date: '2026-09-25', kcal: 2500, proteinG: null, carbsG: null, fatG: null, rows: 1 },
    ])
  })

  it('explains a file it cannot use', () => {
    expect(parseCronometerCsv('Time,Weight(lb)\n2026-09-25 07:00,163').warnings).toEqual([
      'No "Date" or "Day" column found. Is this a Cronometer export?',
    ])
    const noEnergy = parseCronometerCsv('Date,Protein (g)\n2026-09-25,160')
    expect(noEnergy.kind).toBe('daily')
    expect(noEnergy.days).toEqual([])
    expect(noEnergy.warnings).toEqual(['No energy (calories) column found.'])
  })

  it('skips unreadable dates and uses the later row for a repeated day', () => {
    const r = parseCronometerCsv(
      'Date,Energy (kcal)\nnot a date,2000\n2026-09-25,2400\n2026-09-25,2600',
    )
    expect(r.days).toEqual([
      { date: '2026-09-25', kcal: 2600, proteinG: null, carbsG: null, fatG: null, rows: 1 },
    ])
    expect(r.warnings).toEqual([
      'Row 2: unreadable date "not a date", skipped.',
      'Row 4: 2026-09-25 appears twice; the later row is used.',
    ])
  })
})
