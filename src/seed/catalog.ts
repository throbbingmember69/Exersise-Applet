// Library additions of 2026-10-10 (user request): the exercises the October program update puts
// into slots (hip abduction, incline Smith press) and a researched catalog of common hypertrophy
// exercises for a commercial gym (machines, cables, dumbbells, barbells, bodyweight), so swaps and
// gym changes have good options. Muscle weights follow the spec's convention: 1 = the muscle an
// exercise mainly trains, ½ = an assisting muscle (fractional sets, finding #23). Notes cite the
// study behind a choice where one exists; the cues and videos live in formGuides.ts.
import type { Exercise, LoadType, MuscleWeight, MuscleWeights, Regime } from '@/domain/types'
import type { SeedMuscleId } from './muscles'

/** When the catalog was added: its rows' timestamps (pure: no clock). */
export const CATALOG_2026_10_MS = Date.UTC(2026, 9, 10, 12)

type Weights = Partial<Record<SeedMuscleId, MuscleWeight>>

interface Row {
  id: string
  name: string
  loadType: LoadType
  stepLb: number
  muscleWeights: Weights
  regime: Regime
  unilateral?: boolean
  notes?: string
}

const SQUAT: Weights = { quads: 1, glutes: 0.5 }
const HAMSTRING_HINGE: Weights = { hamstrings: 1, glutes: 0.5 }
const PRESS: Weights = { chest: 1, front_delts: 0.5, triceps: 0.5 }
const VERTICAL_PULL: Weights = { back: 1, biceps: 0.5 }
const ROW: Weights = { back: 1, biceps: 0.5, rear_delts: 0.5 }

const r = (
  sets: number,
  [repMin, repMax]: readonly [number, number],
  [rirMin, rirMax]: readonly [number, number],
  [restMinSec, restMaxSec]: readonly [number, number],
): Regime => ({ sets, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec })

const HEAVY = r(3, [6, 10], [1, 2], [120, 180])
const COMPOUND = r(3, [8, 12], [1, 2], [120, 120])
const ISOLATION = r(3, [10, 15], [0, 1], [90, 90])
const HIGH_REP = r(3, [12, 20], [0, 1], [90, 90])

const ADDED_LOAD = 'Log the added load (0 for bodyweight). e1RM uses bodyweight + added load.'

/** The hip abduction slots' exercise and the incline cable press's replacement. */
export const HIP_ABDUCTION_ID = 'ex-hip-abduction'
export const INCLINE_SMITH_PRESS_ID = 'ex-incline-smith-press'

// prettier-ignore
const ROWS: readonly Row[] = [
  // Program additions (October 2026).
  { id: HIP_ABDUCTION_ID, name: 'Hip abduction (machine)', loadType: 'machine', stepLb: 5, muscleWeights: { glutes: 1 }, regime: HIGH_REP, notes: 'Trains the side glutes (gluteus medius and minimus), which squats and hip thrusts barely reach.' },
  { id: INCLINE_SMITH_PRESS_ID, name: 'Incline Smith press', loadType: 'machine', stepLb: 10, muscleWeights: PRESS, regime: COMPOUND, notes: 'Bench at about 30°. The fixed bar path makes progression easy to track.' },
  // Lower body.
  { id: 'ex-hack-squat', name: 'Hack squat', loadType: 'machine', stepLb: 10, muscleWeights: SQUAT, regime: HEAVY },
  { id: 'ex-db-walking-lunge', name: 'DB walking lunge', loadType: 'dumbbell', stepLb: 5, muscleWeights: SQUAT, regime: COMPOUND, unilateral: true },
  { id: 'ex-lying-leg-curl', name: 'Lying leg curl', loadType: 'machine', stepLb: 5, muscleWeights: { hamstrings: 1 }, regime: ISOLATION, notes: 'Seated curls grew the hamstrings more than lying curls in a 12-week study (Maeo 2021), likely from the longer muscle length. Use this when no seated machine is free.' },
  { id: 'ex-db-rdl', name: 'DB Romanian deadlift', loadType: 'dumbbell', stepLb: 5, muscleWeights: HAMSTRING_HINGE, regime: COMPOUND },
  { id: 'ex-back-extension', name: '45° back extension', loadType: 'bodyweight_plus', stepLb: 5, muscleWeights: HAMSTRING_HINGE, regime: ISOLATION, notes: 'Log the added plate load (0 for bodyweight).' },
  { id: 'ex-cable-glute-kickback', name: 'Cable glute kickback', loadType: 'cable', stepLb: 2.5, muscleWeights: { glutes: 1 }, regime: ISOLATION, unilateral: true },
  { id: 'ex-seated-calf-raise', name: 'Seated calf raise', loadType: 'machine', stepLb: 10, muscleWeights: { calves: 1 }, regime: ISOLATION, notes: 'Bent knees shift the work to the soleus; standing raises grew the calves more overall (Kinoshita 2023), so keep standing raises as the main calf exercise.' },
  { id: 'ex-leg-press-calf-raise', name: 'Leg press calf raise', loadType: 'machine', stepLb: 10, muscleWeights: { calves: 1 }, regime: ISOLATION },
  // Chest.
  { id: 'ex-incline-machine-press', name: 'Incline machine press', loadType: 'machine', stepLb: 5, muscleWeights: PRESS, regime: COMPOUND },
  { id: 'ex-barbell-bench', name: 'Barbell bench press', loadType: 'barbell', stepLb: 5, muscleWeights: PRESS, regime: HEAVY },
  { id: 'ex-low-high-cable-fly', name: 'Low-to-high cable fly', loadType: 'cable', stepLb: 2.5, muscleWeights: { chest: 1 }, regime: ISOLATION },
  { id: 'ex-weighted-dip', name: 'Weighted dip', loadType: 'bodyweight_plus', stepLb: 5, muscleWeights: { chest: 1, triceps: 0.5, front_delts: 0.5 }, regime: COMPOUND, notes: `Lean forward for more chest. ${ADDED_LOAD}` },
  { id: 'ex-push-up', name: 'Push-up', loadType: 'bodyweight_plus', stepLb: 5, muscleWeights: PRESS, regime: r(3, [10, 20], [1, 2], [90, 90]), notes: ADDED_LOAD },
  // Back.
  { id: 'ex-lat-pulldown', name: 'Lat pulldown', loadType: 'cable', stepLb: 5, muscleWeights: VERTICAL_PULL, regime: COMPOUND },
  { id: 'ex-neutral-pulldown', name: 'Neutral-grip pulldown', loadType: 'cable', stepLb: 5, muscleWeights: VERTICAL_PULL, regime: COMPOUND },
  { id: 'ex-seated-cable-row', name: 'Seated cable row', loadType: 'cable', stepLb: 5, muscleWeights: ROW, regime: COMPOUND },
  { id: 'ex-chest-supported-tbar-row', name: 'Chest-supported T-bar row', loadType: 'machine', stepLb: 5, muscleWeights: ROW, regime: COMPOUND },
  { id: 'ex-one-arm-db-row', name: 'One-arm DB row', loadType: 'dumbbell', stepLb: 5, muscleWeights: ROW, regime: COMPOUND, unilateral: true },
  { id: 'ex-pull-up', name: 'Pull-up', loadType: 'bodyweight_plus', stepLb: 5, muscleWeights: VERTICAL_PULL, regime: HEAVY, notes: ADDED_LOAD },
  { id: 'ex-straight-arm-pulldown', name: 'Straight-arm cable pulldown', loadType: 'cable', stepLb: 5, muscleWeights: { back: 1 }, regime: ISOLATION },
  // Shoulders.
  { id: 'ex-seated-db-shoulder-press', name: 'Seated DB shoulder press', loadType: 'dumbbell', stepLb: 5, muscleWeights: { front_delts: 1, side_delts: 0.5, triceps: 0.5 }, regime: HEAVY },
  { id: 'ex-cable-lateral-raise', name: 'Cable lateral raise', loadType: 'cable', stepLb: 2.5, muscleWeights: { side_delts: 1 }, regime: HIGH_REP, unilateral: true, notes: 'The cable keeps tension at the bottom, where dumbbells go slack.' },
  { id: 'ex-db-lateral-raise', name: 'DB lateral raise', loadType: 'dumbbell', stepLb: 5, muscleWeights: { side_delts: 1 }, regime: HIGH_REP },
  { id: 'ex-cable-rear-delt-fly', name: 'Cable rear delt fly', loadType: 'cable', stepLb: 2.5, muscleWeights: { rear_delts: 1 }, regime: HIGH_REP },
  // Arms.
  { id: 'ex-bayesian-curl', name: 'Bayesian cable curl', loadType: 'cable', stepLb: 2.5, muscleWeights: { biceps: 1 }, regime: ISOLATION, unilateral: true, notes: 'The arm stays behind the body, so the biceps work at a long length.' },
  { id: 'ex-ez-bar-curl', name: 'EZ-bar curl', loadType: 'barbell', stepLb: 5, muscleWeights: { biceps: 1 }, regime: ISOLATION },
  { id: 'ex-cable-curl', name: 'Cable curl', loadType: 'cable', stepLb: 5, muscleWeights: { biceps: 1 }, regime: ISOLATION },
  { id: 'ex-overhead-rope-extension', name: 'Overhead rope triceps extension', loadType: 'cable', stepLb: 5, muscleWeights: { triceps: 1 }, regime: ISOLATION, notes: 'Overhead extensions grew the triceps more than pushdowns (Maeo 2023): the long head works at a longer length.' },
  { id: 'ex-rope-pushdown', name: 'Rope triceps pushdown', loadType: 'cable', stepLb: 5, muscleWeights: { triceps: 1 }, regime: ISOLATION },
  { id: 'ex-ez-skull-crusher', name: 'EZ-bar skull crusher', loadType: 'barbell', stepLb: 5, muscleWeights: { triceps: 1 }, regime: ISOLATION },
  // Abs and traps.
  { id: 'ex-hanging-leg-raise', name: 'Hanging leg raise', loadType: 'bodyweight_plus', stepLb: 5, muscleWeights: { abs: 1 }, regime: ISOLATION, notes: ADDED_LOAD },
  { id: 'ex-machine-crunch', name: 'Machine crunch', loadType: 'machine', stepLb: 5, muscleWeights: { abs: 1 }, regime: ISOLATION },
  { id: 'ex-db-shrug', name: 'DB shrug', loadType: 'dumbbell', stepLb: 5, muscleWeights: { traps: 1 }, regime: ISOLATION },
]

function toMuscleWeights(w: Weights): MuscleWeights {
  return Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined)) as MuscleWeights
}

export const CATALOG_2026_10: readonly Exercise[] = ROWS.map((row) => ({
  id: row.id,
  name: row.name,
  loadType: row.loadType,
  equipmentSpecific: row.loadType === 'machine' || row.loadType === 'cable',
  unilateral: row.unilateral ?? false,
  perHand: row.loadType === 'dumbbell',
  stepLb: row.stepLb,
  defaultRegime: { ...row.regime },
  muscleWeights: toMuscleWeights(row.muscleWeights),
  isMainLift: false,
  isFinisher: false,
  notes: row.notes ?? '',
  formUrl: null,
  archivedAt: null,
  createdAt: CATALOG_2026_10_MS,
  updatedAt: CATALOG_2026_10_MS,
}))
