import { useParams } from 'react-router'
import { useCommand, useLive, useUnits } from '@/app/hooks'
import type { ServiceCtx } from '@/services/context'
import { getSessionSummary, type SummaryExerciseView } from '@/services/training/queries'
import { acceptDeload, recordShown, respondSuggestion } from '@/services/training/suggestions'
import { formatDate, formatLoad } from '@/ui/format'
import { Badge, Button, ButtonLink, Card, EmptyState, PageHeader, Stack, type Tone } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import Spinner from '@/ui/Spinner'
import { formatMass } from '@/domain/units'
import styles from './logger.module.css'
import { deloadReasonText } from './text'

/** Record a suggestion as shown and answer it (stall cards and deload suggestions). */
async function answerSuggestion(
  ctx: ServiceCtx,
  kind: 'stall' | 'deload',
  key: string,
  response: 'accepted' | 'dismissed',
): Promise<void> {
  const id = await recordShown(ctx, { kind, key })
  await respondSuggestion(ctx, id, response)
}

function outcomeBadge(
  e: SummaryExerciseView,
  missesBeforeDrop: number,
): { text: string; tone: Tone } {
  switch (e.outcome) {
    case 'step':
      return { text: 'Step up ▲', tone: 'good' }
    case 'plus_rep':
      return { text: '+1 rep next', tone: 'accent' }
    case 'miss':
      return { text: `Miss ${e.missStreak} of ${missesBeforeDrop}`, tone: 'warn' }
    case 'drop':
      return { text: 'Load drop ▼', tone: 'bad' }
    case 'calibrated':
      return { text: 'Calibrated', tone: 'accent' }
    case 'skipped':
      return { text: 'Skipped', tone: 'neutral' }
    case 'deload':
      return { text: 'Deload', tone: 'neutral' }
    case 'not_tracked':
      return { text: 'Logged', tone: 'neutral' }
  }
}

export default function Summary() {
  const { id = '' } = useParams()
  const units = useUnits()
  const { data: summary } = useLive((ctx) => getSessionSummary(ctx, id), [id])
  const answer = useCommand(answerSuggestion)
  const startDeload = useCommand(acceptDeload, { success: 'Deload started' })

  if (summary === undefined) return <Spinner />
  if (summary === null) {
    return (
      <>
        <PageHeader title="Summary" back="/" />
        <EmptyState title="Workout not found" />
      </>
    )
  }

  const prs = summary.exercises.filter((e) => e.isPr).length

  return (
    <>
      <PageHeader title={summary.dayName} back="/" />
      <p className={`${styles.muted} ${styles.small}`} style={{ marginTop: '-0.5rem' }}>
        {formatDate(summary.date)} · {summary.gymName} · {summary.volume.totalSets} working sets
        {prs > 0 ? ` · ${prs} PR${prs > 1 ? 's' : ''}` : ''}
      </p>
      <Stack>
        {summary.deloadSuggestion ? (
          <Card title="Deload suggested">
            <p className={styles.muted}>
              {deloadReasonText(summary.deloadSuggestion.reasons)}. A deload week is about half the
              sets at ~10% lighter loads, then you pick up where you left off.
            </p>
            <div className={kit.actions}>
              <Button
                onClick={() =>
                  void answer.run('deload', summary.deloadSuggestion!.fingerprint, 'dismissed')
                }
              >
                Not now
              </Button>
              <Button
                variant="primary"
                onClick={() => void startDeload.run({ key: summary.deloadSuggestion!.fingerprint })}
              >
                Start deload
              </Button>
            </div>
          </Card>
        ) : null}

        <Card title="Next time">
          <ul className={styles.slotList}>
            {summary.exercises.map((e) => {
              const badge = outcomeBadge(e, summary.missesBeforeDrop)
              return (
                <li key={e.sessionExerciseId}>
                  <div className={styles.row}>
                    <span className={styles.slotName}>{e.exerciseName}</span>
                    <Badge tone={badge.tone}>{badge.text}</Badge>
                  </div>
                  <div className={`${styles.row} ${styles.small}`}>
                    <span className={styles.muted}>
                      {e.bestSet
                        ? `Best ${formatLoad(e.bestSet.loadLb, e, units)} × ${e.bestSet.reps}${
                            e.bestSet.e1rmDisplayLb !== null
                              ? ` · e1RM ${formatMass(e.bestSet.e1rmDisplayLb, units)}`
                              : ''
                          }`
                        : `${e.workingSetCount} of ${e.prescribedSets} sets`}
                      {e.isPr ? ' ' : ''}
                      {e.isPr ? <Badge tone="good">PR</Badge> : null}
                    </span>
                    {e.next ? (
                      <span className={styles.load}>
                        {e.next.loadLb === null
                          ? 'Find a load'
                          : `${formatLoad(e.next.loadLb, e, units)} × ${e.next.repTargets[0] ?? ''}`}
                      </span>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        {summary.stalls.length > 0 ? (
          <Card title="Stalled lifts">
            <p className={`${styles.muted} ${styles.small}`}>
              No progress in the last sessions. Check sleep and calories; then try a close variation
              or one fewer set for two weeks.
            </p>
            <ul className={styles.slotList}>
              {summary.stalls.map((s) => (
                <li key={s.key} className={styles.row}>
                  <span>
                    {s.name}
                    {s.gymName ? <span className={styles.muted}> · {s.gymName}</span> : null}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => void answer.run('stall', s.key, 'dismissed')}
                  >
                    Dismiss
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card title="Volume this session">
          {summary.volume.overCap.length > 0 ? (
            <p>
              <Badge tone="warn">Over {summary.volume.sessionCap} sets</Badge>{' '}
              {summary.volume.overCap.map((m) => `${m.name} ${m.sets}`).join(', ')} — past ~
              {summary.volume.sessionCap} sets per session extra sets add little.
            </p>
          ) : null}
          <p className={styles.muted}>
            {summary.volume.byMuscle
              .filter((m) => m.sets > 0)
              .map((m) => `${m.name} ${m.sets}`)
              .join(' · ')}
          </p>
        </Card>

        <ButtonLink to="/" variant="primary" block>
          Done
        </ButtonLink>
        <ButtonLink to={`/train/history/${summary.sessionId}`} block>
          View in history
        </ButtonLink>
      </Stack>
    </>
  )
}
