// Seed program: the spec's "Training program" tables as five days and 34 slots, plus the default
// gym. Each slot owns its regime (sets, rep range, RIR, rest). An "X or Y" row defaults to the
// first-named exercise with the other as an alternate. Rest is stored as a min/max pair:
// "90 s" → 90/90, "2 min" → 120/120, "2–3 min" → 120/180, "3 min" → 180/180.
import type { Gym, ProgramDay, ProgramSlot } from '@/domain/types'
import { SEED_EPOCH_MS } from './profile'

export const SEED_GYM_ID = 'gym-1'

/** The default gym. Seeded machine and cable start loads belong to it. */
export const SEED_GYMS: readonly Gym[] = [
  { id: SEED_GYM_ID, name: 'Gym 1', sortOrder: 0, archivedAt: null, createdAt: SEED_EPOCH_MS },
]

type Range = readonly [min: number, max: number]

const REST_90S: Range = [90, 90]
const REST_2MIN: Range = [120, 120]
const REST_2_3MIN: Range = [120, 180]
const REST_3MIN: Range = [180, 180]

interface SlotRow {
  label: string
  exerciseId: string
  alternates: string[]
  sets: number
  reps: Range
  rir: Range
  rest: Range
}

/** One table row: label, default exercise, sets, rep range, RIR range, rest, then alternates. */
function row(
  label: string,
  exerciseId: string,
  sets: number,
  reps: Range,
  rir: Range,
  rest: Range,
  ...alternates: string[]
): SlotRow {
  return { label, exerciseId, alternates, sets, reps, rir, rest }
}

function day(
  id: string,
  name: string,
  weekday: ProgramDay['weekday'],
  order: number,
  note: string,
): ProgramDay {
  return { id, name, weekday, order, note, archivedAt: null }
}

// prettier-ignore
const PROGRAM: readonly { day: ProgramDay; rows: readonly SlotRow[] }[] = [
  {
    day: day('day-lower-a', 'Lower A', 1, 0, 'Quad focus'),
    rows: [
      row('Smith machine squat', 'ex-smith-squat', 4, [6, 10], [1, 2], REST_2_3MIN),
      row('Leg extension', 'ex-leg-extension', 3, [10, 15], [0, 1], REST_90S),
      row('Seated leg curl', 'ex-seated-leg-curl', 3, [10, 15], [0, 1], REST_90S),
      row('Hip thrust', 'ex-hip-thrust', 2, [8, 12], [1, 2], REST_2MIN),
      row('Standing calf raise', 'ex-standing-calf-raise', 3, [10, 15], [0, 1], REST_90S),
      row('Cable crunch', 'ex-cable-crunch', 3, [10, 15], [0, 1], REST_90S),
    ],
  },
  {
    day: day('day-push', 'Push', 2, 1, ''),
    rows: [
      row('Incline DB bench press', 'ex-incline-db-bench', 3, [6, 10], [1, 2], REST_2_3MIN),
      row('Flat machine or DB press (new)', 'ex-flat-machine-press', 3, [8, 12], [1, 2], REST_2MIN, 'ex-flat-db-press'),
      row('Machine fly', 'ex-machine-fly', 2, [10, 15], [0, 1], REST_90S),
      row('Overhead shoulder press', 'ex-overhead-press', 3, [6, 10], [1, 2], REST_2_3MIN),
      row('Lateral raise (machine)', 'ex-lateral-raise', 3, [10, 20], [0, 1], REST_90S),
      row('Single-arm overhead cable triceps extension', 'ex-overhead-cable-triceps-extension', 3, [10, 15], [0, 1], REST_90S),
      row('Dip machine', 'ex-dip-machine', 2, [8, 12], [1, 2], REST_2MIN),
    ],
  },
  {
    day: day('day-pull', 'Pull', 3, 2, ''),
    rows: [
      row('Weighted chin-up', 'ex-weighted-chin-up', 3, [6, 8], [1, 2], REST_2_3MIN),
      row('Machine barbell row', 'ex-machine-barbell-row', 3, [8, 12], [1, 2], REST_2MIN),
      row('Rocking pulldown', 'ex-rocking-pulldown', 2, [10, 12], [1, 2], REST_2MIN),
      row('Rear delt fly', 'ex-rear-delt-fly', 3, [12, 20], [0, 1], REST_90S),
      row('Face pull', 'ex-face-pull', 2, [12, 15], [0, 1], REST_90S),
      row('Preacher curl', 'ex-preacher-curl', 3, [8, 12], [0, 1], REST_90S),
      row('DB hammer curl', 'ex-db-hammer-curl', 2, [10, 12], [0, 1], REST_90S),
    ],
  },
  {
    day: day('day-lower-b', 'Lower B', 5, 3, 'Posterior chain'),
    rows: [
      row('Deadlift (or Romanian deadlift)', 'ex-deadlift', 3, [5, 8], [2, 3], REST_3MIN, 'ex-rdl'),
      row('Bulgarian split squat or leg press (new)', 'ex-bss', 3, [8, 12], [1, 2], REST_2MIN, 'ex-leg-press'),
      row('Seated leg curl', 'ex-seated-leg-curl', 3, [10, 15], [0, 1], REST_90S),
      row('Hip thrust', 'ex-hip-thrust', 3, [8, 12], [1, 2], REST_2MIN),
      row('Leg extension', 'ex-leg-extension', 2, [12, 15], [0, 1], REST_90S),
      row('Standing calf raise', 'ex-standing-calf-raise', 3, [10, 15], [0, 1], REST_90S),
      row('Cable crunch', 'ex-cable-crunch', 2, [10, 15], [0, 1], REST_90S),
    ],
  },
  {
    day: day('day-upper', 'Upper', 6, 4, 'Chest, back, delts, arms'),
    rows: [
      row('Incline cable press', 'ex-incline-cable-press', 3, [8, 12], [1, 2], REST_2MIN),
      row('Cable crossover', 'ex-cable-crossover', 2, [10, 15], [0, 1], REST_90S),
      row('Machine row (upper)', 'ex-machine-row-upper', 3, [8, 12], [1, 2], REST_2MIN),
      row('Lateral raise (machine)', 'ex-lateral-raise', 4, [10, 20], [0, 1], REST_90S),
      row('Incline DB biceps curl (machine)', 'ex-incline-db-biceps-curl', 3, [10, 15], [0, 1], REST_90S),
      row('Straight-bar triceps pushdown', 'ex-straight-bar-pushdown', 3, [10, 15], [0, 1], REST_90S),
      row('Machine triceps extension', 'ex-machine-triceps-extension', 2, [12, 15], [0, 1], REST_90S),
    ],
  },
]

export const SEED_PROGRAM_DAYS: readonly ProgramDay[] = PROGRAM.map((p) => p.day)

/** Slots in day order, then table order. Ids follow the table's # column: `slot-push-2`. */
export const SEED_PROGRAM_SLOTS: readonly ProgramSlot[] = PROGRAM.flatMap(({ day, rows }) =>
  rows.map((r, i): ProgramSlot => ({
    id: `slot-${day.id.replace(/^day-/, '')}-${i + 1}`,
    programDayId: day.id,
    order: i,
    label: r.label,
    defaultExerciseId: r.exerciseId,
    alternateExerciseIds: [...r.alternates],
    sets: r.sets,
    repMin: r.reps[0],
    repMax: r.reps[1],
    rirMin: r.rir[0],
    rirMax: r.rir[1],
    restMinSec: r.rest[0],
    restMaxSec: r.rest[1],
    note: '',
    archivedAt: null,
  })),
)
