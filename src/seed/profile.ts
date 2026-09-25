// Seed profile and baseline body entry, from the spec's "Profile and baseline" table.
import type { BodyEntry, LocalDate, UserProfile } from '@/domain/types'

/** Date of the spec's baseline measurements. */
export const SEED_DATE = '2026-09-24' as LocalDate
/** Fixed timestamp for seed rows (seed data must be deterministic). */
export const SEED_EPOCH_MS = Date.UTC(2026, 8, 24)

export const SEED_PROFILE: UserProfile = {
  id: 'me',
  name: '',
  sex: 'male',
  ageYears: 22,
  ageAsOf: SEED_DATE,
  birthDate: null,
  heightIn: 71,
  units: 'lb',
  updatedAt: SEED_EPOCH_MS,
}

/**
 * Baseline smart-scale reading. `source: 'seed'`: excluded from the weight trend (which starts at
 * the first real weigh-in) but used as a fallback bodyweight and as a body-fat reading.
 */
export const SEED_BODY_ENTRY: BodyEntry = {
  date: SEED_DATE,
  weightLb: 163,
  bodyFatPct: 14.3,
  muscleMassLb: 132,
  skeletalMusclePct: 55.3,
  subcutFatPct: 12.7,
  visceralRating: 5,
  source: 'seed',
  note: 'Baseline from the spec (smart scale)',
  createdAt: SEED_EPOCH_MS,
  updatedAt: SEED_EPOCH_MS,
  voidedAt: null,
}
