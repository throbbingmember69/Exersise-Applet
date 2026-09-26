import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCommand, useLive, useToday, useUnits } from '@/app/hooks'
import { requestNotificationPermission } from '@/platform/notifications'
import { unlockAudio } from '@/platform/feedback'
import { getStartOptions, previewSession } from '@/services/training/queries'
import { startSession } from '@/services/training/session'
import { formatDate, formatLoad, formatRegime } from '@/ui/format'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Stack,
  Toggle,
} from '@/ui/kit'
import MassInput from '@/ui/MassInput'
import Spinner from '@/ui/Spinner'
import styles from './logger.module.css'
import { deloadReasonText } from './text'

const AD_HOC = 'ad-hoc'

const BODYWEIGHT_SOURCE: Record<string, string> = {
  weighin: "today's weigh-in",
  trend: 'trend weight',
  seed: 'starting baseline',
  manual: 'entered',
}

export default function StartSession() {
  const today = useToday()
  const units = useUnits()
  const navigate = useNavigate()
  const { data: opts } = useLive((ctx) => getStartOptions(ctx, { today }), [today])

  const [gymChoice, setGymChoice] = useState<string | null>(null)
  const [dayChoice, setDayChoice] = useState<string | null>(null)
  const [deloadChoice, setDeloadChoice] = useState<boolean | null>(null)
  // undefined = not edited: startSession resolves the same default itself.
  const [bodyweight, setBodyweight] = useState<number | null | undefined>(undefined)

  const gymId = gymChoice ?? opts?.lastGymId ?? null
  const dayId = dayChoice ?? opts?.suggestedDayId ?? AD_HOC
  const isDeload = deloadChoice ?? (dayId !== AD_HOC && (opts?.deload.active ?? false))

  const { data: preview } = useLive(
    (ctx) =>
      gymId && dayId !== AD_HOC
        ? previewSession(ctx, { gymId, programDayId: dayId, isDeload })
        : Promise.resolve(null),
    [gymId, dayId, isDeload],
  )
  const start = useCommand(startSession)

  if (!opts) return <Spinner />

  if (opts.gyms.length === 0 || gymId === null) {
    return (
      <>
        <PageHeader title="Start workout" back="/train" />
        <EmptyState
          title="No gym set up"
          action={<ButtonLink to="/program/gyms">Add a gym</ButtonLink>}
        >
          Add a gym first; it decides which machines and loads apply.
        </EmptyState>
      </>
    )
  }

  const onStart = async () => {
    void unlockAudio()
    void requestNotificationPermission()
    const id = await start.run({
      gymId,
      programDayId: dayId === AD_HOC ? null : dayId,
      isDeload,
      ...(bodyweight != null ? { bodyweightLb: bodyweight } : {}),
    })
    if (id) navigate(`/train/session/${id}`)
  }

  const bw = bodyweight === undefined ? opts.bodyweight.weightLb : bodyweight
  const bwHint =
    bodyweight !== undefined
      ? 'Entered for this workout'
      : opts.bodyweight.weightLb === null
        ? 'No weigh-ins yet — enter it for weighted chin-up e1RM'
        : `From ${BODYWEIGHT_SOURCE[opts.bodyweight.source] ?? 'body log'}${opts.bodyweight.stale ? ' (no recent weigh-in)' : ''}`

  return (
    <>
      <PageHeader title="Start workout" back="/train" />
      <Stack>
        {opts.inProgressSessionId ? (
          <Card title="Workout in progress">
            <p className={styles.muted}>Finish or abandon it before starting another.</p>
            <ButtonLink to={`/train/session/${opts.inProgressSessionId}`} variant="primary" block>
              Resume workout
            </ButtonLink>
          </Card>
        ) : null}

        {opts.gyms.length > 1 ? (
          <Card title="Gym">
            <div className={styles.choiceList} role="group" aria-label="Gym">
              {opts.gyms.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={styles.choice}
                  aria-pressed={g.id === gymId}
                  onClick={() => setGymChoice(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        <Card title="Day">
          <div className={styles.choiceList} role="group" aria-label="Program day">
            {opts.days.map((d) => (
              <button
                key={d.id}
                type="button"
                className={styles.choice}
                aria-pressed={d.id === dayId}
                onClick={() => setDayChoice(d.id)}
              >
                <span>
                  {d.name}
                  {d.id === opts.suggestedDayId ? (
                    <>
                      {' '}
                      <Badge tone="accent">Next up</Badge>
                    </>
                  ) : null}
                </span>
                <span className={styles.choiceHint}>
                  {d.scheduledToday
                    ? 'Today'
                    : d.lastDoneDate
                      ? `Last ${formatDate(d.lastDoneDate)}`
                      : 'Not done yet'}
                </span>
              </button>
            ))}
            <button
              type="button"
              className={styles.choice}
              aria-pressed={dayId === AD_HOC}
              onClick={() => setDayChoice(AD_HOC)}
            >
              <span>Ad hoc workout</span>
              <span className={styles.choiceHint}>Add any exercises</span>
            </button>
          </div>
        </Card>

        <Card>
          <Toggle
            label="Deload session"
            checked={isDeload}
            onChange={setDeloadChoice}
            hint={
              opts.deload.active
                ? `Deload running: ${opts.deload.remaining} of ${opts.deload.total} sessions left`
                : opts.deload.suggested
                  ? `Suggested: ${deloadReasonText(opts.deload.reasons)}`
                  : 'Half the sets at about 10% less load'
            }
          />
          <Field label={`Bodyweight (${units})`} hint={bwHint}>
            <MassInput
              label="Bodyweight"
              valueLb={bw}
              onChangeLb={setBodyweight}
              unit={units}
              stepLb={0.5}
            />
          </Field>
        </Card>

        <Button
          variant="primary"
          block
          icon="play"
          disabled={start.pending || Boolean(opts.inProgressSessionId)}
          onClick={() => void onStart()}
        >
          {start.pending ? 'Starting…' : 'Start workout'}
        </Button>

        {dayId === AD_HOC ? (
          <Card>
            <p className={styles.muted}>
              An ad hoc workout starts empty; add exercises as you go. They count toward volume and
              strength charts but don’t change your program’s loads.
            </p>
          </Card>
        ) : preview ? (
          <Card title={`${preview.dayName} · ${preview.totalSets} sets`}>
            <ul className={styles.slotList}>
              {preview.slots.map((s) => (
                <li key={s.slotId}>
                  <div className={styles.row}>
                    <span className={styles.slotName}>{s.exerciseName}</span>
                    <span className={styles.load}>
                      {s.suggestion.loadLb === null
                        ? 'Find a load'
                        : `${formatLoad(s.suggestion.loadLb, s, units)} × ${s.suggestion.repTargets[0] ?? s.regime.repMin}`}
                    </span>
                  </div>
                  <div className={`${styles.row} ${styles.small}`}>
                    <span className={styles.muted}>
                      {formatRegime(s.regime, s.suggestion.sets)}
                    </span>
                    {s.badge === 'set_load' ? (
                      <Badge tone="warn">Set load</Badge>
                    ) : s.badge === 'recalibrate' ? (
                      <Badge tone="warn">Recalibrate</Badge>
                    ) : s.swapKind === 'gym_override' ? (
                      <Badge>Gym swap</Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </Stack>
    </>
  )
}
