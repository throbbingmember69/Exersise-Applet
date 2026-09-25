import { afterEach, describe, expect, it } from 'vitest'
import { BODY_CSV_HEADER, NUTRITION_CSV_HEADER, SETS_CSV_HEADER } from '@/domain/csv'
import type { LocalDate } from '@/domain/types'
import { createTestCtx, today } from '../context'
import { insertSession } from '../training/testFixtures'
import { exportCsv } from './csvExport'

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

const d = (s: string) => s as LocalDate
const BOM = '﻿'

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF records. */
function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\r' && text[i + 1] === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
      i++
    } else field += ch
  }
  expect(field, 'every record ends in CRLF').toBe('')
  const [header, ...rows] = records
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i]!])))
}

async function logSomeTraining(c: ReturnType<typeof ctx>) {
  await insertSession(c, {
    programDayId: 'day-lower-a',
    date: '2026-09-28',
    exercises: [
      {
        slotId: 'slot-lower-a-1',
        exerciseId: 'ex-smith-squat',
        sets: [
          { loadLb: 135, reps: 10, rir: null, isWarmup: true },
          { loadLb: 220, reps: 10, rir: 2 },
          { loadLb: 220, reps: 9, rir: 1 },
          { loadLb: 220, reps: 8, rir: 1, voided: true },
          { loadLb: 220, reps: 8, rir: 0 },
        ],
      },
      {
        slotId: 'slot-lower-a-2',
        exerciseId: 'ex-leg-extension',
        sets: [
          { loadLb: 170, reps: 15, rir: 1 },
          { loadLb: 170, reps: 12, rir: null },
        ],
      },
    ],
  })
  await insertSession(c, {
    programDayId: 'day-push',
    date: '2026-09-29',
    exercises: [
      {
        slotId: 'slot-push-1',
        exerciseId: 'ex-incline-db-bench',
        sets: [
          [70, 10],
          [70, 9],
          [72.5, 8],
        ],
      },
      // A load entered in kg (20 kg) is stored in lb at full precision.
      { exerciseId: 'ex-hyper-y-w', sets: [{ loadLb: 20 / 0.45359237, reps: 12, rir: 1 }] },
    ],
  })
  await insertSession(c, {
    programDayId: 'day-pull',
    date: '2026-09-30',
    exercises: [
      {
        slotId: 'slot-pull-1',
        exerciseId: 'ex-weighted-chin-up',
        sets: [
          { loadLb: 50, reps: 8, rir: 2 },
          { loadLb: 0, reps: 7, rir: 1 },
          { loadLb: -15, reps: 8, rir: 0 },
        ],
      },
    ],
  })
  await insertSession(c, {
    programDayId: 'day-lower-b',
    date: '2026-10-02',
    voided: true,
    exercises: [{ slotId: 'slot-lower-b-1', exerciseId: 'ex-deadlift', sets: [[315, 8]] }],
  })
  await insertSession(c, {
    programDayId: 'day-upper',
    date: '2026-10-03',
    status: 'abandoned',
    exercises: [{ slotId: 'slot-upper-2', exerciseId: 'ex-cable-crossover', sets: [[60, 15]] }],
  })
}

describe('exportCsv: sets', () => {
  it('CSV export includes every set with date, exercise, load, reps and RIR', async () => {
    const c = ctx()
    await logSomeTraining(c)
    const csv = await exportCsv(c, 'sets', { today: d('2026-10-04') })

    expect(csv.fileName).toBe('exersise-sets-2026-10-04.csv')
    expect(csv.mimeType).toBe('text/csv')
    expect(csv.text.startsWith(BOM)).toBe(true)
    const rows = parseCsv(csv.text.slice(BOM.length))

    // Every set that isn't voided (on its own or with its session), straight from the database.
    const [sessions, sessionExercises, setLogs] = await Promise.all([
      c.db.sessions.toArray(),
      c.db.sessionExercises.toArray(),
      c.db.setLogs.toArray(),
    ])
    const sessionById = new Map(sessions.map((s) => [s.id, s]))
    const exerciseName = new Map(sessionExercises.map((se) => [se.id, se.exerciseName]))
    const expected = setLogs
      .filter((s) => s.voidedAt === null && sessionById.get(s.sessionId)!.voidedAt === null)
      .map((s) => ({
        date: sessionById.get(s.sessionId)!.date,
        exercise: exerciseName.get(s.sessionExerciseId)!,
        load: s.loadLb,
        reps: s.reps,
        rir: s.rir,
      }))
    const exported = rows.map((r) => ({
      date: r.date,
      exercise: r.exercise,
      load: Number(r.load_lb),
      reps: Number(r.reps),
      rir: r.rir === '' ? null : Number(r.rir),
    }))
    const key = (x: {
      date: string | undefined
      exercise: string | undefined
      load: number
      reps: number
      rir: number | null
    }) => JSON.stringify([x.date, x.exercise, x.load.toFixed(4), x.reps, x.rir])
    expect(exported.map(key).sort()).toEqual(expected.map(key).sort())
    // 16 logged sets: one voided on its own, one in a voided session.
    expect(setLogs).toHaveLength(16)
    expect(rows).toHaveLength(14)

    for (const column of ['date', 'exercise', 'load_lb', 'reps', 'rir']) {
      expect(SETS_CSV_HEADER).toContain(column)
    }
    // Warm-ups are exported and flagged; negative (assisted) loads stay numbers.
    expect(rows.filter((r) => r.is_warmup === 'true')).toEqual([
      expect.objectContaining({ exercise: 'Smith machine squat', load_lb: '135', reps: '10' }),
    ])
    expect(rows.find((r) => r.load_lb === '-15')).toMatchObject({
      exercise: 'Weighted chin-up',
      program_day: 'Pull',
      gym: 'Gym 1',
    })
    // The abandoned session's set is kept and labelled.
    expect(rows.find((r) => r.exercise === 'Cable crossover')).toMatchObject({
      session_status: 'abandoned',
      date: '2026-10-03',
    })
    // Rows come out in session order.
    expect([...new Set(rows.map((r) => r.date))]).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-03',
    ])
  })

  it('uses the current date for the file name by default', async () => {
    const c = ctx()
    const csv = await exportCsv(c, 'sets')
    expect(csv.fileName).toBe(`exersise-sets-${today(c)}.csv`)
    expect(csv.text).toBe(`${BOM}${SETS_CSV_HEADER.join(',')}\r\n`)
  })
})

describe('exportCsv: body and nutrition', () => {
  it('exports body entries by date, without voided ones', async () => {
    const c = ctx()
    const entry = {
      bodyFatPct: null,
      muscleMassLb: null,
      skeletalMusclePct: null,
      subcutFatPct: null,
      visceralRating: null,
      source: 'user' as const,
      note: '',
      createdAt: 0,
      updatedAt: 0,
    }
    await c.db.bodyEntries.bulkAdd([
      {
        ...entry,
        date: d('2026-09-26'),
        weightLb: 162.8,
        note: 'fasted, "after" run',
        voidedAt: null,
      },
      { ...entry, date: d('2026-09-25'), weightLb: 216, voidedAt: 1 },
    ])
    const csv = await exportCsv(c, 'body', { today: d('2026-10-01') })
    expect(csv.fileName).toBe('exersise-body-2026-10-01.csv')
    const rows = parseCsv(csv.text.slice(BOM.length))
    expect(Object.keys(rows[0]!)).toEqual([...BODY_CSV_HEADER])
    expect(rows.map((r) => [r.date, r.weight_lb, r.body_fat_pct, r.source, r.note])).toEqual([
      ['2026-09-24', '163', '14.3', 'seed', 'Baseline from the spec (smart scale)'],
      ['2026-09-26', '162.8', '', 'user', 'fasted, "after" run'],
    ])
  })

  it('exports daily nutrition totals by date', async () => {
    const c = ctx()
    await c.db.nutritionEntries.bulkAdd([
      {
        date: d('2026-09-26'),
        kcal: 2950,
        proteinG: 150,
        carbsG: 400,
        fatG: 83,
        steps: 9000,
        updatedAt: 0,
      },
      {
        date: d('2026-09-25'),
        kcal: 3010,
        proteinG: null,
        carbsG: null,
        fatG: null,
        steps: null,
        updatedAt: 0,
      },
    ])
    const csv = await exportCsv(c, 'nutrition', { today: d('2026-10-01') })
    expect(csv.fileName).toBe('exersise-nutrition-2026-10-01.csv')
    expect(csv.text).toBe(
      BOM +
        `${NUTRITION_CSV_HEADER.join(',')}\r\n` +
        '2026-09-25,3010,,,,\r\n' +
        '2026-09-26,2950,150,400,83,9000\r\n',
    )
  })
})
