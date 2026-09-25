import type { Table } from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, TABLE_NAMES } from '@/db/backupSchema'
import type {
  BodyEntry,
  CheckIn,
  LocalDate,
  NutritionEntry,
  Phase,
  Suggestion,
  TargetRevision,
} from '@/domain/types'
import { createTestCtx, type ServiceCtx } from '../context'
import { isServiceError, type ServiceError } from '../errors'
import { insertSession } from '../training/testFixtures'
import {
  backupFileName,
  exportBackup,
  getBackupReminder,
  importBackup,
  markBackupSaved,
  serializeBackup,
} from './backup'

type TestCtx = ReturnType<typeof createTestCtx>
const ctxs: TestCtx[] = []
function ctx(opts?: Parameters<typeof createTestCtx>[0]) {
  const c = createTestCtx(opts)
  ctxs.push(c)
  return c
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

const DAY = 86_400_000
const d = (s: string) => s as LocalDate
const T0 = Date.UTC(2026, 8, 24, 12)

async function dumpAll(c: Pick<ServiceCtx, 'db'>): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of TABLE_NAMES) out[name] = await c.db.table(name).toArray()
  return out
}

async function historyTotal(c: Pick<ServiceCtx, 'db'>): Promise<number> {
  return (
    (await c.db.sessions.count()) +
    (await c.db.setLogs.count()) +
    (await c.db.bodyEntries.count()) +
    (await c.db.nutritionEntries.count())
  )
}

async function expectServiceError(p: Promise<unknown>, code: string): Promise<ServiceError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  )
  expect(isServiceError(e, code), `expected ServiceError ${code}, got ${String(e)}`).toBe(true)
  return e as ServiceError
}

/** A month of realistic use on top of the first-launch seed: every table gets rows. */
async function addRealisticHistory(c: Pick<ServiceCtx, 'db'>): Promise<void> {
  const { db } = c
  await insertSession(c, {
    id: 'sess-a1',
    programDayId: 'day-lower-a',
    date: '2026-09-28',
    exercises: [
      {
        slotId: 'slot-lower-a-1',
        exerciseId: 'ex-smith-squat',
        sets: [
          { loadLb: 135, reps: 8, rir: null, isWarmup: true },
          [220, 10],
          [220, 9],
          [220, 8],
          { loadLb: 220, reps: 8, rir: 2 },
        ],
      },
      {
        slotId: 'slot-lower-a-2',
        exerciseId: 'ex-leg-extension',
        sets: [
          [170, 15],
          [170, 13],
        ],
      },
      { exerciseId: 'ex-barbell-shrug', sets: [[135, 12]] },
    ],
  })
  await insertSession(c, {
    id: 'sess-p1',
    programDayId: 'day-push',
    date: '2026-09-29',
    jointPain: true,
    exercises: [
      {
        slotId: 'slot-push-1',
        exerciseId: 'ex-incline-db-bench',
        sets: [[70, 10], { loadLb: 70, reps: 9, voided: true }, [70, 9], [72.5, 8]],
      },
      {
        slotId: 'slot-push-2',
        exerciseId: 'ex-flat-machine-press',
        isCalibration: true,
        sets: [[100, 12]],
      },
    ],
  })
  await insertSession(c, {
    id: 'sess-u1',
    programDayId: 'day-pull',
    date: '2026-09-30',
    bodyweightLb: 162.4,
    exercises: [
      {
        slotId: 'slot-pull-1',
        exerciseId: 'ex-weighted-chin-up',
        sets: [
          [50, 8],
          [0, 7],
          [-10, 8],
        ],
      },
    ],
  })
  await insertSession(c, {
    id: 'sess-void',
    programDayId: 'day-lower-b',
    date: '2026-10-02',
    voided: true,
    exercises: [{ slotId: 'slot-lower-b-1', exerciseId: 'ex-deadlift', sets: [[315, 8]] }],
  })
  await insertSession(c, {
    id: 'sess-abandoned',
    programDayId: 'day-upper',
    gymId: 'gym-2',
    date: '2026-10-03',
    status: 'abandoned',
    bodyweightLb: null,
    exercises: [{ slotId: 'slot-upper-1', exerciseId: 'ex-incline-cable-press', sets: [[50, 10]] }],
  })
  await insertSession(c, {
    id: 'sess-live',
    programDayId: 'day-lower-a',
    date: '2026-10-05',
    status: 'in_progress',
    isDeload: true,
    exercises: [{ slotId: 'slot-lower-a-1', exerciseId: 'ex-smith-squat', sets: [[200, 10]] }],
  })

  const body = (
    date: string,
    weightLb: number | null,
    extra: Partial<BodyEntry> = {},
  ): BodyEntry => ({
    date: d(date),
    weightLb,
    bodyFatPct: null,
    muscleMassLb: null,
    skeletalMusclePct: null,
    subcutFatPct: null,
    visceralRating: null,
    source: 'user',
    note: '',
    createdAt: T0,
    updatedAt: T0,
    voidedAt: null,
    ...extra,
  })
  await db.bodyEntries.bulkPut([
    body('2026-09-25', 163.2),
    body('2026-09-26', 162.8, {
      bodyFatPct: 14.1,
      muscleMassLb: 131.5,
      note: 'after "cardio", fasted',
    }),
    body('2026-09-27', 216, { voidedAt: T0 + 3 * DAY, note: 'typo' }),
    body('2026-10-01', null, { bodyFatPct: 14.0, visceralRating: 5 }),
  ])
  const food = (date: string, kcal: number | null, extra: Partial<NutritionEntry> = {}) => ({
    date: d(date),
    kcal,
    proteinG: 150,
    carbsG: 410,
    fatG: 83.5,
    steps: null,
    updatedAt: T0,
    ...extra,
  })
  await db.nutritionEntries.bulkPut([
    food('2026-09-25', 3010),
    food('2026-09-26', 2950, { steps: 9000 }),
    food('2026-09-27', null, { proteinG: null, carbsG: null, fatG: null, steps: 12000 }),
  ])
  const phase: Phase = {
    id: 'phase-1',
    type: 'bulk',
    startDate: d('2026-09-25'),
    endDate: null,
    status: 'active',
    prevPhaseId: null,
    parentPhaseId: null,
    rateMinPct: 0.25,
    rateMaxPct: 0.5,
    targetRatePct: 0.375,
    maintenanceKcalAtStart: 2712.6123,
    maintenanceSource: 'formula',
    trendWeightLbAtStart: 163,
    bodyFatPctAtStart: 14.3,
    bfQuality: 'single',
    leanMassLbAtStart: 139.691,
    proteinBasis: 'bodyweight',
    proteinGPerKg: 2,
    fatPct: 25,
    bfCeilingPct: 18,
    bfTargetPct: null,
    plannedWeeks: 20,
    maxWeeks: 26,
    endReason: null,
    createdAt: T0,
  }
  await db.phases.add(phase)
  const revisions: TargetRevision[] = [
    {
      id: 'rev-1',
      phaseId: 'phase-1',
      effectiveDate: d('2026-09-25'),
      kcal: 3000,
      proteinG: 150,
      fatPct: 25,
      source: 'phase_start',
      checkInId: null,
      note: '',
      createdAt: T0,
    },
    {
      id: 'rev-2',
      phaseId: 'phase-1',
      effectiveDate: d('2026-10-17'),
      kcal: 3150,
      proteinG: 150,
      fatPct: 25,
      source: 'checkin',
      checkInId: 'ci-3',
      note: '',
      createdAt: T0 + 21 * DAY,
    },
  ]
  await db.targetRevisions.bulkAdd(revisions)
  const checkIn = (id: string, week: number, extra: Partial<CheckIn>): CheckIn => ({
    id,
    phaseId: 'phase-1',
    dueDate: d(`2026-10-${String(2 + 7 * (week - 1)).padStart(2, '0')}`),
    phaseWeekIndex: week,
    status: 'backfilled',
    evaluatedAt: T0 + 7 * week * DAY,
    trendWeightLb: 163.1,
    trendRatePct: 0.1,
    bandMinPct: 0.25,
    bandMaxPct: 0.5,
    intakeLoggedPct: 85.7,
    weighInLoggedPct: 100,
    tdeeEstimate: 2712.6,
    tdeeSource: 'formula',
    tdeeCapped: false,
    missDirection: 'low',
    missStreak: 1,
    suggestionType: 'none_streak',
    suggestedKcalChange: 0,
    stepsAlternative: null,
    appliedKcalChange: null,
    switchPrompt: null,
    switchResponse: null,
    respondedAt: null,
    ...extra,
  })
  await db.checkIns.bulkAdd([
    checkIn('ci-1', 1, { suggestionType: 'none_first_week', missDirection: null, missStreak: 0 }),
    checkIn('ci-3', 3, {
      status: 'accepted',
      missStreak: 2,
      suggestionType: 'kcal_change',
      suggestedKcalChange: 150,
      appliedKcalChange: 150,
      tdeeSource: 'measured',
      tdeeCapped: true,
      respondedAt: T0 + 22 * DAY,
      switchPrompt: {
        kind: 'end_bulk',
        severity: 'soft',
        reasons: ['planned_length'],
        suggestedNext: 'maintenance',
      },
      switchResponse: 'dismissed',
    }),
  ])
  const suggestion: Suggestion = {
    id: 'sug-1',
    kind: 'deload',
    key: 'deload|ex-smith-squat|*',
    status: 'accepted',
    payload: { reasons: ['stalls'], stalled: ['ex-smith-squat|gym-1'], nested: { n: 3 } },
    firstShownAt: T0 + 10 * DAY,
    respondedAt: T0 + 10 * DAY + 60_000,
  }
  await db.suggestions.add(suggestion)
  await db.settings.put({
    id: 'singleton',
    values: { trendAlpha: 0.15, dropPct: 7.5 },
    updatedAt: T0 + DAY,
  })
  await db.appState.bulkPut([
    { key: 'lastGymId', value: 'gym-2' },
    { key: 'restTimer', value: { startedAt: T0, minSec: 120, maxSec: 180, extensions: [30] } },
    { key: 'wakeLockEnabled', value: false },
  ])
  await db.gyms.add({
    id: 'gym-2',
    name: 'Hotel gym',
    sortOrder: 1,
    archivedAt: null,
    createdAt: T0,
  })
  await db.gymSlotOverrides.add({
    id: 'ov-1',
    gymId: 'gym-2',
    slotId: 'slot-lower-a-1',
    exerciseId: 'ex-leg-press',
  })
  await db.gymExerciseSettings.add({
    id: 'ges-1',
    gymId: 'gym-2',
    exerciseId: 'ex-lateral-raise',
    stepLb: 1.25,
  })
  await db.trackStarts.update('day-push|ex-flat-machine-press|gym-1', {
    startLoadLb: 95,
    updatedAt: T0,
  })
  await db.programSlots.update('slot-pull-5', { archivedAt: T0 + 5 * DAY, sets: 3 })
  await db.muscles.update('side_delts', { lagging: true, bandMin: 12 })
  await db.exercises.update('ex-hyper-y-w', { archivedAt: T0 + 2 * DAY })
  await db.profile.update('me', { units: 'kg', name: 'Edward', updatedAt: T0 + DAY })
}

describe('exportBackup', () => {
  it('dumps every table in TABLE_NAMES order with rows sorted by primary key', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    c.setNow(T0 + 40 * DAY)
    const backup = await exportBackup(c, { appVersion: '0.1.0' })
    expect(backup).toMatchObject({
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: '0.1.0',
      exportedAt: T0 + 40 * DAY,
    })
    expect(Object.keys(backup.tables)).toEqual([...TABLE_NAMES])
    const slotIds = backup.tables.programSlots.map((s) => s.id)
    expect(slotIds).toEqual([...slotIds].sort())
    expect(backup.tables.programSlots).toHaveLength(34)
    expect(backup.tables.bodyEntries.map((b) => b.date)).toEqual([
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
      '2026-10-01',
    ])
    expect(backup.tables.sessions.map((s) => s.id)).toEqual([
      'sess-a1',
      'sess-abandoned',
      'sess-live',
      'sess-p1',
      'sess-u1',
      'sess-void',
    ])
  })

  it('gives the same file for the same data', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    const a = serializeBackup(await exportBackup(c, { appVersion: '0.1.0' }))
    const b = serializeBackup(await exportBackup(c, { appVersion: '0.1.0' }))
    expect(a).toBe(b)
    expect(JSON.parse(a)).toEqual(await exportBackup(c, { appVersion: '0.1.0' }))
  })

  it('names the file after the date', () => {
    expect(backupFileName(d('2026-09-24'))).toBe('exersise-backup-2026-09-24.json')
  })
})

describe('importBackup', () => {
  it('backup round-trips: export, wipe, import, every table deep-equal', async () => {
    const source = ctx()
    await addRealisticHistory(source)
    const before = await dumpAll(source)
    const text = serializeBackup(await exportBackup(source, { appVersion: '0.1.0' }))

    // Wipe: a brand-new, empty database stands in for a new phone or cleared site data.
    const target = ctx({ seed: false })
    const result = await importBackup(target, text)

    expect(result.status).toBe('imported')
    const after = await dumpAll(target)
    for (const name of TABLE_NAMES) {
      expect(before[name]!.length, name).toBeGreaterThan(0)
      expect(after[name], name).toEqual(before[name])
    }
    if (result.status === 'imported') {
      expect(result.counts).toEqual(
        Object.fromEntries(TABLE_NAMES.map((n) => [n, before[n]!.length])),
      )
    }
    // Exporting again reproduces the same backup.
    const again = serializeBackup(await exportBackup(target, { appVersion: '0.1.0' }))
    expect(JSON.parse(again)).toEqual(JSON.parse(text))
  })

  it('replaces everything on the device, dropping rows the backup does not have', async () => {
    const source = ctx()
    await addRealisticHistory(source)
    const text = serializeBackup(await exportBackup(source, { appVersion: '0.1.0' }))

    const target = ctx()
    await insertSession(target, {
      id: 'sess-local-only',
      programDayId: 'day-upper',
      date: '2026-09-25',
      exercises: [{ slotId: 'slot-upper-2', exerciseId: 'ex-cable-crossover', sets: [[60, 15]] }],
    })
    await target.db.gyms.add({
      id: 'gym-local',
      name: 'Local',
      sortOrder: 5,
      archivedAt: null,
      createdAt: T0,
    })

    expect(await importBackup(target, text)).toMatchObject({ status: 'imported' })
    expect(await target.db.sessions.get('sess-local-only')).toBeUndefined()
    expect(await target.db.gyms.get('gym-local')).toBeUndefined()
    expect(await dumpAll(target)).toEqual(await dumpAll(source))
  })

  it('asks before restoring a backup with less history than the device, then restores on confirm', async () => {
    const device = ctx()
    await addRealisticHistory(device)
    const deviceRows = await dumpAll(device)
    const old = ctx() // a backup taken on first launch: only the seed
    const text = serializeBackup(await exportBackup(old, { appVersion: '0.1.0' }))

    const result = await importBackup(device, text)
    expect(result).toEqual({
      status: 'needs_confirm',
      current: {
        sessions: 6,
        setLogs: 19,
        bodyEntries: 5,
        nutritionEntries: 3,
        total: 33,
      },
      incoming: { sessions: 0, setLogs: 0, bodyEntries: 1, nutritionEntries: 0, total: 1 },
    })
    expect(await dumpAll(device)).toEqual(deviceRows)

    expect(await importBackup(device, text, { confirmFewerRows: true })).toMatchObject({
      status: 'imported',
    })
    expect(await historyTotal(device)).toBe(1)
    expect(await dumpAll(device)).toEqual(await dumpAll(old))
  })

  it('rejects text that is not JSON, leaving the data untouched', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    const before = await dumpAll(c)
    const e = await expectServiceError(
      importBackup(c, '{"format": "exersise-applet-backup", '),
      'invalid_backup',
    )
    expect(e.message).toMatch(/not valid JSON/)
    expect((e.detail?.errors as string[]).length).toBe(1)
    expect(await dumpAll(c)).toEqual(before)
  })

  it('rejects a file that is not a backup', async () => {
    const c = ctx()
    const e = await expectServiceError(importBackup(c, '{"hello": "world"}'), 'invalid_backup')
    expect(e.detail?.errors).toEqual([
      expect.stringMatching(/^format: not an Exersise Applet backup/),
    ])
  })

  it('lists every invalid row and writes nothing', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    const before = await dumpAll(c)
    const backup = JSON.parse(serializeBackup(await exportBackup(c, { appVersion: '0.1.0' })))
    backup.tables.setLogs[3].reps = 2.5
    backup.tables.bodyEntries[1].date = '2026-02-30'
    backup.tables.sessions.push({ ...backup.tables.sessions[0] })
    const target = ctx({ seed: false })
    const e = await expectServiceError(
      importBackup(target, JSON.stringify(backup)),
      'invalid_backup',
    )
    expect(e.message).toBe('This backup file has 3 problems and was not restored.')
    expect(e.detail?.errors).toEqual([
      'tables.setLogs[3].reps: expected integer, got 2.5',
      'tables.bodyEntries[1].date: expected a real YYYY-MM-DD date, got "2026-02-30"',
      'tables.sessions[6].id: duplicate id "sess-a1" (also at [0])',
    ])
    expect(await historyTotal(target)).toBe(0)
    expect(await dumpAll(c)).toEqual(before)
  })

  it('refuses a backup from a newer version of the app', async () => {
    const c = ctx()
    const backup = JSON.parse(serializeBackup(await exportBackup(c, { appVersion: '9.0.0' })))
    backup.schemaVersion = BACKUP_SCHEMA_VERSION + 1
    const e = await expectServiceError(importBackup(c, JSON.stringify(backup)), 'newer_version')
    expect(e.message).toMatch(/newer version of the app/)
    expect(e.detail).toEqual({
      version: BACKUP_SCHEMA_VERSION + 1,
      currentVersion: BACKUP_SCHEMA_VERSION,
    })
  })

  it('rejects rows that would break a unique index before writing anything', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    const before = await dumpAll(c)
    const backup = JSON.parse(serializeBackup(await exportBackup(c, { appVersion: '0.1.0' })))
    backup.tables.gymSlotOverrides.push({ ...backup.tables.gymSlotOverrides[0], id: 'ov-2' })
    backup.tables.suggestions.push({ ...backup.tables.suggestions[0], id: 'sug-2' })
    const e = await expectServiceError(importBackup(c, JSON.stringify(backup)), 'invalid_backup')
    expect(e.detail?.errors).toEqual([
      'tables.gymSlotOverrides[1]: duplicate gymId + slotId (also at [0])',
      'tables.suggestions[1]: duplicate key (also at [0])',
    ])
    expect(await dumpAll(c)).toEqual(before)
  })

  it('rejects a backup without a profile', async () => {
    const c = ctx({ seed: false })
    const text = serializeBackup(await exportBackup(c, { appVersion: '0.1.0' }))
    const e = await expectServiceError(importBackup(c, text), 'invalid_backup')
    expect(e.detail?.errors).toEqual(['tables.profile: expected exactly 1 profile row, got 0'])
  })

  it('leaves the existing data untouched when the write fails part-way', async () => {
    const source = ctx()
    await addRealisticHistory(source)
    const text = serializeBackup(await exportBackup(source, { appVersion: '0.1.0' }))

    const target = ctx()
    await insertSession(target, {
      id: 'sess-precious',
      programDayId: 'day-push',
      date: '2026-09-26',
      exercises: [{ slotId: 'slot-push-1', exerciseId: 'ex-incline-db-bench', sets: [[70, 10]] }],
    })
    const before = await dumpAll(target)
    // Every table has been cleared and most refilled by the time setLogs fails. (Dexie keeps
    // separate Table objects for `db.setLogs` and `db.table('setLogs')`; patch the shared class.)
    const proto = target.db.Table.prototype as Table
    const realBulkAdd = proto.bulkAdd
    const failedTables: string[] = []
    vi.spyOn(proto, 'bulkAdd').mockImplementation(function (this: Table, ...args) {
      if (this.name === 'setLogs') {
        failedTables.push(this.name)
        throw new Error('QuotaExceededError: disk full')
      }
      return realBulkAdd.apply(this, args)
    })

    const e = await expectServiceError(importBackup(target, text), 'restore_failed')
    expect(failedTables).toEqual(['setLogs'])
    expect(e.message).toMatch(/nothing was changed/)
    expect(e.detail?.cause).toMatch(/disk full/)
    vi.restoreAllMocks()
    expect(await dumpAll(target)).toEqual(before)
  })
})

describe('backup reminder', () => {
  it('is quiet on a fresh install with nothing to lose', async () => {
    const c = ctx()
    expect(await getBackupReminder(c)).toEqual({ lastBackupAt: null, daysSince: null, due: false })
  })

  it('is due once there is history and no backup yet, and again after backupReminderDays', async () => {
    const c = ctx()
    await addRealisticHistory(c)
    expect(await getBackupReminder(c)).toMatchObject({ lastBackupAt: null, due: true })

    await markBackupSaved(c)
    expect(await getBackupReminder(c)).toEqual({ lastBackupAt: T0, daysSince: 0, due: false })

    c.advance(6 * DAY)
    expect(await getBackupReminder(c)).toMatchObject({ daysSince: 6, due: false })
    c.advance(DAY)
    expect(await getBackupReminder(c)).toMatchObject({ daysSince: 7, due: true })
  })

  it('reads the database only', async () => {
    const c = ctx()
    await c.db.transaction('r', [...TABLE_NAMES], () => getBackupReminder(c))
  })
})
