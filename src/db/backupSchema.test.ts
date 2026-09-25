import { describe, expect, it } from 'vitest'
import { trackKey } from '@/domain/progression/keys'
import type { LocalDate, SetLog } from '@/domain/types'
import { SEED_BODY_ENTRY, SEED_PROFILE } from '@/seed/profile'
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  TABLE_NAMES,
  backupSchema,
  parseBackup,
  rowSchemas,
  type Backup,
  type BackupTables,
} from './backupSchema'

const d = (s: string) => s as LocalDate
const T0 = Date.UTC(2026, 8, 24, 12)
const min = 60_000

function emptyTables(): BackupTables {
  return Object.fromEntries(TABLE_NAMES.map((name) => [name, []])) as unknown as BackupTables
}

function minimalBackup(): Backup {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: '0.1.0',
    exportedAt: T0,
    tables: emptyTables(),
  }
}

function realisticBackup(): Backup {
  const regime = {
    sets: 4,
    repMin: 6,
    repMax: 10,
    rirMin: 1,
    rirMax: 2,
    restMinSec: 120,
    restMaxSec: 180,
  }
  return {
    format: BACKUP_FORMAT,
    schemaVersion: 1,
    appVersion: '0.1.0',
    exportedAt: T0 + 30 * 86_400_000,
    tables: {
      profile: [SEED_PROFILE],
      settings: [
        { id: 'singleton', values: { trendAlpha: 0.15, checkinStepKcal: 100 }, updatedAt: T0 },
      ],
      appState: [
        { key: 'lastGymId', value: 'gym-1' },
        { key: 'restTimer', value: { startedAt: T0, minSec: 120, maxSec: 180, extensions: [30] } },
        { key: 'lastBackupAt', value: null },
        { key: 'wakeLockEnabled', value: true },
      ],
      muscles: [
        {
          id: 'quads',
          name: 'Quads',
          sortOrder: 0,
          bandMin: null,
          bandMax: null,
          exemptLow: false,
          lagging: false,
          archivedAt: null,
        },
        {
          id: 'front_delts',
          name: 'Front delts',
          sortOrder: 1,
          bandMin: 6,
          bandMax: 20,
          exemptLow: true,
          lagging: false,
          archivedAt: null,
        },
        {
          id: 'side_delts',
          name: 'Side delts',
          sortOrder: 2,
          bandMin: null,
          bandMax: null,
          exemptLow: false,
          lagging: true,
          archivedAt: null,
        },
      ],
      gyms: [
        { id: 'gym-1', name: 'Gym 1', sortOrder: 0, archivedAt: null, createdAt: T0 },
        {
          id: 'gym-2',
          name: 'Hotel gym',
          sortOrder: 1,
          archivedAt: T0 + 9 * 86_400_000,
          createdAt: T0,
        },
      ],
      exercises: [
        {
          id: 'ex-smith-squat',
          name: 'Smith machine squat',
          loadType: 'machine',
          equipmentSpecific: true,
          unilateral: false,
          perHand: false,
          stepLb: 10,
          defaultRegime: regime,
          muscleWeights: { quads: 1, glutes: 0.5 },
          isMainLift: true,
          isFinisher: false,
          notes: '',
          archivedAt: null,
          createdAt: T0,
          updatedAt: T0,
        },
        {
          id: 'ex-incline-db-bench',
          name: 'Incline DB bench press',
          loadType: 'dumbbell',
          equipmentSpecific: false,
          unilateral: false,
          perHand: true,
          stepLb: 5,
          defaultRegime: { ...regime, sets: 3 },
          muscleWeights: { chest: 1, front_delts: 0.5, triceps: 0.5 },
          isMainLift: true,
          isFinisher: false,
          notes: 'Bench at 30°',
          archivedAt: null,
          createdAt: T0,
          updatedAt: T0,
        },
        {
          id: 'ex-weighted-chinup',
          name: 'Weighted chin-up',
          loadType: 'bodyweight_plus',
          equipmentSpecific: false,
          unilateral: false,
          perHand: false,
          stepLb: 5,
          defaultRegime: regime,
          muscleWeights: { back: 1, biceps: 0.5 },
          isMainLift: true,
          isFinisher: false,
          notes: '',
          archivedAt: null,
          createdAt: T0,
          updatedAt: T0,
        },
      ],
      gymExerciseSettings: [
        { id: 'ges-1', gymId: 'gym-2', exerciseId: 'ex-smith-squat', stepLb: 15 },
      ],
      programDays: [
        { id: 'day-lower-a', name: 'Lower A', weekday: 1, order: 0, note: '', archivedAt: null },
        {
          id: 'day-extra',
          name: 'Extra',
          weekday: null,
          order: 5,
          note: 'unscheduled',
          archivedAt: null,
        },
      ],
      programSlots: [
        {
          ...regime,
          id: 'slot-lower-a-1',
          programDayId: 'day-lower-a',
          order: 0,
          label: '',
          defaultExerciseId: 'ex-smith-squat',
          alternateExerciseIds: [],
          note: '',
          archivedAt: null,
        },
        {
          ...regime,
          sets: 2,
          id: 'slot-pull-1',
          programDayId: 'day-lower-a',
          order: 1,
          label: 'Deadlift or RDL',
          defaultExerciseId: 'ex-deadlift',
          alternateExerciseIds: ['ex-rdl'],
          note: '',
          archivedAt: null,
        },
      ],
      gymSlotOverrides: [
        { id: 'gso-1', gymId: 'gym-2', slotId: 'slot-lower-a-1', exerciseId: 'ex-leg-press' },
      ],
      trackStarts: [
        {
          trackKey: trackKey('day-lower-a', 'ex-smith-squat', 'gym-1'),
          programDayId: 'day-lower-a',
          exerciseId: 'ex-smith-squat',
          gymScope: 'gym-1',
          startLoadLb: 220,
          calibrate: false,
          updatedAt: T0,
        },
        {
          trackKey: trackKey('day-pull', 'ex-assisted-dip', '*'),
          programDayId: 'day-pull',
          exerciseId: 'ex-assisted-dip',
          gymScope: '*',
          startLoadLb: -40,
          calibrate: false,
          updatedAt: T0,
        },
        {
          trackKey: trackKey('day-push', 'ex-flat-db-press', '*'),
          programDayId: 'day-push',
          exerciseId: 'ex-flat-db-press',
          gymScope: '*',
          startLoadLb: null,
          calibrate: true,
          updatedAt: T0,
        },
      ],
      sessions: [
        {
          id: 's-1',
          date: d('2026-09-28'),
          startedAt: T0 + 4 * 86_400_000,
          finishedAt: T0 + 4 * 86_400_000 + 70 * min,
          tzOffsetMin: 240,
          status: 'finished',
          programDayId: 'day-lower-a',
          gymId: 'gym-1',
          isDeload: false,
          jointPain: false,
          bodyweightLb: 163.4,
          bodyweightSource: 'weighin',
          note: 'Good session, "felt strong"',
          voidedAt: null,
          editedAt: T0 + 5 * 86_400_000,
          createdAt: T0 + 4 * 86_400_000,
        },
        {
          id: 's-2',
          date: d('2026-09-30'),
          startedAt: T0 + 6 * 86_400_000,
          finishedAt: null,
          tzOffsetMin: -330,
          status: 'in_progress',
          programDayId: null,
          gymId: 'gym-2',
          isDeload: true,
          jointPain: true,
          bodyweightLb: null,
          bodyweightSource: 'trend',
          note: '',
          voidedAt: T0 + 7 * 86_400_000,
          editedAt: null,
          createdAt: T0 + 6 * 86_400_000,
        },
      ],
      sessionExercises: [
        {
          id: 'sx-1',
          sessionId: 's-1',
          order: 0,
          slotId: 'slot-lower-a-1',
          adHoc: false,
          exerciseId: 'ex-smith-squat',
          exerciseName: 'Smith machine squat',
          loadType: 'machine',
          perHand: false,
          unilateral: false,
          equipmentSpecific: true,
          gymScope: 'gym-1',
          isMainLift: true,
          isFinisher: false,
          swappedFromExerciseId: null,
          swapKind: 'none',
          prescription: { ...regime, setsBeforeDeload: 4, stepLb: 10 },
          muscleWeights: { quads: 1, glutes: 0.5 },
          suggestion: {
            loadLb: 220,
            repTargets: [7, 7, 6, 6],
            branch: 'same_plus_rep',
            missStreakBefore: 0,
            isCalibration: false,
            notices: [
              { code: 'mixed_loads', detail: { loads: [210, 220] } },
              { code: 'recalibrate' },
            ],
          },
          createdAt: T0 + 4 * 86_400_000,
        },
        {
          id: 'sx-2',
          sessionId: 's-2',
          order: 0,
          slotId: null,
          adHoc: true,
          exerciseId: 'ex-weighted-chinup',
          exerciseName: 'Weighted chin-up',
          loadType: 'bodyweight_plus',
          perHand: false,
          unilateral: false,
          equipmentSpecific: false,
          gymScope: '*',
          isMainLift: true,
          isFinisher: false,
          swappedFromExerciseId: 'ex-lat-pulldown',
          swapKind: 'one_off',
          prescription: { ...regime, sets: 2, setsBeforeDeload: 4, stepLb: 5 },
          muscleWeights: { back: 1, biceps: 0.5 },
          suggestion: {
            loadLb: null,
            repTargets: [],
            branch: 'start',
            missStreakBefore: 0,
            isCalibration: true,
            notices: [{ code: 'calibration_needed' }],
          },
          createdAt: T0 + 6 * 86_400_000,
        },
      ],
      setLogs: [
        setLog({ id: 'set-1', setIndex: 0, loadLb: 95, reps: 8, rir: null, isWarmup: true }),
        setLog({ id: 'set-2', setIndex: 1, loadLb: 220, reps: 10, rir: 2 }),
        setLog({
          id: 'set-3',
          setIndex: 2,
          loadLb: 220,
          reps: 0,
          rir: 0,
          note: 'failed, "spotter"\nneeded',
        }),
        setLog({
          id: 'set-4',
          setIndex: 3,
          loadLb: 2250,
          reps: 8,
          rir: 1,
          voidedAt: T0 + 5 * 86_400_000,
        }),
        setLog({
          id: 'set-5',
          sessionId: 's-2',
          sessionExerciseId: 'sx-2',
          exerciseId: 'ex-weighted-chinup',
          setIndex: 0,
          loadLb: -20,
          reps: 6,
          rir: 5,
        }),
        setLog({
          id: 'set-6',
          sessionId: 's-2',
          sessionExerciseId: 'sx-2',
          exerciseId: 'ex-weighted-chinup',
          setIndex: 1,
          loadLb: 22.046226218487757,
          reps: 5,
          rir: null,
          editedAt: T0,
        }),
      ],
      bodyEntries: [
        SEED_BODY_ENTRY,
        {
          date: d('2026-09-25'),
          weightLb: 162.8,
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
        },
      ],
      nutritionEntries: [
        {
          date: d('2026-09-25'),
          kcal: 3050,
          proteinG: 152.5,
          carbsG: 410,
          fatG: 84,
          steps: 9500,
          updatedAt: T0,
        },
        {
          date: d('2026-09-26'),
          kcal: null,
          proteinG: null,
          carbsG: null,
          fatG: null,
          steps: null,
          updatedAt: T0,
        },
      ],
      phases: [
        {
          id: 'phase-1',
          type: 'bulk',
          startDate: d('2026-09-24'),
          endDate: null,
          status: 'active',
          prevPhaseId: null,
          parentPhaseId: null,
          rateMinPct: 0.25,
          rateMaxPct: 0.5,
          targetRatePct: 0.375,
          maintenanceKcalAtStart: 2712.6,
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
        },
        {
          id: 'phase-0',
          type: 'cut',
          startDate: d('2026-06-01'),
          endDate: d('2026-09-23'),
          status: 'ended',
          prevPhaseId: null,
          parentPhaseId: null,
          rateMinPct: -0.75,
          rateMaxPct: -0.5,
          targetRatePct: -0.625,
          maintenanceKcalAtStart: 2750,
          maintenanceSource: 'measured',
          trendWeightLbAtStart: 170,
          bodyFatPctAtStart: null,
          bfQuality: 'none',
          leanMassLbAtStart: null,
          proteinBasis: 'bodyweight_fallback',
          proteinGPerKg: 2.2,
          fatPct: 25,
          bfCeilingPct: null,
          bfTargetPct: 12,
          plannedWeeks: 14,
          maxWeeks: 16,
          endReason: 'bf_target',
          createdAt: T0 - 100 * 86_400_000,
        },
      ],
      targetRevisions: [
        {
          id: 'tr-1',
          phaseId: 'phase-1',
          effectiveDate: d('2026-09-24'),
          kcal: 3000,
          proteinG: 150,
          fatPct: 25,
          source: 'phase_start',
          checkInId: null,
          note: '',
          createdAt: T0,
        },
        {
          id: 'tr-2',
          phaseId: 'phase-1',
          effectiveDate: d('2026-10-16'),
          kcal: 3150,
          proteinG: 150,
          fatPct: 25,
          source: 'checkin',
          checkInId: 'ci-3',
          note: '',
          createdAt: T0,
        },
      ],
      checkIns: [
        {
          id: 'ci-1',
          phaseId: 'phase-1',
          dueDate: d('2026-10-01'),
          phaseWeekIndex: 1,
          status: 'backfilled',
          evaluatedAt: T0,
          trendWeightLb: null,
          trendRatePct: null,
          bandMinPct: 0.25,
          bandMaxPct: 0.5,
          intakeLoggedPct: 85.7,
          weighInLoggedPct: 100,
          tdeeEstimate: null,
          tdeeSource: 'insufficient_data',
          tdeeCapped: false,
          missDirection: null,
          missStreak: 0,
          suggestionType: 'none_first_week',
          suggestedKcalChange: 0,
          stepsAlternative: null,
          appliedKcalChange: null,
          switchPrompt: null,
          switchResponse: null,
          respondedAt: null,
        },
        {
          id: 'ci-3',
          phaseId: 'phase-1',
          dueDate: d('2026-10-15'),
          phaseWeekIndex: 3,
          status: 'accepted',
          evaluatedAt: T0,
          trendWeightLb: 163.9,
          trendRatePct: 0.12,
          bandMinPct: 0.25,
          bandMaxPct: 0.5,
          intakeLoggedPct: 100,
          weighInLoggedPct: 92.9,
          tdeeEstimate: 2790,
          tdeeSource: 'measured',
          tdeeCapped: true,
          missDirection: 'low',
          missStreak: 2,
          suggestionType: 'kcal_change',
          suggestedKcalChange: 150,
          stepsAlternative: null,
          appliedKcalChange: 150,
          switchPrompt: {
            kind: 'end_bulk',
            severity: 'soft',
            reasons: ['planned_length', 'bf_ceiling'],
            suggestedNext: 'maintenance',
          },
          switchResponse: 'dismissed',
          respondedAt: T0,
        },
      ],
      suggestions: [
        {
          id: 'sg-1',
          kind: 'stall',
          key: 'stall|ex-smith-squat|gym-1|s-1',
          status: 'shown',
          payload: { exerciseId: 'ex-smith-squat', sessions: 3 },
          firstShownAt: T0,
          respondedAt: null,
        },
        {
          id: 'sg-2',
          kind: 'deload',
          key: 'deload|2026-10-01',
          status: 'dismissed',
          payload: {},
          firstShownAt: T0,
          respondedAt: T0 + min,
        },
      ],
    },
  }
}

function setLog(p: Partial<SetLog> & { id: string }): SetLog {
  return {
    sessionId: 's-1',
    sessionExerciseId: 'sx-1',
    exerciseId: 'ex-smith-squat',
    setIndex: 0,
    loadLb: 0,
    reps: 0,
    rir: null,
    isWarmup: false,
    note: '',
    loggedAt: T0 + 4 * 86_400_000,
    editedAt: null,
    voidedAt: null,
    ...p,
  }
}

const REMOVE = Symbol('remove')

/**
 * A JSON copy of the realistic backup (as a restored file would arrive) with changes applied by
 * dotted path, e.g. { 'tables.setLogs.3.reps': -1 }. REMOVE deletes the key.
 */
function withChanges(changes: Record<string, unknown>): unknown {
  const copy = JSON.parse(JSON.stringify(realisticBackup())) as Record<string, unknown>
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split('.')
    const last = keys.pop()!
    let target = copy
    for (const key of keys) target = target[key] as Record<string, unknown>
    if (value === REMOVE) delete target[last]
    else target[last] = value
  }
  return copy
}

function errorsOf(json: unknown): string[] {
  const result = parseBackup(json)
  if (result.ok) throw new Error('expected the backup to be rejected')
  return result.errors
}

describe('TABLE_NAMES', () => {
  it('lists every table in the contract order', () => {
    expect(TABLE_NAMES).toEqual([
      'profile',
      'settings',
      'appState',
      'muscles',
      'gyms',
      'exercises',
      'gymExerciseSettings',
      'programDays',
      'programSlots',
      'gymSlotOverrides',
      'trackStarts',
      'sessions',
      'sessionExercises',
      'setLogs',
      'bodyEntries',
      'nutritionEntries',
      'phases',
      'targetRevisions',
      'checkIns',
      'suggestions',
    ])
  })

  it('matches the tables the schema validates and the exported row schemas', () => {
    expect(Object.keys(backupSchema.shape.tables.shape).sort()).toEqual([...TABLE_NAMES].sort())
    expect(Object.keys(rowSchemas).sort()).toEqual([...TABLE_NAMES].sort())
  })
})

describe('parseBackup: valid files', () => {
  it('accepts a minimal backup with every table empty', () => {
    const backup = minimalBackup()
    expect(parseBackup(backup)).toEqual({ ok: true, backup })
  })

  it('accepts a realistic backup unchanged after a JSON round trip', () => {
    const backup = realisticBackup()
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual({ ok: true, backup })
  })

  it('accepts zero and negative loads, rir 0 and 5, and a 0-rep set', () => {
    const result = parseBackup(realisticBackup())
    expect(result.ok && result.backup.tables.setLogs.map((s) => [s.loadLb, s.reps, s.rir])).toEqual(
      [
        [95, 8, null],
        [220, 10, 2],
        [220, 0, 0],
        [2250, 8, 1],
        [-20, 6, 5],
        [22.046226218487757, 5, null],
      ],
    )
  })

  it('accepts an appState row whose value was dropped by JSON (undefined)', () => {
    const result = parseBackup(withChanges({ 'tables.appState': [{ key: 'restTimer' }] }))
    expect(result.ok && result.backup.tables.appState).toEqual([
      { key: 'restTimer', value: undefined },
    ])
  })

  it('drops unknown fields, unknown tables and retired settings keys instead of rejecting them', () => {
    const result = parseBackup(
      withChanges({
        'tables.sessions.0.legacyField': 'x',
        'tables.dietBreaks': [{ id: 'db-1' }],
        'tables.settings.0.values.retiredSetting': 3,
        comment: 'hand-edited',
      }),
    )
    expect(result).toEqual({ ok: true, backup: realisticBackup() })
    if (!result.ok) return
    expect(result.backup.tables.settings[0]!.values).toEqual({
      trendAlpha: 0.15,
      checkinStepKcal: 100,
    })
    expect('dietBreaks' in result.backup.tables).toBe(false)
    expect('legacyField' in result.backup.tables.sessions[0]!).toBe(false)
  })

  it('validates a single table row with rowSchemas', () => {
    const row = realisticBackup().tables.setLogs[0]
    expect(rowSchemas.setLogs.safeParse(row).success).toBe(true)
    expect(rowSchemas.setLogs.safeParse({ ...row, rir: 6 }).success).toBe(false)
  })
})

describe('parseBackup: rejected files', () => {
  it('refuses a file that is not an app backup, with one clear error', () => {
    expect(errorsOf(withChanges({ format: 'some-other-app' }))).toEqual([
      'format: not an Exersise Applet backup; expected "exersise-applet-backup", got "some-other-app"',
    ])
    expect(errorsOf({ hello: 'world' })).toEqual([
      'format: not an Exersise Applet backup; expected "exersise-applet-backup" (missing)',
    ])
  })

  it('refuses input that is not an object', () => {
    expect(errorsOf([])).toEqual(['backup: expected object, got an array'])
    expect(errorsOf(null)).toEqual(['backup: expected object, got null'])
    expect(errorsOf('{"format":1}')).toEqual(['backup: expected object, got "{\\"format\\":1}"'])
  })

  it('refuses a backup from a newer schema version before validating anything else', () => {
    const json = withChanges({ schemaVersion: BACKUP_SCHEMA_VERSION + 1, tables: 'a newer layout' })
    expect(errorsOf(json)).toEqual([
      'schemaVersion: this backup was made by a newer version of the app (schema 2; this app reads schema 1). Update the app, then restore.',
    ])
  })

  it('accepts only schema version 1 for now', () => {
    expect(errorsOf(withChanges({ schemaVersion: 0 }))).toEqual([
      'schemaVersion: expected 1, got 0',
    ])
    expect(errorsOf(withChanges({ schemaVersion: '1' }))).toEqual([
      'schemaVersion: expected 1, got "1"',
    ])
    expect(errorsOf(withChanges({ schemaVersion: REMOVE }))).toEqual([
      'schemaVersion: expected 1 (missing)',
    ])
  })

  it('rejects dates that are malformed or not on the calendar', () => {
    const json = withChanges({
      'tables.sessions.0.date': '2026-02-30',
      'tables.sessions.1.date': '2026-9-30',
      'tables.bodyEntries.1.date': 20260925,
      'tables.phases.0.endDate': '2026-13-01',
      'tables.profile.0.birthDate': '2004-02-29',
    })
    expect(errorsOf(json)).toEqual([
      'tables.sessions[0].date: expected a real YYYY-MM-DD date, got "2026-02-30"',
      'tables.sessions[1].date: expected a real YYYY-MM-DD date, got "2026-9-30"',
      'tables.bodyEntries[1].date: expected a real YYYY-MM-DD date, got 20260925',
      'tables.phases[0].endDate: expected a real YYYY-MM-DD date, got "2026-13-01"',
    ])
  })

  it('rejects negative or fractional reps and out-of-range RIR', () => {
    const json = withChanges({
      'tables.setLogs.1.reps': -1,
      'tables.setLogs.2.rir': 1.5,
      'tables.setLogs.3.reps': 2.5,
      'tables.setLogs.4.rir': 6,
      'tables.setLogs.5.rir': -1,
    })
    expect(errorsOf(json)).toEqual([
      'tables.setLogs[1].reps: expected a value >= 0, got -1',
      'tables.setLogs[2].rir: expected integer, got 1.5',
      'tables.setLogs[3].reps: expected integer, got 2.5',
      'tables.setLogs[4].rir: expected a value <= 5, got 6',
      'tables.setLogs[5].rir: expected a value >= 0, got -1',
    ])
  })

  it('rejects values outside an enum or literal', () => {
    const json = withChanges({
      'tables.profile.0.id': 'you',
      'tables.exercises.0.loadType': 'kettlebell',
      'tables.exercises.1.muscleWeights.front_delts': 0.25,
      'tables.programDays.0.weekday': 7,
      'tables.sessions.0.status': 'done',
      'tables.sessionExercises.0.suggestion.notices.0.code': 'oops',
    })
    expect(errorsOf(json)).toEqual([
      'tables.profile[0].id: expected "me", got "you"',
      'tables.exercises[0].loadType: expected one of "barbell", "dumbbell", "machine", "cable", "bodyweight_plus", got "kettlebell"',
      'tables.exercises[1].muscleWeights.front_delts: expected one of 0.5, 1, got 0.25',
      'tables.programDays[0].weekday: expected one of 0, 1, 2, 3, 4, 5, 6, got 7',
      'tables.sessions[0].status: expected one of "in_progress", "finished", "abandoned", got "done"',
      'tables.sessionExercises[0].suggestion.notices[0].code: expected one of "mixed_loads", "calibration_needed", "recalibrate", "deload", "missing_sets", "no_bodyweight", got "oops"',
    ])
  })

  it('rejects a missing table or field', () => {
    const json = withChanges({
      exportedAt: REMOVE,
      'tables.setLogs.0.isWarmup': REMOVE,
      'tables.checkIns': REMOVE,
    })
    expect(errorsOf(json)).toEqual([
      'exportedAt: expected number (missing)',
      'tables.setLogs[0].isWarmup: expected boolean (missing)',
      'tables.checkIns: expected array (missing)',
    ])
  })

  it('rejects null where a value is required, and wrong types', () => {
    const json = withChanges({
      'tables.programSlots.1.alternateExerciseIds': 'ex-rdl',
      'tables.sessions.0.gymId': null,
      'tables.sessions.0.isDeload': 'false',
      'tables.sessionExercises.0.suggestion': 'none',
      'tables.setLogs.0.loadLb': '95',
      'tables.suggestions.0.payload': [1, 2],
    })
    expect(errorsOf(json)).toEqual([
      'tables.programSlots[1].alternateExerciseIds: expected array, got "ex-rdl"',
      'tables.sessions[0].gymId: expected string, got null',
      'tables.sessions[0].isDeload: expected boolean, got "false"',
      'tables.sessionExercises[0].suggestion: expected object, got "none"',
      'tables.setLogs[0].loadLb: expected number, got "95"',
      'tables.suggestions[0].payload: expected object, got an array',
    ])
  })

  it('rejects non-finite numbers (possible when the caller did not go through JSON)', () => {
    const json = withChanges({
      'tables.setLogs.1.loadLb': Infinity,
      'tables.nutritionEntries.0.kcal': Number.NaN,
    })
    expect(errorsOf(json)).toEqual([
      'tables.setLogs[1].loadLb: expected number, got Infinity',
      'tables.nutritionEntries[0].kcal: expected number, got NaN',
    ])
  })

  it('rejects empty ids, a zero step and physically impossible values', () => {
    const json = withChanges({
      'tables.gyms.0.id': '',
      'tables.exercises.0.stepLb': 0,
      'tables.sessions.0.bodyweightLb': -163,
      'tables.bodyEntries.1.bodyFatPct': 140,
      'tables.nutritionEntries.0.steps': 9500.5,
    })
    expect(errorsOf(json)).toEqual([
      'tables.gyms[0].id: must not be empty',
      'tables.exercises[0].stepLb: expected a value > 0, got 0',
      'tables.sessions[0].bodyweightLb: expected a value > 0, got -163',
      'tables.bodyEntries[1].bodyFatPct: expected a value <= 100, got 140',
      'tables.nutritionEntries[0].steps: expected integer, got 9500.5',
    ])
  })

  it('rejects duplicate primary keys, which would abort the restore transaction', () => {
    const json = withChanges({
      'tables.appState.2.key': 'lastGymId',
      'tables.setLogs.2.id': 'set-1',
      'tables.bodyEntries.1.date': SEED_BODY_ENTRY.date,
    })
    expect(errorsOf(json)).toEqual([
      'tables.appState[2].key: duplicate key "lastGymId" (also at [0])',
      'tables.setLogs[2].id: duplicate id "set-1" (also at [0])',
      'tables.bodyEntries[1].date: duplicate date "2026-09-24" (also at [0])',
    ])
  })

  it('formats awkward paths and values readably', () => {
    const json = withChanges({
      appVersion: { v: 1 },
      'tables.gyms.1.sortOrder': 'y'.repeat(60),
      'tables.exercises.0.muscleWeights.side delts': 2,
      'tables.sessions.0.note': () => 'not data',
      'tables.sessions.1.tzOffsetMin': true,
      'tables.setLogs.0.reps': 3n,
    })
    expect(errorsOf(json)).toEqual([
      'appVersion: expected string, got an object',
      `tables.gyms[1].sortOrder: expected number, got "${'y'.repeat(40)}…"`,
      'tables.exercises[0].muscleWeights["side delts"]: expected one of 0.5, 1, got 2',
      'tables.sessions[0].note: expected string, got function',
      'tables.sessions[1].tzOffsetMin: expected number, got true',
      'tables.setLogs[0].reps: expected number, got bigint',
    ])
  })

  it('collects every problem in one pass', () => {
    const changes = Object.fromEntries(
      [0, 1, 2, 3, 4, 5].map((i) => [`tables.setLogs.${i}.reps`, -1]),
    )
    expect(errorsOf(withChanges(changes))).toHaveLength(6)
  })
})
