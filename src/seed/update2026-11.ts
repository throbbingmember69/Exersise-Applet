// The November 2026 program update (2026-11-21, user request after the per-exercise review in
// docs/EXERCISE-EVIDENCE.md), as one pure transform of the program tables. Like the October
// updates it builds the fresh seed and upgrades existing databases (schema migration v3 → v4) the
// same way, and it only adjusts program rows: history isn't an input. Each step is skipped when
// already done or when the user changed that row, so running it twice changes nothing.
//
// 1. Swaps (the old exercise stays first among the slot's alternates):
//    - Lower B deadlift → Romanian deadlift: no study shows deadlifts growing the hamstrings;
//      hip-flexed long-length loading does (Maeo 2021, 2024).
//    - Pull rocking pulldown → neutral-grip pulldown: flat for 5 sessions; a stall variation.
//    - Pull DB hammer curl → Bayesian cable curl: going backwards (45 → 35 lb).
//    - Upper straight-bar pushdown → overhead rope extension: overhead > neutral arm (Maeo 2023).
//    - Push barbell shrug → DB shrug: the slot was skipped 2 of 3 times.
// 2. Volume, for muscles under the weekly floor:
//    - Lower A: 45° back extension 3 × 10–15 @ RIR 1–2 after the seated leg curl (hamstrings ~8
//      → ~11 sets a week; hip extension > Nordic for the long head, Bourne 2017).
//    - Upper: cable rear delt fly 2 × 12–20 @ RIR 0–1 after the lateral raise and shrug (rear
//      delts ~8 → ~10, now twice a week).
//    - Push: lateral raise 3 → 4 sets (side delts ~9 → ~10; cable ≈ dumbbell, Larsen 2025).
// 3. New and switched slots get calibration track starts (no load: the first session finds it),
//    except bodyweight-plus ones, which start at +0 added load.
import { gymScope, trackKey } from '@/domain/progression/keys'
import type { Exercise, ProgramSlot, Regime } from '@/domain/types'
import { type ProgramTables } from './update2026-10'

export const NOVEMBER_UPDATE_MS = Date.UTC(2026, 10, 21, 12)

const r = (
  sets: number,
  [repMin, repMax]: readonly [number, number],
  [rirMin, rirMax]: readonly [number, number],
  [restMinSec, restMaxSec]: readonly [number, number],
): Regime => ({ sets, repMin, repMax, rirMin, rirMax, restMinSec, restMaxSec })

interface Swap {
  slotId: string
  from: string
  to: string
  /** The slot's label after the swap (only when the label is still the old default's). */
  label: string
  /** Labels that count as "still the old default's" (the seed's, the exercise's name). */
  oldLabels: readonly string[]
}

export const NOVEMBER_SWAPS: readonly Swap[] = [
  {
    slotId: 'slot-lower-b-1',
    from: 'ex-deadlift',
    to: 'ex-rdl',
    label: 'Romanian deadlift (or deadlift)',
    oldLabels: ['Deadlift (or Romanian deadlift)', 'Deadlift'],
  },
  {
    slotId: 'slot-pull-3',
    from: 'ex-rocking-pulldown',
    to: 'ex-neutral-pulldown',
    label: 'Neutral-grip pulldown',
    oldLabels: ['Rocking pulldown'],
  },
  {
    slotId: 'slot-pull-7',
    from: 'ex-db-hammer-curl',
    to: 'ex-bayesian-curl',
    label: 'Bayesian cable curl',
    oldLabels: ['DB hammer curl'],
  },
  {
    slotId: 'slot-upper-6',
    from: 'ex-straight-bar-pushdown',
    to: 'ex-overhead-rope-extension',
    label: 'Overhead rope triceps extension',
    oldLabels: ['Straight-bar triceps pushdown'],
  },
  {
    slotId: 'slot-push-shrug',
    from: 'ex-barbell-shrug',
    to: 'ex-db-shrug',
    label: 'DB shrug',
    oldLabels: ['Barbell shrug'],
  },
]

interface NewSlot {
  id: string
  programDayId: string
  /** Inserted after the first of these slots that is active (else last in the day). */
  after: readonly string[]
  exerciseId: string
  label: string
  regime: Regime
  alternates: readonly string[]
}

export const NOVEMBER_NEW_SLOTS: readonly NewSlot[] = [
  {
    id: 'slot-lower-a-back-extension',
    programDayId: 'day-lower-a',
    after: ['slot-lower-a-3'],
    exerciseId: 'ex-back-extension',
    label: '45° back extension',
    regime: r(3, [10, 15], [1, 2], [90, 90]),
    alternates: ['ex-db-rdl'],
  },
  {
    id: 'slot-upper-rear-delt-fly',
    programDayId: 'day-upper',
    after: ['slot-upper-shrug', 'slot-upper-4'],
    exerciseId: 'ex-cable-rear-delt-fly',
    label: 'Cable rear delt fly',
    regime: r(2, [12, 20], [0, 1], [90, 90]),
    alternates: ['ex-rear-delt-fly'],
  },
]

/** Push lateral raise: 3 → 4 sets (only while it still has the seed's 3). */
export const PUSH_LATERAL_RAISE = {
  slotId: 'slot-push-5',
  exerciseId: 'ex-lateral-raise',
  from: 3,
  to: 4,
}

const alternatesOf = (s: ProgramSlot): string[] =>
  Array.isArray(s.alternateExerciseIds) ? s.alternateExerciseIds : []

/** Apply the November 2026 update (pure; see the header for exactly what changes). */
export function applyUpdate2026_11(t: ProgramTables): ProgramTables {
  const at = NOVEMBER_UPDATE_MS
  const byId = new Map(t.exercises.map((e) => [e.id, e]))
  const isActive = (id: string) => byId.get(id)?.archivedAt === null
  const activeDays = new Set(t.programDays.filter((d) => d.archivedAt === null).map((d) => d.id))
  const switched: ProgramSlot[] = []

  // 1-2. Swaps and the lateral-raise set.
  let slots: ProgramSlot[] = t.programSlots.map((s) => {
    if (s.archivedAt !== null || !activeDays.has(s.programDayId)) return s
    const swap = NOVEMBER_SWAPS.find((w) => w.slotId === s.id)
    if (swap && s.defaultExerciseId === swap.from && isActive(swap.to)) {
      const next: ProgramSlot = {
        ...s,
        defaultExerciseId: swap.to,
        label: swap.oldLabels.includes(s.label) ? swap.label : s.label,
        alternateExerciseIds: [
          swap.from,
          ...alternatesOf(s).filter((id) => id !== swap.from && id !== swap.to),
        ],
      }
      switched.push(next)
      return next
    }
    if (
      s.id === PUSH_LATERAL_RAISE.slotId &&
      s.defaultExerciseId === PUSH_LATERAL_RAISE.exerciseId &&
      s.sets === PUSH_LATERAL_RAISE.from
    ) {
      return { ...s, sets: PUSH_LATERAL_RAISE.to }
    }
    return s
  })

  // 2. New slots.
  const added: ProgramSlot[] = []
  for (const n of NOVEMBER_NEW_SLOTS) {
    if (!activeDays.has(n.programDayId) || slots.some((s) => s.id === n.id)) continue
    if (!isActive(n.exerciseId)) continue
    const daySlots = slots.filter((s) => s.programDayId === n.programDayId)
    const live = daySlots.filter((s) => s.archivedAt === null)
    // Skip when the day already has this exercise (the user added it themselves).
    if (live.some((s) => s.defaultExerciseId === n.exerciseId)) continue
    const anchor = n.after.map((id) => live.find((s) => s.id === id)).find((s) => s !== undefined)
    const order = anchor ? anchor.order + 1 : Math.max(-1, ...daySlots.map((s) => s.order)) + 1
    slots = slots.map((s) =>
      s.programDayId === n.programDayId && s.order >= order ? { ...s, order: s.order + 1 } : s,
    )
    const slot: ProgramSlot = {
      id: n.id,
      programDayId: n.programDayId,
      order,
      label: n.label,
      defaultExerciseId: n.exerciseId,
      alternateExerciseIds: n.alternates.filter((id) => isActive(id) && id !== n.exerciseId),
      ...n.regime,
      optional: false,
      note: '',
      archivedAt: null,
    }
    const after = anchor
      ? slots.findIndex((s) => s.id === anchor.id)
      : slots.map((s) => s.programDayId).lastIndexOf(n.programDayId)
    slots.splice(after + 1, 0, slot)
    added.push(slot)
  }

  // An exercise that now fills a program slot must progress: it can't stay a finisher.
  const filling = new Set([...switched, ...added].map((s) => s.defaultExerciseId))
  const exercises: Exercise[] = t.exercises.map((e) =>
    filling.has(e.id) && e.isFinisher ? { ...e, isFinisher: false, updatedAt: at } : e,
  )
  const current = new Map(exercises.map((e) => [e.id, e]))

  // 3. Track starts (no load: the first session calibrates) for new and switched slots.
  const gyms = t.gyms.filter((g) => g.archivedAt === null)
  const keys = new Set(t.trackStarts.map((s) => s.trackKey))
  const trackStarts = [...t.trackStarts]
  for (const slot of [...switched, ...added]) {
    const e = current.get(slot.defaultExerciseId)!
    const scopes = e.equipmentSpecific
      ? gyms.map((g) => gymScope(true, g.id))
      : [gymScope(false, '')]
    for (const scope of scopes) {
      const key = trackKey(slot.programDayId, e.id, scope)
      if (keys.has(key)) continue
      keys.add(key)
      trackStarts.push({
        trackKey: key,
        programDayId: slot.programDayId,
        exerciseId: e.id,
        gymScope: scope,
        // Bodyweight-plus starts at +0 (bodyweight); anything else finds its load first.
        startLoadLb: e.loadType === 'bodyweight_plus' ? 0 : null,
        calibrate: e.loadType !== 'bodyweight_plus',
        updatedAt: at,
      })
    }
  }

  return { ...t, exercises, programSlots: slots, trackStarts }
}
