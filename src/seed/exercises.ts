// Seed exercise library: every row of the spec's "Volume accounting" table, with the three
// "X or Y" rows split into separate exercises that share the row's muscle weights, plus the two
// optional finishers (audit finding #50). loadType follows finding #45; equipment-specific means
// machine or cable, per hand means dumbbell. Steps follow the variant (finding #9). An exercise's
// default regime is the one of the first program slot it fills; finishers use 3 × 8–12 @ RIR 0–1.
import type {
  Exercise,
  LoadType,
  MuscleId,
  MuscleWeight,
  MuscleWeights,
  Regime,
} from '@/domain/types'
import type { SeedMuscleId } from './muscles'
import { SEED_EPOCH_MS } from './profile'
import { SEED_PROGRAM_SLOTS } from './program'

type Weights = Partial<Record<SeedMuscleId, MuscleWeight>>

interface Row {
  id: string
  name: string
  loadType: LoadType
  stepLb: number
  muscleWeights: Weights
  unilateral?: boolean
  isMainLift?: boolean
  notes?: string
}

const SQUAT: Weights = { quads: 1, glutes: 0.5 }
const HINGE: Weights = { hamstrings: 1, glutes: 0.5, quads: 0.5 }
const PRESS: Weights = { chest: 1, front_delts: 0.5, triceps: 0.5 }
const VERTICAL_PULL: Weights = { back: 1, biceps: 0.5 }
const ROW: Weights = { back: 1, biceps: 0.5, rear_delts: 0.5 }

/** Program exercises in program order; alternates follow their slot's default. */
// prettier-ignore
const PROGRAM_ROWS: readonly Row[] = [
  // Lower A
  { id: 'ex-smith-squat', name: 'Smith machine squat', loadType: 'machine', stepLb: 10, muscleWeights: SQUAT, isMainLift: true },
  { id: 'ex-leg-extension', name: 'Leg extension', loadType: 'machine', stepLb: 5, muscleWeights: { quads: 1 } },
  { id: 'ex-seated-leg-curl', name: 'Seated leg curl', loadType: 'machine', stepLb: 5, muscleWeights: { hamstrings: 1 } },
  { id: 'ex-hip-thrust', name: 'Hip thrust', loadType: 'machine', stepLb: 10, muscleWeights: { glutes: 1 } },
  { id: 'ex-standing-calf-raise', name: 'Standing calf raise', loadType: 'machine', stepLb: 10, muscleWeights: { calves: 1 } },
  { id: 'ex-cable-crunch', name: 'Cable crunch', loadType: 'cable', stepLb: 5, muscleWeights: { abs: 1 } },
  // Push
  { id: 'ex-incline-db-bench', name: 'Incline DB bench press', loadType: 'dumbbell', stepLb: 5, muscleWeights: PRESS, isMainLift: true },
  { id: 'ex-flat-machine-press', name: 'Flat machine press', loadType: 'machine', stepLb: 5, muscleWeights: PRESS },
  { id: 'ex-flat-db-press', name: 'Flat DB press', loadType: 'dumbbell', stepLb: 5, muscleWeights: PRESS },
  { id: 'ex-machine-fly', name: 'Machine fly', loadType: 'machine', stepLb: 5, muscleWeights: { chest: 1 } },
  { id: 'ex-overhead-press', name: 'Overhead shoulder press', loadType: 'machine', stepLb: 5, muscleWeights: { front_delts: 1, side_delts: 0.5, triceps: 0.5 }, isMainLift: true },
  { id: 'ex-lateral-raise', name: 'Lateral raise (machine)', loadType: 'machine', stepLb: 2.5, muscleWeights: { side_delts: 1 } },
  { id: 'ex-overhead-cable-triceps-extension', name: 'Single-arm overhead cable triceps extension', loadType: 'cable', stepLb: 2.5, muscleWeights: { triceps: 1 }, unilateral: true },
  { id: 'ex-dip-machine', name: 'Dip machine', loadType: 'machine', stepLb: 10, muscleWeights: { triceps: 1, chest: 0.5, front_delts: 0.5 } },
  // Pull
  { id: 'ex-weighted-chin-up', name: 'Weighted chin-up', loadType: 'bodyweight_plus', stepLb: 5, muscleWeights: VERTICAL_PULL, isMainLift: true, notes: 'Log the added load. e1RM uses bodyweight + added load.' },
  { id: 'ex-machine-barbell-row', name: 'Machine barbell row', loadType: 'machine', stepLb: 10, muscleWeights: ROW },
  { id: 'ex-rocking-pulldown', name: 'Rocking pulldown', loadType: 'cable', stepLb: 5, muscleWeights: VERTICAL_PULL },
  { id: 'ex-rear-delt-fly', name: 'Rear delt fly', loadType: 'machine', stepLb: 5, muscleWeights: { rear_delts: 1 } },
  { id: 'ex-face-pull', name: 'Face pull', loadType: 'cable', stepLb: 5, muscleWeights: { rear_delts: 1 } },
  { id: 'ex-preacher-curl', name: 'Preacher curl', loadType: 'machine', stepLb: 5, muscleWeights: { biceps: 1 } },
  { id: 'ex-db-hammer-curl', name: 'DB hammer curl', loadType: 'dumbbell', stepLb: 5, muscleWeights: { biceps: 1 } },
  // Lower B
  { id: 'ex-deadlift', name: 'Deadlift', loadType: 'barbell', stepLb: 10, muscleWeights: HINGE, isMainLift: true },
  { id: 'ex-rdl', name: 'Romanian deadlift', loadType: 'barbell', stepLb: 10, muscleWeights: HINGE },
  { id: 'ex-bss', name: 'Bulgarian split squat', loadType: 'dumbbell', stepLb: 5, muscleWeights: SQUAT, unilateral: true },
  { id: 'ex-leg-press', name: 'Leg press', loadType: 'machine', stepLb: 10, muscleWeights: SQUAT },
  // Upper
  { id: 'ex-incline-cable-press', name: 'Incline cable press', loadType: 'cable', stepLb: 5, muscleWeights: PRESS },
  { id: 'ex-cable-crossover', name: 'Cable crossover', loadType: 'cable', stepLb: 5, muscleWeights: { chest: 1 } },
  { id: 'ex-machine-row-upper', name: 'Machine row (upper)', loadType: 'machine', stepLb: 5, muscleWeights: ROW },
  { id: 'ex-incline-db-biceps-curl', name: 'Incline DB biceps curl (machine)', loadType: 'machine', stepLb: 2.5, muscleWeights: { biceps: 1 } },
  { id: 'ex-straight-bar-pushdown', name: 'Straight-bar triceps pushdown', loadType: 'cable', stepLb: 5, muscleWeights: { triceps: 1 } },
  { id: 'ex-machine-triceps-extension', name: 'Machine triceps extension', loadType: 'machine', stepLb: 5, muscleWeights: { triceps: 1 } },
]

// prettier-ignore
const FINISHER_ROWS: readonly Row[] = [
  { id: 'ex-barbell-shrug', name: 'Barbell shrug', loadType: 'barbell', stepLb: 5, muscleWeights: { traps: 1 }, notes: 'Optional finisher (the spec’s shrug ladder).' },
  { id: 'ex-hyper-y-w', name: 'Hyper Y-W', loadType: 'dumbbell', stepLb: 5, muscleWeights: { rear_delts: 1, back: 0.5 }, notes: 'Optional finisher (the spec’s hyper Y-W combo).' },
]

const FINISHER_REGIME: Regime = {
  sets: 3,
  repMin: 8,
  repMax: 12,
  rirMin: 0,
  rirMax: 1,
  restMinSec: 90,
  restMaxSec: 90,
}

function firstSlotRegime(exerciseId: string): Regime {
  const slot = SEED_PROGRAM_SLOTS.find(
    (s) => s.defaultExerciseId === exerciseId || s.alternateExerciseIds.includes(exerciseId),
  )
  if (!slot) throw new Error(`Seed exercise ${exerciseId} fills no program slot`)
  const { sets, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec } = slot
  return { sets, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec }
}

function toMuscleWeights(w: Weights): MuscleWeights {
  const out: Record<MuscleId, MuscleWeight> = {}
  for (const [muscle, weight] of Object.entries(w)) if (weight !== undefined) out[muscle] = weight
  return out
}

function toExercise(r: Row, defaultRegime: Regime, isFinisher: boolean): Exercise {
  return {
    id: r.id,
    name: r.name,
    loadType: r.loadType,
    equipmentSpecific: r.loadType === 'machine' || r.loadType === 'cable',
    unilateral: r.unilateral ?? false,
    perHand: r.loadType === 'dumbbell',
    stepLb: r.stepLb,
    defaultRegime,
    muscleWeights: toMuscleWeights(r.muscleWeights),
    isMainLift: r.isMainLift ?? false,
    isFinisher,
    notes: r.notes ?? '',
    archivedAt: null,
    createdAt: SEED_EPOCH_MS,
    updatedAt: SEED_EPOCH_MS,
  }
}

export const SEED_EXERCISES: readonly Exercise[] = [
  ...PROGRAM_ROWS.map((r) => toExercise(r, firstSlotRegime(r.id), false)),
  ...FINISHER_ROWS.map((r) => toExercise(r, { ...FINISHER_REGIME }, true)),
]
