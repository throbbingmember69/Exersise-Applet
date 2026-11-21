import { useState } from 'react'
import { useCommand, useLive } from '@/app/hooks'
import { CARDIO_MODALITIES } from '@/domain/cardio'
import type { CardioIntensity, CardioModality } from '@/domain/types'
import {
  addCardioInEdit,
  CARDIO_INTENSITIES,
  getCardioBlock,
  logCardio,
  restoreCardio,
  voidCardio,
  voidCardioInEdit,
  type CardioBlockView,
} from '@/services/training/cardio'
import { CARDIO_INTENSITY_LABELS, CARDIO_MODALITY_LABELS, formatCardio } from '@/ui/format'
import { Badge, Button, Card } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import styles from './logger.module.css'

/**
 * Post-workout cardio: this week's ramping target (10 → 30 min), a suggested machine, the logged
 * entries and, when `editable`, the entry form. In the logger it writes through the logger
 * commands; in a past session's Edit mode, through the Edit-mode ones.
 */
export default function CardioCard({
  sessionId,
  editable,
}: {
  sessionId: string
  editable: boolean
}) {
  const { data: block } = useLive((ctx) => getCardioBlock(ctx, sessionId), [sessionId])
  if (!block) return null
  if (!editable && block.entries.length === 0) return null
  return <CardioBody key={block.suggestedModality} block={block} editable={editable} />
}

function CardioBody({ block, editable }: { block: CardioBlockView; editable: boolean }) {
  const { target } = block
  const inEdit = block.mode === 'edit'
  const [modality, setModality] = useState<CardioModality>(block.suggestedModality)
  const [minutes, setMinutes] = useState<number | null>(null)
  const [intensity, setIntensity] = useState<CardioIntensity>('easy')
  const [heartRate, setHeartRate] = useState<number | null>(null)

  const add = useCommand(inEdit ? addCardioInEdit : logCardio)
  const remove = useCommand(inEdit ? voidCardioInEdit : voidCardio)
  const restore = useCommand(restoreCardio)

  const onLog = async (value: number | null) => {
    if (value === null) return
    const id = await add.run({
      sessionId: block.sessionId,
      modality,
      minutes: value,
      intensity,
      avgHeartRate: heartRate,
    })
    if (id) {
      setMinutes(null)
      setHeartRate(null)
    }
  }

  return (
    <Card title="Cardio">
      <p className={styles.why}>
        Target this week: <strong>{target.minutes} min</strong>, easy (conversational pace), after
        lifting.
        {block.legDay ? ' Bike suggested: cycling interferes least with leg growth.' : ''}
      </p>
      {editable && !inEdit ? (
        <p className={`${styles.muted} ${styles.small}`}>
          {target.atMax
            ? `At the ${target.minutes}-minute cap.`
            : `${target.sessionsAtTarget} of ${target.sessionsNeeded} workouts at ${target.minutes} min this week → ${target.nextMinutes} min next week.`}
        </p>
      ) : null}

      {block.entries.length > 0 ? (
        <ul className={styles.cardioEntries}>
          {block.entries.map((e) => (
            <li key={e.id}>
              <span>{formatCardio(e)}</span>
              {editable ? (
                <Button
                  variant="ghost"
                  icon="x"
                  aria-label={`Remove ${formatCardio(e)}`}
                  onClick={() => void remove.run(e.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {block.entries.length > 0 ? (
        <p className={styles.small}>
          {block.totalMinutes} of {target.minutes} min{' '}
          {block.metTarget ? <Badge tone="good">Target met</Badge> : null}
        </p>
      ) : null}
      {editable && inEdit && block.voided.length > 0 ? (
        <ul className={styles.cardioEntries}>
          {block.voided.map((e) => (
            <li key={e.id} className={styles.muted}>
              <span>Deleted: {formatCardio(e)}</span>
              <Button variant="ghost" onClick={() => void restore.run(e.id)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {editable ? (
        <div className={kit.stack}>
          <div className={kit.chips} role="group" aria-label="Cardio machine">
            {CARDIO_MODALITIES.map((m) => (
              <button
                key={m}
                type="button"
                className={kit.chip}
                aria-pressed={modality === m}
                onClick={() => setModality(m)}
              >
                {CARDIO_MODALITY_LABELS[m]}
              </button>
            ))}
          </div>
          <div className={kit.chips} role="group" aria-label="Cardio intensity">
            {CARDIO_INTENSITIES.map((i) => (
              <button
                key={i}
                type="button"
                className={kit.chip}
                aria-pressed={intensity === i}
                onClick={() => setIntensity(i)}
              >
                {CARDIO_INTENSITY_LABELS[i]}
              </button>
            ))}
          </div>
          <div className={styles.entry}>
            <div>
              <NumberStepper
                label="Cardio minutes"
                value={minutes}
                onChange={setMinutes}
                step={1}
                min={1}
                max={180}
                decimals={0}
                placeholder={String(target.minutes)}
                bumpFrom={target.minutes}
              />
            </div>
            <div>
              <NumberStepper
                label="Average heart rate (bpm, optional)"
                value={heartRate}
                onChange={setHeartRate}
                step={1}
                min={30}
                max={250}
                decimals={0}
                placeholder="bpm"
              />
            </div>
            <div className={styles.entryActions}>
              {minutes === null ? (
                <Button disabled={add.pending} onClick={() => void onLog(target.minutes)}>
                  Hit target ({target.minutes} min)
                </Button>
              ) : null}
              <Button
                variant="primary"
                disabled={minutes === null || add.pending}
                onClick={() => void onLog(minutes)}
              >
                Log cardio
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
