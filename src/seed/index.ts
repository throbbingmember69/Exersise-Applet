// The seed bundle written on first launch: the spec's profile and baseline, the muscle list, the
// exercise library, the program and its start loads, with the 2026 program updates applied (the
// same transforms that upgrade existing databases, so new and upgraded installs match). Pure data.
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
import { applyUpdate2026_10b } from './update2026-10b'
import { applyUpdate2026_11 } from './update2026-11'

export const SEED_VERSION = 4

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

/** The seed as the October 2026 updates left it (what a schema-v3 database was seeded with). */
export const OCTOBER_SEED: SeedData = {
  ...SPEC_SEED,
  ...applyUpdate2026_10b({ ...SPEC_SEED, ...applyUpdate2026_10(SPEC_SEED) }),
}

/** What a first launch writes: the spec seed plus the 2026 program updates, in order. */
export const SEED: SeedData = { ...OCTOBER_SEED, ...applyUpdate2026_11(OCTOBER_SEED) }

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
export { GROWTH_CUES, growthCuesFor, type GrowthCue } from './growthCues'
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
export {
  applyUpdate2026_11,
  NOVEMBER_NEW_SLOTS,
  NOVEMBER_SWAPS,
  NOVEMBER_UPDATE_MS,
} from './update2026-11'
export {
  applyUpdate2026_10b,
  BACK_FOCUS_EXERCISES,
  BACK_FOCUS_TRACKED_FROM,
  type BackFocusTables,
} from './update2026-10b'
