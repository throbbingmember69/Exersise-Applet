import { useState } from 'react'
import { useCommand } from '@/app/hooks'
import type { UnitSystem } from '@/domain/types'
import type { LoggerExerciseView } from '@/services/training/queries'
import { updateSet } from '@/services/training/session'
import { formatLoad } from '@/ui/format'
import RirChips from '@/ui/RirChips'
import styles from './logger.module.css'

/**
 * The finish sheet's RIR prompt: every working set logged without RIR, each with RIR chips.
 * Optional; it never blocks finishing. The list is fixed when the sheet opens, so a row stays put
 * (showing its new value) after its RIR is filled in.
 */
export default function MissingRir({
  exercises,
  unit,
}: {
  exercises: readonly LoggerExerciseView[]
  unit: UnitSystem
}) {
  const [ids] = useState(
    () =>
      new Set(
        exercises.flatMap((ex) =>
          ex.sets.filter((s) => !s.isWarmup && s.rir === null).map((s) => s.id),
        ),
      ),
  )
  const update = useCommand(updateSet)
  const rows = exercises.flatMap((ex) =>
    ex.sets.filter((s) => ids.has(s.id)).map((set) => ({ ex, set })),
  )
  if (rows.length === 0) return null
  return (
    <section aria-label="Sets without RIR">
      <p className={styles.muted}>
        {rows.length} {rows.length === 1 ? 'set has' : 'sets have'} no RIR. Add reps in reserve if
        you remember them (optional).
      </p>
      <ul className={styles.missingRir}>
        {rows.map(({ ex, set }) => (
          <li key={set.id}>
            <span className={styles.small}>
              {ex.exerciseName} · set {set.setIndex + 1} · {formatLoad(set.loadLb, ex, unit)} ×{' '}
              {set.reps}
            </span>
            <RirChips
              value={set.rir}
              onChange={(rir) => void update.run(set.id, { rir })}
              label={`${ex.exerciseName} set ${set.setIndex + 1} RIR`}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
