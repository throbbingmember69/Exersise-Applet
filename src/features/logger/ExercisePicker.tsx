import { useMemo, useState } from 'react'
import { useLive } from '@/app/hooks'
import { getExerciseLibrary } from '@/services/program/queries'
import kit from '@/ui/kit.module.css'
import Sheet from '@/ui/Sheet'
import styles from './logger.module.css'

/** Bottom sheet to pick a library exercise (for a swap or an ad hoc add), with search. */
export default function ExercisePicker({
  open,
  title,
  exclude,
  onPick,
  onClose,
}: {
  open: boolean
  title: string
  /** Exercise ids to leave out (already in the session). */
  exclude: readonly string[]
  onPick: (exerciseId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const { data: library } = useLive((ctx) => getExerciseLibrary(ctx), [])
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (library ?? [])
      .filter((e) => !e.archived && !exclude.includes(e.exercise.id))
      .filter(
        (e) =>
          q === '' ||
          e.exercise.name.toLowerCase().includes(q) ||
          e.muscles.some((m) => m.name.toLowerCase().includes(q)),
      )
  }, [library, query, exclude])

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <input
        className={kit.input}
        type="search"
        placeholder="Search exercises or muscles"
        aria-label="Search exercises"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className={styles.choiceList} style={{ marginTop: 'var(--space-3)' }}>
        {list.map((e) => (
          <button
            key={e.exercise.id}
            type="button"
            className={styles.choice}
            onClick={() => onPick(e.exercise.id)}
          >
            <span>{e.exercise.name}</span>
            <span className={styles.choiceHint}>
              {e.muscles
                .filter((m) => m.weight === 1)
                .map((m) => m.name)
                .join(', ')}
            </span>
          </button>
        ))}
        {library && list.length === 0 ? (
          <p className={styles.muted}>No matching exercises.</p>
        ) : null}
      </div>
    </Sheet>
  )
}
