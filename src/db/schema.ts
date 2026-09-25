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

/** Unique per origin: throbbingmember69.github.io is shared by all of the user's Pages sites. */
export const DB_NAME = 'exersise-applet'

/** Current Dexie schema version. Backups record it; older backups are migrated on import. */
export const DB_SCHEMA_VERSION = 1

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

  constructor(name: string = DB_NAME) {
    super(name)
    this.version(1).stores({
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
    })
  }
}
