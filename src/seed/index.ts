// The seed bundle written on first launch: the spec's profile and baseline, the muscle list, the
// exercise library, the program and its start loads. Pure data. Bump SEED_VERSION when seed content
// changes so an upgrade can add new rows by id.
import type {
  BodyEntry,
  Exercise,
  Gym,
  GymExerciseSetting,
  GymSlotOverride,
  Muscle,
  ProgramDay,
  ProgramSlot,
  TrackStartRow,
  UserProfile,
} from '@/domain/types'
import { SEED_EXERCISES } from './exercises'
import { SEED_MUSCLES } from './muscles'
import { SEED_BODY_ENTRY, SEED_PROFILE } from './profile'
import { SEED_GYMS, SEED_PROGRAM_DAYS, SEED_PROGRAM_SLOTS } from './program'
import { SEED_TRACK_STARTS } from './trackStarts'

export const SEED_VERSION = 1

export interface SeedData {
  profile: UserProfile
  bodyEntries: readonly BodyEntry[]
  muscles: readonly Muscle[]
  gyms: readonly Gym[]
  exercises: readonly Exercise[]
  programDays: readonly ProgramDay[]
  programSlots: readonly ProgramSlot[]
  trackStarts: readonly TrackStartRow[]
  gymSlotOverrides: readonly GymSlotOverride[]
  gymExerciseSettings: readonly GymExerciseSetting[]
}

export const SEED: SeedData = {
  profile: SEED_PROFILE,
  bodyEntries: [SEED_BODY_ENTRY],
  muscles: SEED_MUSCLES,
  gyms: SEED_GYMS,
  exercises: SEED_EXERCISES,
  programDays: SEED_PROGRAM_DAYS,
  programSlots: SEED_PROGRAM_SLOTS,
  trackStarts: SEED_TRACK_STARTS,
  gymSlotOverrides: [],
  gymExerciseSettings: [],
}

export { SEED_EXERCISES } from './exercises'
export { SEED_MUSCLE_IDS, SEED_MUSCLES, type SeedMuscleId } from './muscles'
export { SEED_BODY_ENTRY, SEED_DATE, SEED_EPOCH_MS, SEED_PROFILE } from './profile'
export { SEED_GYM_ID, SEED_GYMS, SEED_PROGRAM_DAYS, SEED_PROGRAM_SLOTS } from './program'
export { SEED_TRACK_STARTS } from './trackStarts'
