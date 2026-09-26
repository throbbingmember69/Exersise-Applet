import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useCommand, useLive, useToast, useUnits } from '@/app/hooks'
import {
  clearRestNotification,
  browserRestAlertDeps,
  scheduleRestAlerts,
} from '@/platform/restAlerts'
import { keepScreenOn } from '@/platform/wakeLock'
import { loadSettings } from '@/services/settings'
import { getLoggerView } from '@/services/training/queries'
import { clearRestTimer, getRestTimer } from '@/services/training/restTimerState'
import {
  abandonSession,
  addExercise,
  finishSession,
  setSessionBodyweight,
  swapExercise,
} from '@/services/training/session'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { Button, Card, EmptyState, Field, PageHeader, Stack, Toggle } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import MassInput from '@/ui/MassInput'
import Sheet from '@/ui/Sheet'
import Spinner from '@/ui/Spinner'
import ExerciseCard from './ExerciseCard'
import ExercisePicker from './ExercisePicker'
import RestTimerBar from './RestTimerBar'
import styles from './logger.module.css'

export default function Logger() {
  const { id = '' } = useParams()
  const units = useUnits()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: view } = useLive((ctx) => getLoggerView(ctx, id), [id])
  const { data: rest } = useLive((ctx) => getRestTimer(ctx), [])
  const { data: settings } = useLive((ctx) => loadSettings(ctx), [])

  const [swapping, setSwapping] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [abandoning, setAbandoning] = useState(false)
  const [jointPain, setJointPain] = useState(false)
  const [note, setNote] = useState('')
  const [bodyweight, setBodyweight] = useState<number | null>(null)

  const swap = useCommand(swapExercise)
  const add = useCommand(addExercise)
  const finish = useCommand(finishSession)
  const abandon = useCommand(abandonSession)
  const clearTimer = useCommand(clearRestTimer)
  const saveBodyweight = useCommand(setSessionBodyweight, { success: 'Bodyweight saved' })

  const inProgress = view?.session.status === 'in_progress'
  const timer = rest && rest.sessionId === id && inProgress ? rest.timer : null

  // Keep the screen on while logging (the rest timer stays visible and its timers keep running).
  useEffect(() => {
    if (!inProgress) return
    let handle: Awaited<ReturnType<typeof keepScreenOn>> = null
    let cancelled = false
    void keepScreenOn().then((h) => {
      if (cancelled) void h?.release()
      else handle = h
    })
    return () => {
      cancelled = true
      void handle?.release()
    }
  }, [inProgress])

  // Rest alerts: vibrate + beep in the app, a notification in the background.
  useEffect(() => {
    if (!timer) return
    const cancel = scheduleRestAlerts(
      timer,
      browserRestAlertDeps(`#/train/session/${id}`),
      (kind) =>
        toast.show(kind === 'min' ? 'Rest done — next set when ready' : 'Rest over', {
          tone: 'good',
        }),
    )
    const onVisible = () => {
      if (document.visibilityState === 'visible') void clearRestNotification()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancel()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [timer, id, toast])

  if (view === undefined) return <Spinner />
  if (view === null) {
    return (
      <>
        <PageHeader title="Workout" back="/train" />
        <EmptyState title="Workout not found">It may have been deleted.</EmptyState>
      </>
    )
  }
  if (view.session.status === 'finished')
    return <Navigate to={`/train/session/${id}/summary`} replace />
  if (view.session.status === 'abandoned') return <Navigate to={`/train/history/${id}`} replace />

  const needsBodyweight =
    view.session.bodyweightLb === null &&
    view.exercises.some((e) => e.loadType === 'bodyweight_plus')
  const inSession = view.exercises.map((e) => e.exerciseId)
  const missing = Math.max(0, view.prescribedSetCount - view.workingSetCount)

  const onFinish = async () => {
    if (!(await finish.tryRun(id, { jointPain, note: note.trim() }))) return
    setFinishing(false)
    void clearTimer.run()
    navigate(`/train/session/${id}/summary`)
  }

  return (
    <>
      <PageHeader
        title={view.dayName}
        back="/train"
        actions={
          <Button variant="ghost" onClick={() => setAbandoning(true)}>
            Abandon
          </Button>
        }
      />
      <p className={`${styles.muted} ${styles.small}`} style={{ marginTop: '-0.5rem' }}>
        {view.gymName} · {view.workingSetCount} of {view.prescribedSetCount} sets
        {view.session.isDeload ? ' · deload' : ''}
      </p>
      <Stack>
        {needsBodyweight ? (
          <Card title="Bodyweight">
            <Field label={`Today's bodyweight (${units})`} hint="Needed for weighted chin-up e1RM">
              <MassInput
                label="Bodyweight"
                valueLb={bodyweight}
                onChangeLb={setBodyweight}
                unit={units}
                stepLb={0.5}
              />
            </Field>
            <div className={kit.actions}>
              <Button
                variant="primary"
                disabled={bodyweight === null}
                onClick={() => bodyweight !== null && void saveBodyweight.run(id, bodyweight)}
              >
                Save
              </Button>
            </div>
          </Card>
        ) : null}

        {view.exercises.map((ex) => (
          <ExerciseCard
            key={ex.sessionExerciseId}
            sessionId={id}
            ex={ex}
            unit={units}
            onSwap={() => setSwapping(ex.sessionExerciseId)}
          />
        ))}

        {view.exercises.length === 0 ? (
          <EmptyState title="No exercises yet">Add the exercises you’re doing today.</EmptyState>
        ) : null}

        <Button block icon="plus" onClick={() => setAdding(true)}>
          Add exercise
        </Button>
        <Button variant="primary" block icon="check" onClick={() => setFinishing(true)}>
          Finish workout
        </Button>
        {timer ? <div className={styles.spacer} /> : null}
      </Stack>

      {timer ? <RestTimerBar timer={timer} extendSec={settings?.restExtendSec ?? 30} /> : null}

      <ExercisePicker
        open={swapping !== null}
        title="Swap exercise"
        exclude={inSession}
        onClose={() => setSwapping(null)}
        onPick={(exerciseId) => {
          if (swapping) void swap.run(swapping, exerciseId)
          setSwapping(null)
        }}
      />
      <ExercisePicker
        open={adding}
        title="Add exercise"
        exclude={inSession}
        onClose={() => setAdding(false)}
        onPick={(exerciseId) => {
          void add.run(id, exerciseId)
          setAdding(false)
        }}
      />

      <Sheet open={finishing} title="Finish workout" onClose={() => setFinishing(false)}>
        <div className={kit.stack}>
          <p className={styles.muted}>
            {missing > 0
              ? `${missing} planned ${missing === 1 ? 'set is' : 'sets are'} not logged. Unlogged exercises are skipped and keep their suggestion.`
              : 'All planned sets logged.'}
          </p>
          <Toggle
            label="Joint pain today"
            hint="Flag it; pain in 2 of 3 sessions suggests a deload"
            checked={jointPain}
            onChange={setJointPain}
          />
          <Field label="Note" htmlFor="session-note">
            <input
              id="session-note"
              className={kit.input}
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <div className={kit.actions}>
            <Button onClick={() => setFinishing(false)}>Keep logging</Button>
            <Button variant="primary" disabled={finish.pending} onClick={() => void onFinish()}>
              Finish
            </Button>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={abandoning}
        title="Abandon workout?"
        danger
        confirmLabel="Abandon"
        onCancel={() => setAbandoning(false)}
        onConfirm={() => {
          setAbandoning(false)
          void abandon.tryRun(id).then((ok) => {
            if (!ok) return
            void clearTimer.run()
            navigate('/train')
          })
        }}
      >
        It stays in your history but doesn’t count toward progression. You can restore it later.
      </ConfirmDialog>
    </>
  )
}
