// Seed progression starting points (no fake sessions, audit finding #7): one track per program
// slot's default exercise at the default gym, loaded from the spec's "Start load" column (per hand
// for dumbbells, the added load for the chin-up). Calibration (the first session sets the load and
// isn't evaluated) covers the two "Set in week 1" slots and the six exercises whose rep ranges
// changed, which keep their old load as the pre-fill (finding #41).
import { gymScope, trackKey } from '@/domain/progression/keys'
import type { TrackStartRow } from '@/domain/types'
import { SEED_EXERCISES } from './exercises'
import { SEED_EPOCH_MS } from './profile'
import { SEED_GYM_ID, SEED_PROGRAM_SLOTS } from './program'

/** Start load (lb) per slot; null = "Set in week 1". */
const START_LOADS: Readonly<Record<string, number | null>> = {
  'slot-lower-a-1': 220, // Smith machine squat
  'slot-lower-a-2': 170, // Leg extension
  'slot-lower-a-3': 95, // Seated leg curl
  'slot-lower-a-4': 200, // Hip thrust
  'slot-lower-a-5': 350, // Standing calf raise
  'slot-lower-a-6': 160, // Cable crunch
  'slot-push-1': 70, // Incline DB bench press, per hand
  'slot-push-2': null, // Flat machine or DB press
  'slot-push-3': 205, // Machine fly
  'slot-push-4': 170, // Overhead shoulder press
  'slot-push-5': 40, // Lateral raise
  'slot-push-6': 30, // Single-arm overhead cable triceps extension
  'slot-push-7': 200, // Dip machine
  'slot-pull-1': 50, // Weighted chin-up, added load
  'slot-pull-2': 170, // Machine barbell row
  'slot-pull-3': 165, // Rocking pulldown
  'slot-pull-4': 120, // Rear delt fly
  'slot-pull-5': 120, // Face pull
  'slot-pull-6': 80, // Preacher curl
  'slot-pull-7': 45, // DB hammer curl, per hand
  'slot-lower-b-1': 315, // Deadlift
  'slot-lower-b-2': null, // Bulgarian split squat or leg press
  'slot-lower-b-3': 95, // Seated leg curl
  'slot-lower-b-4': 200, // Hip thrust
  'slot-lower-b-5': 170, // Leg extension
  'slot-lower-b-6': 350, // Standing calf raise
  'slot-lower-b-7': 160, // Cable crunch
  'slot-upper-1': 53, // Incline cable press
  'slot-upper-2': 60, // Cable crossover
  'slot-upper-3': 160, // Machine row (upper)
  'slot-upper-4': 40, // Lateral raise
  'slot-upper-5': 40, // Incline DB biceps curl (machine)
  'slot-upper-6': 130, // Straight-bar triceps pushdown
  'slot-upper-7': 75, // Machine triceps extension
}

/** Rep ranges changed: start lighter (fly, raise, rear delt fly, face pull) or heavier (dip, deadlift). */
const RECALIBRATE_EXERCISE_IDS: ReadonlySet<string> = new Set([
  'ex-machine-fly',
  'ex-lateral-raise',
  'ex-rear-delt-fly',
  'ex-face-pull',
  'ex-dip-machine',
  'ex-deadlift',
])

const EXERCISES_BY_ID = new Map(SEED_EXERCISES.map((e) => [e.id, e]))

export const SEED_TRACK_STARTS: readonly TrackStartRow[] = SEED_PROGRAM_SLOTS.map((slot) => {
  const exercise = EXERCISES_BY_ID.get(slot.defaultExerciseId)
  const startLoadLb = START_LOADS[slot.id]
  if (!exercise || startLoadLb === undefined) {
    throw new Error(`Seed slot ${slot.id} has no exercise or start load`)
  }
  const scope = gymScope(exercise.equipmentSpecific, SEED_GYM_ID)
  return {
    trackKey: trackKey(slot.programDayId, exercise.id, scope),
    programDayId: slot.programDayId,
    exerciseId: exercise.id,
    gymScope: scope,
    startLoadLb,
    calibrate: startLoadLb === null || RECALIBRATE_EXERCISE_IDS.has(exercise.id),
    updatedAt: SEED_EPOCH_MS,
  }
})
