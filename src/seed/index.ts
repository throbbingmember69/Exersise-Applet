// The seed bundle written on first launch: the spec's profile and baseline, the muscle list, the
// exercise library, the program and its start loads, with the October 2026 update applied (the
// same transform that upgrades existing databases, so new and upgraded installs match). Pure data.
// Bump SEED_VERSION when seed content changes; existing databases get the change through a schema
// migration (db/migrations), never by re-seeding.
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
import { SPEC_EXERCISES } from './exercises'
import { SEED_MUSCLES } from './muscles'
import { SEED_BODY_ENTRY, SEED_PROFILE } from './profile'
import { SEED_GYMS, SPEC_PROGRAM_DAYS, SPEC_PROGRAM_SLOTS } from './program'
import { SPEC_TRACK_STARTS } from './trackStarts'
import { applyUpdate2026_10 } from './update2026-10'

export const SEED_VERSION = 2

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

/** The spec's seed exactly as first shipped (the spec acceptance tests check it). */
export const SPEC_SEED: SeedData = {
  profile: SEED_PROFILE,
  bodyEntries: [SEED_BODY_ENTRY],
  muscles: SEED_MUSCLES,
  gyms: SEED_GYMS,
  exercises: SPEC_EXERCISES,
  programDays: SPEC_PROGRAM_DAYS,
  programSlots: SPEC_PROGRAM_SLOTS,
  trackStarts: SPEC_TRACK_STARTS,
  gymSlotOverrides: [],
  gymExerciseSettings: [],
}

/** What a first launch writes: the spec seed plus the October 2026 update. */
export const SEED: SeedData = { ...SPEC_SEED, ...applyUpdate2026_10(SPEC_SEED) }

export const SEED_EXERCISES = SEED.exercises
export const SEED_PROGRAM_DAYS = SEED.programDays
export const SEED_PROGRAM_SLOTS = SEED.programSlots
export const SEED_TRACK_STARTS = SEED.trackStarts

export { CATALOG_2026_10, HIP_ABDUCTION_ID, INCLINE_SMITH_PRESS_ID } from './catalog'
export { SPEC_EXERCISES } from './exercises'
export {
  FORM_GUIDES,
  formGuideFor,
  youtubeSearchUrl,
  type FormGuide,
  type ResolvedFormGuide,
} from './formGuides'
export { SEED_MUSCLE_IDS, SEED_MUSCLES, type SeedMuscleId } from './muscles'
export { SEED_BODY_ENTRY, SEED_DATE, SEED_EPOCH_MS, SEED_PROFILE } from './profile'
export { SEED_GYM_ID, SEED_GYMS, SPEC_PROGRAM_DAYS, SPEC_PROGRAM_SLOTS } from './program'
export { SPEC_TRACK_STARTS } from './trackStarts'
export {
  ABDUCTION_SLOTS,
  applyUpdate2026_10,
  INCLINE_CABLE_PRESS_ID,
  type ProgramTables,
} from './update2026-10'
