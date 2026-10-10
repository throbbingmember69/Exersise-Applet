import { useState } from 'react'
import type { Exercise } from '@/domain/types'
import { youtubeEmbedUrl, type YouTubeVideo } from '@/domain/youtube'
import { formGuideFor } from '@/seed/formGuides'
import { cx } from './cx'
import Icon from './Icon'
import { Button } from './kit'
import styles from './kit.module.css'
import Sheet from './Sheet'

type GuideExercise = Pick<Exercise, 'id' | 'name' | 'formUrl'>

/**
 * The video, played inside the app. Nothing loads from YouTube until it's tapped (a thumbnail
 * stands in), so opening a guide offline or on mobile data costs nothing.
 */
function InlineVideo({ video, title }: { video: YouTubeVideo; title: string }) {
  const [playing, setPlaying] = useState(false)
  const [offline, setOffline] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  return (
    <>
      <div className={styles.video}>
        {playing ? (
          <iframe
            src={youtubeEmbedUrl(video, { autoplay: true })}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            className={styles.videoPoster}
            aria-label={`Play video: ${title}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.onLine === false) setOffline(true)
              else setPlaying(true)
            }}
          >
            {thumbFailed ? null : (
              <img
                src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                onError={() => setThumbFailed(true)}
              />
            )}
            <span className={styles.videoPlay}>
              <Icon name="play" />
              Play video
            </span>
          </button>
        )}
      </div>
      {offline ? (
        <p className={cx(styles.muted, styles.small)} style={{ margin: 0 }} role="status">
          The video needs an internet connection. The cues above work offline.
        </p>
      ) : null}
    </>
  )
}

/** An exercise's form guide: written cues (work offline), the video in the app, a YouTube link. */
export function FormGuideContent({ exercise }: { exercise: GuideExercise }) {
  const guide = formGuideFor(exercise)
  const videoTitle = guide.title ?? `${exercise.name} form video`
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
      {guide.embed ? (
        <InlineVideo key={guide.videoUrl} video={guide.embed} title={videoTitle} />
      ) : null}
      <p className={cx(styles.muted, styles.small)} style={{ margin: 0 }}>
        {guide.source === 'curated'
          ? `${guide.title} · ${guide.channel}`
          : guide.source === 'yours'
            ? 'Your own link (change it in the exercise’s details).'
            : 'No picked video for this exercise: this opens a YouTube search.'}
      </p>
      <a
        className={cx(styles.button, guide.embed ? styles.ghost : styles.primary, styles.block)}
        href={guide.videoUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon name="play" />
        {guide.source === 'search'
          ? 'Search YouTube for form videos'
          : guide.embed
            ? 'Open in YouTube'
            : 'Watch the video'}
      </a>
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
        {/* Rendered only while open: closing the sheet stops the video. */}
        {open ? <FormGuideContent exercise={exercise} /> : null}
      </Sheet>
    </>
  )
}
