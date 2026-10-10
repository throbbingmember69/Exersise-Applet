import { useState } from 'react'
import type { Exercise } from '@/domain/types'
import { formGuideFor } from '@/seed/formGuides'
import { cx } from './cx'
import Icon from './Icon'
import { Button } from './kit'
import styles from './kit.module.css'
import Sheet from './Sheet'

type GuideExercise = Pick<Exercise, 'id' | 'name' | 'formUrl'>

/** An exercise's form guide: written cues (work offline) and a YouTube link. */
export function FormGuideContent({ exercise }: { exercise: GuideExercise }) {
  const guide = formGuideFor(exercise)
  return (
    <div className={styles.stack}>
      {guide.cues.length > 0 ? (
        <ol style={{ margin: 0, paddingLeft: '1.25rem' }} aria-label="Form cues">
          {guide.cues.map((cue) => (
            <li key={cue} style={{ marginBottom: 'var(--space-1)' }}>
              {cue}
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>No written cues for this exercise yet.</p>
      )}
      <a
        className={cx(styles.button, styles.primary, styles.block)}
        href={guide.videoUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="play" />
        {guide.source === 'search' ? 'Search YouTube for form videos' : 'Watch on YouTube'}
      </a>
      <p className={cx(styles.muted, styles.small)} style={{ margin: 0 }}>
        {guide.source === 'curated'
          ? `${guide.title} · ${guide.channel}`
          : guide.source === 'yours'
            ? 'Your own link (change it in the exercise’s details).'
            : 'No picked video for this exercise: this opens a YouTube search.'}
      </p>
    </div>
  )
}

/** A "Form" button that opens the exercise's guide in a sheet. */
export default function FormGuideButton({
  exercise,
  label = 'Form',
}: {
  exercise: GuideExercise
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        icon="play"
        aria-label={`Form guide for ${exercise.name}`}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Sheet open={open} title={`Form: ${exercise.name}`} onClose={() => setOpen(false)}>
        {open ? <FormGuideContent exercise={exercise} /> : null}
      </Sheet>
    </>
  )
}
