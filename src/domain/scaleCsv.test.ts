import { describe, expect, it } from 'vitest'
import { detectColumns, parseNumberCell, parseScaleCsv, readDelimited } from './scaleCsv'
import { kgToLb } from './units'

// Shaped like a smart-scale app export (Arboleaf-style metrics); two readings on 09-24.
const ARBOLEAF_LIKE = [
  'Time,Weight(lb),BMI,Body Fat(%),Fat-free Body Weight(lb),Subcutaneous Fat(%),Visceral Fat,Body Water(%),Skeletal Muscle(%),Muscle Mass(lb),Bone Mass(lb),Protein(%),BMR(kcal),Metabolic Age',
  '2026-09-24 18:05:10,164.2,22.9,14.6,140.2,12.9,5,57.9,55.1,132.4,7.7,19.1,1745,20',
  '2026-09-24 07:12:30,163.0,22.7,14.3,139.7,12.7,5,58.1,55.3,132.0,7.7,19.2,1740,20',
  '2026-09-25 07:05:00,162.8,22.7,14.2,139.7,12.6,5,58.2,55.4,131.9,7.7,19.2,1739,20',
].join('\r\n')

describe('parseScaleCsv', () => {
  it('reads an Arboleaf-style export: columns by header, lb, earliest reading per day', () => {
    const r = parseScaleCsv(ARBOLEAF_LIKE)
    expect(r.massUnit).toBe('lb')
    expect(r.dateOrder).toBe('YMD')
    expect(r.rowCount).toBe(3)
    expect(r.readings).toEqual([
      {
        date: '2026-09-24',
        minuteOfDay: 7 * 60 + 12,
        rawDate: '2026-09-24 07:12:30',
        weightLb: 163,
        bodyFatPct: 14.3,
        muscleMassLb: 132,
        skeletalMusclePct: 55.3,
        subcutFatPct: 12.7,
        visceralRating: 5,
      },
      expect.objectContaining({ date: '2026-09-25', weightLb: 162.8, bodyFatPct: 14.2 }),
    ])
    // BMI, fat-free weight, water, bone, protein, BMR, age aren't stored.
    expect(r.columns.ignored).toEqual(
      expect.arrayContaining(['BMI', 'Fat-free Body Weight(lb)', 'Body Water(%)', 'BMR(kcal)']),
    )
    expect(r.warnings).toEqual([])
  })

  it('handles kg values with suffixes, M/D/Y dates and 12-hour times', () => {
    const csv =
      'Date,Weight,Body Fat,Muscle Mass\n"09/24/2026 7:12 AM","73.9kg",14.3%,59.9kg\n"09/24/2026 1:00 PM",74.5kg,14.8%,60.1kg'
    const r = parseScaleCsv(csv)
    expect(r.massUnit).toBe('kg')
    expect(r.dateOrder).toBe('MDY')
    expect(r.readings).toHaveLength(1)
    expect(r.readings[0]!.minuteOfDay).toBe(7 * 60 + 12)
    expect(r.readings[0]!.weightLb).toBeCloseTo(kgToLb(73.9), 9)
    expect(r.readings[0]!.muscleMassLb).toBeCloseTo(kgToLb(59.9), 9)
    expect(r.readings[0]!.bodyFatPct).toBe(14.3)
  })

  it('decides D/M/Y when any day is over 12, and reads semicolons with decimal commas', () => {
    const csv =
      'Datum;Weight (kg);Body fat (%)\n05/09/2026 07:00;74,1;15,2\n25/09/2026 07:00;73,9;14,9'
    const r = parseScaleCsv(csv)
    expect(r.dateOrder).toBe('DMY')
    expect(r.readings.map((x) => x.date)).toEqual(['2026-09-05', '2026-09-25'])
    expect(r.readings[1]!.bodyFatPct).toBe(14.9)
    expect(r.readings[1]!.weightLb).toBeCloseTo(kgToLb(73.9), 9)
  })

  it('reads month-name dates', () => {
    const r = parseScaleCsv('Measurement time,Weight(lbs)\n"Sep 24, 2026 7:12 AM",163.4')
    expect(r.dateOrder).toBe('named')
    expect(r.readings[0]).toMatchObject({ date: '2026-09-24', weightLb: 163.4 })
  })

  it('reports an unknown mass unit (weights left out) until one is given', () => {
    const csv = 'Time,Weight,Body Fat(%)\n2026-09-24 07:00,163.0,14.3'
    expect(parseScaleCsv(csv)).toMatchObject({
      massUnit: null,
      readings: [{ weightLb: null, bodyFatPct: 14.3 }],
    })
    expect(parseScaleCsv(csv, { massUnit: 'lb' }).readings[0]!.weightLb).toBe(163)
  })

  it('skips rows with unreadable dates or no values, and explains a missing date column', () => {
    const r = parseScaleCsv(
      'Time,Weight(lb)\nyesterday,163\n2026-09-25 07:00,--\n2026-09-26 07:00,162.5',
    )
    expect(r.readings.map((x) => x.date)).toEqual(['2026-09-26'])
    expect(r.warnings).toEqual([
      'Row 2: unreadable date "yesterday", skipped.',
      'Row 3: no readable values, skipped.',
    ])
    expect(parseScaleCsv('Weight(lb)\n163').warnings).toEqual(['No date column found.'])
    expect(parseScaleCsv('Time,Steps\n2026-09-26,9000').warnings).toEqual([
      'No weight or body-composition columns found.',
    ])
  })

  it('rejects impossible dates', () => {
    const r = parseScaleCsv('Time,Weight(lb)\n2026-02-30 07:00,163')
    expect(r.readings).toEqual([])
    expect(r.warnings[0]).toMatch(/unreadable date/)
  })
})

// The real Arboleaf export's headers and date format (newest first, "- -" for missing values,
// dozens of extra columns); the values here are made up.
const ARBOLEAF_REAL = [
  'Measure Time,Weight(lb),Body Fat(%),BMI,Skeletal Muscle(%),Muscle Mass(lb),Protein(%),BMR(kcal),Fat-free Body Weight(lb),Subcutaneous Fat Percentage(%),Visceral Fat,Body Water(%),Bone Mass(lb),Body Type,Metabolic Age,Subcutaneous Fat(lb),Skeleton Muscle Mass(lb),Muscle Mass Percentage(%),Body Fat Mass(lb),Weight Control(lb),Target Weight(lb),Left arm muscle mass(lb),Body fat rate of right upper limb(%),Device Name',
  '09/26/2026 08:31:01,163.7,14.4,22.8,55.2,133.1,19.2,1745,140.1,12.8,5,58.0,7.8,Normal,21,20.9,90.4,81.3,23.6,0,165,8.1,15.0,Scale',
  '09/26/2026 08:30:40,163.7,- -,22.8,- -,- -,- -,- -,- -,- -,- -,- -,- -,,- -,,,,,,,,,Scale',
  '09/26/2026 08:30:24,163.9,14.5,22.8,55.1,133.0,19.2,1744,140.0,12.9,5,57.9,7.8,Normal,21,21.0,90.3,81.2,23.8,0,165,8.1,15.1,Scale',
  '09/22/2026 05:49:36,163.5,14.3,22.8,55.3,132.9,19.2,1743,140.1,12.7,5,58.1,7.8,Normal,21,20.8,90.4,81.3,23.4,0,165,8.1,14.9,Scale',
  '09/22/2026 05:49:27,163.5,- -,22.8,- -,- -,- -,- -,- -,- -,- -,- -,- -,,- -,,,,,,,,,Scale',
].join('\n')

describe('parseScaleCsv on the real Arboleaf layout', () => {
  it('finds the columns, reads M/D/Y with seconds, and fills each value from the earliest reading that has it', () => {
    const r = parseScaleCsv(ARBOLEAF_REAL)
    expect(r.dateOrder).toBe('MDY')
    expect(r.massUnit).toBe('lb')
    expect(
      Object.fromEntries(Object.entries(r.columns.fields).map(([k, i]) => [k, r.headers[i]])),
    ).toEqual({
      weight: 'Weight(lb)',
      bodyFatPct: 'Body Fat(%)',
      skeletalMusclePct: 'Skeletal Muscle(%)',
      muscleMass: 'Muscle Mass(lb)',
      subcutFatPct: 'Subcutaneous Fat Percentage(%)',
      visceralRating: 'Visceral Fat',
    })
    expect(r.readings).toEqual([
      {
        // 05:49:27 is weight only; the full reading 9 s later supplies the rest.
        date: '2026-09-22',
        minuteOfDay: 5 * 60 + 49,
        rawDate: '09/22/2026 05:49:27',
        weightLb: 163.5,
        bodyFatPct: 14.3,
        muscleMassLb: 132.9,
        skeletalMusclePct: 55.3,
        subcutFatPct: 12.7,
        visceralRating: 5,
      },
      {
        // Earliest by seconds (08:30:24), not the first row in the file.
        date: '2026-09-26',
        minuteOfDay: 8 * 60 + 30,
        rawDate: '09/26/2026 08:30:24',
        weightLb: 163.9,
        bodyFatPct: 14.5,
        muscleMassLb: 133,
        skeletalMusclePct: 55.1,
        subcutFatPct: 12.9,
        visceralRating: 5,
      },
    ])
  })
})

describe('helpers', () => {
  it('reads quoted fields with delimiters, quotes and line breaks', () => {
    expect(readDelimited('a,"b,c","d ""e"""\r\n1,2,3\n', ',')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ])
  })

  it('parses number cells', () => {
    expect(parseNumberCell(' 75.3kg ', false)).toBe(75.3)
    expect(parseNumberCell('1,740', false)).toBe(1740)
    expect(parseNumberCell('16,2 %', true)).toBe(16.2)
    expect(parseNumberCell('--', false)).toBeNull()
    expect(parseNumberCell('', false)).toBeNull()
  })

  it('does not mistake mass columns for percentages', () => {
    const cols = detectColumns([
      'Time',
      'Skeletal Muscle Mass(kg)',
      'Subcutaneous Fat(%)',
      'Body Fat Mass(lb)',
    ])
    expect(cols.fields).toEqual({ subcutFatPct: 2 })
  })
})
