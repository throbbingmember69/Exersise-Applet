// Seed muscle list: the 12 muscles of the spec's "Weekly totals" table plus traps, which only the
// shrug finisher trains (audit finding #50). Bands inherit the global weekly-volume settings.
// Front delts, calves and abs never flag "low" (user decision: the spec calls them "enough" and
// "low by choice"). Traps is exempt too: no program slot trains it, only the optional finisher.
import type { Muscle } from '@/domain/types'

export const SEED_MUSCLE_IDS = [
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
  'chest',
  'front_delts',
  'side_delts',
  'rear_delts',
  'back',
  'biceps',
  'triceps',
  'traps',
] as const

export type SeedMuscleId = (typeof SEED_MUSCLE_IDS)[number]

const NAMES: Readonly<Record<SeedMuscleId, string>> = {
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  abs: 'Abs',
  chest: 'Chest',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  rear_delts: 'Rear delts',
  back: 'Back',
  biceps: 'Biceps',
  triceps: 'Triceps',
  traps: 'Traps',
}

const EXEMPT_LOW: ReadonlySet<SeedMuscleId> = new Set(['front_delts', 'calves', 'abs', 'traps'])

export const SEED_MUSCLES: readonly Muscle[] = SEED_MUSCLE_IDS.map((id, i) => ({
  id,
  name: NAMES[id],
  sortOrder: i,
  bandMin: null,
  bandMax: null,
  exemptLow: EXEMPT_LOW.has(id),
  lagging: false,
  archivedAt: null,
}))
