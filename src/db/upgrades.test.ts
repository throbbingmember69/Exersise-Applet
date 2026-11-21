// The 2026 upgrades on a real (fake-indexeddb) database: a v1 database holding history is opened
// by the current app (v1 → v2 → v3 → v4). History must come through untouched; only the library and
// program change, and v4 adds an empty cardio log.
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

const V1_TABLES = TABLE_NAMES.filter((t) => t in STORES_V1)

const PROGRAM_TABLES = new Set([
  'muscles',
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

  // Dump every v1 table in its v1 shape (exercises had no formUrl; cardioLogs came in v4).
  const rows: Record<string, Row[]> = {}
  for (const name of V1_TABLES) {
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
    for (const table of V1_TABLES) await v1.table(table).bulkAdd(rows[table]!)
  })
  v1.close()
  return { name, rows }
}

const byKey = (table: string, rows: Row[]) => {
  const key = PRIMARY_KEYS[table as keyof typeof PRIMARY_KEYS]
  return [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])))
}

describe('Dexie upgrades v1 → v2 → v3 → v4', () => {
  it('keeps every history row byte-for-byte and updates only the library and program', async () => {
    const { name, rows } = await v1DatabaseWithHistory()
    const db = new AppDB(name)
    await db.open()
    expect(db.verno).toBe(4)

    for (const table of V1_TABLES) {
      if (PROGRAM_TABLES.has(table)) continue
      expect(byKey(table, (await db.table(table).toArray()) as Row[]), table).toEqual(
        byKey(table, rows[table]!),
      )
    }
    expect(await db.sessions.count()).toBe(1)
    expect(await db.setLogs.count()).toBe(2)

    // Library: everything kept (formUrl added; v3 re-weights back work and promotes the shrug),
    // the cable press archived, both catalogs added.
    const exercises = await db.exercises.toArray()
    for (const old of rows.exercises!) {
      const now = exercises.find((e) => e.id === old.id)!
      const {
        archivedAt: _a,
        updatedAt: _u,
        muscleWeights: _w,
        notes: _n,
        isFinisher: _f,
        ...same
      } = old
      expect(now, String(old.id)).toMatchObject({ ...same, formUrl: null })
    }
    expect((await db.exercises.get('ex-rocking-pulldown'))?.muscleWeights).toEqual({
      back: 1,
      upper_back: 0.5,
      biceps: 0.5,
    })
    expect((await db.exercises.get('ex-machine-barbell-row'))?.muscleWeights).toEqual({
      upper_back: 1,
      back: 0.5,
      biceps: 0.5,
      rear_delts: 0.5,
    })
    expect(await db.exercises.get('ex-cable-shrug')).toBeDefined()
    expect((await db.exercises.get('ex-incline-cable-press'))?.archivedAt).not.toBeNull()
    expect(await db.exercises.get('ex-hip-abduction')).toBeDefined()
    expect(exercises.filter((e) => e.name === 'Belt squat')).toHaveLength(1)

    // Program: Smith press on Upper, abduction on both lower days, the user's override kept.
    expect((await db.programSlots.get('slot-upper-1'))?.defaultExerciseId).toBe(
      'ex-incline-smith-press',
    )
    // (Lower A's moved to 5 when v4 put the back extension after the leg curl.)
    expect((await db.programSlots.get('slot-lower-a-abduction'))?.order).toBe(5)
    expect((await db.programSlots.get('slot-lower-b-abduction'))?.order).toBe(4)
    expect(await db.gymSlotOverrides.toArray()).toEqual(rows.gymSlotOverrides)
    expect(await db.trackStarts.get('day-upper|ex-incline-smith-press|gym-1')).toMatchObject({
      startLoadLb: null,
      calibrate: true,
    })

    // v4: the November swaps and added slots, and an empty cardio log.
    expect(await db.cardioLogs.count()).toBe(0)
    expect((await db.programSlots.get('slot-lower-b-1'))?.defaultExerciseId).toBe('ex-rdl')
    expect((await db.programSlots.get('slot-pull-7'))?.defaultExerciseId).toBe('ex-bayesian-curl')
    expect((await db.programSlots.get('slot-upper-6'))?.defaultExerciseId).toBe(
      'ex-overhead-rope-extension',
    )
    expect((await db.programSlots.get('slot-push-5'))?.sets).toBe(4)
    expect(await db.programSlots.get('slot-lower-a-back-extension')).toMatchObject({ order: 3 })
    expect(await db.programSlots.get('slot-upper-rear-delt-fly')).toBeDefined()
    // The user's gym override on the Pull pulldown slot still wins over the new default.
    expect((await db.programSlots.get('slot-pull-3'))?.defaultExerciseId).toBe(
      'ex-neutral-pulldown',
    )

    // The upgraded data works: the plan has the new glute volume, the logged press still counts.
    const ctx: ServiceCtx = { db, now: () => Date.UTC(2026, 9, 3, 18), newId: () => 'x' }
    const dash = await getVolumeDashboard(ctx, {
      weekOf: '2026-10-03' as never,
      today: '2026-10-03' as never,
      gymId: 'gym-1',
    })
    const muscle = (id: string) => dash.muscles.find((m) => m.muscleId === id)!
    // 16 after October; the v4 back extension adds 3 × ½.
    expect(muscle('glutes').planned).toBe(17.5)
    expect(muscle('hamstrings').planned).toBe(12)
    expect(muscle('chest').logged).toBe(2)

    // v3: Back became Lats, Upper back and Traps are tracked, and the back plan grew.
    expect(await db.muscles.get('back')).toMatchObject({ name: 'Lats', lagging: true })
    expect(await db.muscles.get('upper_back')).toMatchObject({ name: 'Upper back', lagging: false })
    expect(await db.muscles.get('traps')).toMatchObject({ exemptLow: false, lagging: true })
    expect([muscle('back').planned, muscle('upper_back').planned, muscle('traps').planned]).toEqual(
      // This gym swaps the Pull-day rocking pulldown (3 lat sets) for a face pull.
      [9, 12.5, 6],
    )
    // Past weeks don't flag the muscles that weren't tracked yet.
    expect([muscle('upper_back').loggedFlag, muscle('traps').loggedFlag]).toEqual([null, null])
    db.close()
  })

  it('opens a fresh database at v4 with the updated seed (no upgrade needed)', async () => {
    const name = `fresh-${crypto.randomUUID()}`
    names.push(name)
    const db = new AppDB(name)
    await db.open()
    expect(db.verno).toBe(4)
    expect((await db.programSlots.get('slot-pull-7'))?.defaultExerciseId).toBe('ex-bayesian-curl')
    expect(await db.cardioLogs.count()).toBe(0)
    expect((await db.programSlots.get('slot-upper-1'))?.defaultExerciseId).toBe(
      'ex-incline-smith-press',
    )
    expect(await db.programSlots.get('slot-lower-b-abduction')).toBeDefined()
    db.close()
  })
})
