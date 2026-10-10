// Dexie (IndexedDB) schema. Rules:
// - Keep every db.version(n) declaration forever; add a new version for any index change.
// - Never change a primary key (that needs a new table plus a copy step).
// - Booleans and nulls can't be indexed (rows with a null index value are simply absent from
//   that index), so filter those in memory. Data volume is small (~5k sets/year).
// - Upgrade callbacks call pure transforms in db/migrations/, shared with backup import.
import Dexie, { type EntityTable } from 'dexie'
import type {
  AppStateRow,
  BodyEntry,
  CheckIn,
  Exercise,
  Gym,
  GymExerciseSetting,
  GymSlotOverride,
  Muscle,
  NutritionEntry,
  Phase,
  ProgramDay,
  ProgramSlot,
  Session,
  SessionExercise,
  SetLog,
  SettingsRow,
  Suggestion,
  TargetRevision,
  TrackStartRow,
  UserProfile,
} from '@/domain/types'
import { SEED, type SeedData } from '@/seed'
import { ensureSeeded, populateSeed } from './populate'
import { upgradeToV2 } from './upgrades'

/** Unique per origin: throbbingmember69.github.io is shared by all of the user's Pages sites. */
export const DB_NAME = 'exersise-applet'

/** Current Dexie schema version. Backups record it; older backups are migrated on import. */
export const DB_SCHEMA_VERSION = 2

/** Table names in backup/export order. Must match TABLE_NAMES in db/backupSchema.ts. */
export const DB_TABLES = [
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
] as const

export type DbTableName = (typeof DB_TABLES)[number]

/** Schema v1 stores (indexes). Later versions only add a version entry, so this stays. */
export const STORES_V1 = {
  profile: 'id',
  settings: 'id',
  appState: 'key',
  muscles: 'id, sortOrder',
  gyms: 'id, sortOrder',
  exercises: 'id, name',
  gymExerciseSettings: 'id, &[gymId+exerciseId]',
  programDays: 'id, order',
  programSlots: 'id, programDayId, [programDayId+order], defaultExerciseId',
  gymSlotOverrides: 'id, &[gymId+slotId], slotId',
  trackStarts: 'trackKey, exerciseId',
  sessions: 'id, date, status, startedAt, gymId, programDayId',
  sessionExercises: 'id, sessionId, exerciseId, slotId, [sessionId+order]',
  setLogs: 'id, sessionId, sessionExerciseId, exerciseId',
  bodyEntries: 'date',
  nutritionEntries: 'date',
  phases: 'id, startDate, status',
  targetRevisions: 'id, phaseId, effectiveDate, [phaseId+effectiveDate]',
  checkIns: 'id, phaseId, dueDate, &[phaseId+dueDate]',
  suggestions: 'id, kind, &key, status',
} as const

export class AppDB extends Dexie {
  profile!: EntityTable<UserProfile, 'id'>
  settings!: EntityTable<SettingsRow, 'id'>
  appState!: EntityTable<AppStateRow, 'key'>
  muscles!: EntityTable<Muscle, 'id'>
  gyms!: EntityTable<Gym, 'id'>
  exercises!: EntityTable<Exercise, 'id'>
  gymExerciseSettings!: EntityTable<GymExerciseSetting, 'id'>
  programDays!: EntityTable<ProgramDay, 'id'>
  programSlots!: EntityTable<ProgramSlot, 'id'>
  gymSlotOverrides!: EntityTable<GymSlotOverride, 'id'>
  trackStarts!: EntityTable<TrackStartRow, 'trackKey'>
  sessions!: EntityTable<Session, 'id'>
  sessionExercises!: EntityTable<SessionExercise, 'id'>
  setLogs!: EntityTable<SetLog, 'id'>
  bodyEntries!: EntityTable<BodyEntry, 'date'>
  nutritionEntries!: EntityTable<NutritionEntry, 'date'>
  phases!: EntityTable<Phase, 'id'>
  targetRevisions!: EntityTable<TargetRevision, 'id'>
  checkIns!: EntityTable<CheckIn, 'id'>
  suggestions!: EntityTable<Suggestion, 'id'>

  /**
   * `seed: false` creates an empty database (tests, backup restore into a fresh DB); a SeedData
   * seeds that content instead of the live seed (tests use the spec's original program).
   */
  constructor(name: string = DB_NAME, opts: { seed?: boolean | SeedData } = {}) {
    super(name)
    this.version(1).stores(STORES_V1)
    // v2 (October 2026): no index changes; Exercise.formUrl and the program update (catalog, hip
    // abduction, incline cable press archived). A new database is populated at v2 directly.
    this.version(2)
      .stores({})
      .upgrade((tx) => upgradeToV2(tx))
    if (opts.seed !== false) {
      const seed = typeof opts.seed === 'object' ? opts.seed : SEED
      this.on('populate', (tx) => populateSeed(tx, seed))
      this.on('ready', (db) => ensureSeeded(db, seed))
    }
  }
}
