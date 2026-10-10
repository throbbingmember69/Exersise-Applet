// The October 2026 upgrade on a real (fake-indexeddb) database: a v1 database holding history is
// opened by the v2 app. History must come through untouched; only the library and program change.
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestCtx, type ServiceCtx } from '@/services/context'
import { saveWeighIn } from '@/services/nutrition/body'
import { saveIntake } from '@/services/nutrition/intake'
import { createExercise, setGymSlotOverride } from '@/services/program/commands'
import { getVolumeDashboard } from '@/services/training/queries'
import { finishSession, logSet, startSession } from '@/services/training/session'
import { TABLE_NAMES, PRIMARY_KEYS } from './backupSchema'
import { AppDB, STORES_V1 } from './schema'

type Row = Record<string, unknown>
const names: string[] = []
afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

const PROGRAM_TABLES = new Set([
  'exercises',
  'programSlots',
  'gymSlotOverrides',
  'trackStarts',
  'gyms',
  'programDays',
])

/** A v1 database with real history: an Upper workout on the cable press, a weigh-in, food. */
async function v1DatabaseWithHistory(): Promise<{ name: string; rows: Record<string, Row[]> }> {
  const c = createTestCtx({ startMs: Date.UTC(2026, 9, 3, 12) }) // the spec seed, as shipped
  const sessionId = await startSession(c, { gymId: 'gym-1', programDayId: 'day-upper' })
  const press = (await c.db.sessionExercises.where('sessionId').equals(sessionId).first())!
  expect(press.exerciseId).toBe('ex-incline-cable-press')
  await logSet(c, { sessionExerciseId: press.id, loadLb: 55, reps: 10 })
  await logSet(c, { sessionExerciseId: press.id, loadLb: 55, reps: 9 })
  await finishSession(c, sessionId, {})
  await saveWeighIn(c, { date: '2026-10-03', weightLb: 164.2, confirmed: true })
  await saveIntake(c, { date: '2026-10-03', kcal: 2950, proteinG: 180, steps: 9000 })
  await createExercise(c, {
    name: 'Belt squat',
    loadType: 'machine',
    stepLb: 10,
    defaultRegime: {
      sets: 3,
      repMin: 8,
      repMax: 12,
      rirMin: 1,
      rirMax: 2,
      restMinSec: 120,
      restMaxSec: 120,
    },
    muscleWeights: { quads: 1, glutes: 0.5 },
  })
  await setGymSlotOverride(c, 'gym-1', 'slot-pull-3', 'ex-face-pull')

  // Dump every table in its v1 shape (exercises had no formUrl).
  const rows: Record<string, Row[]> = {}
  for (const name of TABLE_NAMES) {
    const all = (await c.db.table(name).toArray()) as Row[]
    rows[name] = name === 'exercises' ? all.map(({ formUrl: _formUrl, ...e }) => e) : all
  }
  c.db.close()
  await c.db.delete()

  const name = `upgrade-${crypto.randomUUID()}`
  names.push(name)
  const v1 = new Dexie(name)
  v1.version(1).stores(STORES_V1)
  await v1.open()
  await v1.transaction('rw', v1.tables, async () => {
    for (const table of TABLE_NAMES) await v1.table(table).bulkAdd(rows[table]!)
  })
  v1.close()
  return { name, rows }
}

const byKey = (table: string, rows: Row[]) => {
  const key = PRIMARY_KEYS[table as keyof typeof PRIMARY_KEYS]
  return [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])))
}

describe('Dexie upgrade v1 → v2', () => {
  it('keeps every history row byte-for-byte and updates only the library and program', async () => {
    const { name, rows } = await v1DatabaseWithHistory()
    const db = new AppDB(name)
    await db.open()
    expect(db.verno).toBe(2)

    for (const table of TABLE_NAMES) {
      if (PROGRAM_TABLES.has(table)) continue
      expect(byKey(table, (await db.table(table).toArray()) as Row[]), table).toEqual(
        byKey(table, rows[table]!),
      )
    }
    expect(await db.sessions.count()).toBe(1)
    expect(await db.setLogs.count()).toBe(2)

    // Library: everything kept (formUrl added), the cable press archived, the catalog added.
    const exercises = await db.exercises.toArray()
    for (const old of rows.exercises!) {
      const now = exercises.find((e) => e.id === old.id)!
      const { archivedAt: _a, updatedAt: _u, ...same } = old
      expect(now, String(old.id)).toMatchObject({ ...same, formUrl: null })
    }
    expect((await db.exercises.get('ex-incline-cable-press'))?.archivedAt).not.toBeNull()
    expect(await db.exercises.get('ex-hip-abduction')).toBeDefined()
    expect(exercises.filter((e) => e.name === 'Belt squat')).toHaveLength(1)

    // Program: Smith press on Upper, abduction on both lower days, the user's override kept.
    expect((await db.programSlots.get('slot-upper-1'))?.defaultExerciseId).toBe(
      'ex-incline-smith-press',
    )
    expect((await db.programSlots.get('slot-lower-a-abduction'))?.order).toBe(4)
    expect((await db.programSlots.get('slot-lower-b-abduction'))?.order).toBe(4)
    expect(await db.gymSlotOverrides.toArray()).toEqual(rows.gymSlotOverrides)
    expect(await db.trackStarts.get('day-upper|ex-incline-smith-press|gym-1')).toMatchObject({
      startLoadLb: null,
      calibrate: true,
    })

    // The upgraded data works: the plan has the new glute volume, the logged press still counts.
    const ctx: ServiceCtx = { db, now: () => Date.UTC(2026, 9, 3, 18), newId: () => 'x' }
    const dash = await getVolumeDashboard(ctx, {
      weekOf: '2026-10-03' as never,
      today: '2026-10-03' as never,
      gymId: 'gym-1',
    })
    const glutes = dash.muscles.find((m) => m.muscleId === 'glutes')!
    expect(glutes.planned).toBe(16)
    expect(dash.muscles.find((m) => m.muscleId === 'chest')!.logged).toBe(2)
    db.close()
  })

  it('opens a fresh database at v2 with the updated seed (no upgrade needed)', async () => {
    const name = `fresh-${crypto.randomUUID()}`
    names.push(name)
    const db = new AppDB(name)
    await db.open()
    expect(db.verno).toBe(2)
    expect((await db.programSlots.get('slot-upper-1'))?.defaultExerciseId).toBe(
      'ex-incline-smith-press',
    )
    expect(await db.programSlots.get('slot-lower-b-abduction')).toBeDefined()
    db.close()
  })
})
