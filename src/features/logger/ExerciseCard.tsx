import { useState } from 'react'
import { useCommand } from '@/app/hooks'
import { formatMass } from '@/domain/units'
import type { UnitSystem } from '@/domain/types'
import type { LoggerExerciseView } from '@/services/training/queries'
import { startRestTimer } from '@/services/training/restTimerState'
import { logSet, removeExercise, updateSet, voidSet } from '@/services/training/session'
import { formatDate, formatLoad, formatRegime, formatSets } from '@/ui/format'
import { Badge, Button, Card, Toggle } from '@/ui/kit'
import MassInput from '@/ui/MassInput'
import NumberStepper from '@/ui/NumberStepper'
import RirChips from '@/ui/RirChips'
import SetEditor from './SetEditor'
import styles from './logger.module.css'
import { noticeText, suggestionWhy } from './text'

/** One exercise of the workout: what to lift, what was logged, and the next-set entry. */
export default function ExerciseCard({
  sessionId,
  ex,
  unit,
  onSwap,
}: {
  sessionId: string
  ex: LoggerExerciseView
  unit: UnitSystem
  onSwap: () => void
}) {
  const working = ex.sets.filter((s) => !s.isWarmup)
  const lastLogged = working.at(-1) ?? ex.sets.at(-1)
  const nextIndex = working.length
  const targetReps = ex.suggestion.repTargets[nextIndex] ?? ex.prescription.repMin
  const defaultLoad =
    lastLogged?.loadLb ?? ex.suggestion.loadLb ?? ex.lastTime?.sets.at(-1)?.loadLb ?? null

  const [load, setLoad] = useState<number | null | undefined>(undefined)
  const [reps, setReps] = useState<number | null | undefined>(undefined)
  const [rir, setRir] = useState<number | null>(null)
  const [warmup, setWarmup] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const loadValue = load === undefined ? defaultLoad : load
  const repsValue = reps === undefined ? targetReps : reps

  const log = useCommand(logSet)
  const restart = useCommand(startRestTimer)
  const update = useCommand(updateSet)
  const remove = useCommand(voidSet)
  const drop = useCommand(removeExercise)

  const onLog = async () => {
    if (loadValue == null || repsValue == null) return
    const id = await log.run({
      sessionExerciseId: ex.sessionExerciseId,
      loadLb: loadValue,
      reps: repsValue,
      rir,
      isWarmup: warmup,
    })
    if (!id) return
    // Keep the load; move the rep target to the next set; RIR is never pre-filled.
    setReps(undefined)
    setRir(null)
    setWarmup(false)
    void restart.run({
      sessionId,
      sessionExerciseId: ex.sessionExerciseId,
      restMinSec: ex.restMinSec,
      restMaxSec: ex.restMaxSec,
    })
  }

  const editingSet = ex.sets.find((s) => s.id === editing) ?? null
  const notices = ex.suggestion.notices.map(noticeText).filter((t): t is string => t !== null)

  return (
    <Card className={`${styles.exercise} ${ex.done ? styles.done : ''}`}>
      <div className={styles.exerciseHeader}>
        <div>
          <h2 className={styles.exerciseTitle}>{ex.exerciseName}</h2>
          <div className={`${styles.muted} ${styles.small}`}>
            {formatRegime(ex.prescription, ex.prescription.sets)}
          </div>
        </div>
        <div>
          {ex.badge === 'set_load' ? <Badge tone="warn">Set load</Badge> : null}
          {ex.badge === 'recalibrate' ? <Badge tone="warn">Recalibrate</Badge> : null}
          {ex.done ? <Badge tone="good">Done</Badge> : null}
        </div>
      </div>

      <p className={styles.why}>
        {ex.suggestion.loadLb !== null ? (
          <span className={styles.load}>
            {formatLoad(ex.suggestion.loadLb, ex, unit)} × {ex.suggestion.repTargets.join(', ')}
            {' · '}
          </span>
        ) : null}
        {ex.adHoc
          ? 'Added to this workout (not part of progression).'
          : suggestionWhy(ex.suggestion, `${formatMass(ex.prescription.stepLb, unit)} ${unit}`)}
      </p>
      {notices.map((n) => (
        <p key={n} className={styles.why}>
          {n}
        </p>
      ))}
      {ex.lastTime ? (
        <p className={styles.why}>
          Last time ({formatDate(ex.lastTime.date)}): {formatSets(ex.lastTime.sets, ex, unit)}
        </p>
      ) : null}

      {ex.sets.length > 0 ? (
        <ol className={styles.sets}>
          {ex.sets.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={styles.setRow}
                onClick={() => setEditing(s.id)}
                aria-label={`Edit set ${s.setIndex + 1}`}
              >
                <span className={styles.setIndex}>{s.isWarmup ? 'W' : s.setIndex + 1}</span>
                <span>
                  {formatLoad(s.loadLb, ex, unit)} × {s.reps}
                  {s.rir !== null ? ` · RIR ${s.rir}` : ''}
                </span>
                <span className={styles.muted}>{s.edited ? 'edited' : ''}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <div className={styles.entry}>
        <div>
          <MassInput
            label={`${ex.exerciseName} load`}
            valueLb={loadValue}
            onChangeLb={setLoad}
            unit={unit}
            stepLb={ex.prescription.stepLb}
            allowNegative={ex.loadType === 'bodyweight_plus'}
          />
        </div>
        <div>
          <NumberStepper
            label={`${ex.exerciseName} reps`}
            value={repsValue}
            onChange={setReps}
            step={1}
            min={0}
            decimals={0}
          />
        </div>
        <div className={styles.entryWide}>
          <RirChips value={rir} onChange={setRir} label={`${ex.exerciseName} RIR`} />
        </div>
        <div className={styles.entryActions}>
          <Toggle label="Warm-up" checked={warmup} onChange={setWarmup} />
          <Button
            variant="primary"
            disabled={loadValue == null || repsValue == null || log.pending}
            onClick={() => void onLog()}
          >
            Log {warmup ? 'warm-up' : `set ${nextIndex + 1}`}
          </Button>
        </div>
      </div>

      {working.length === 0 ? (
        <div className={styles.row} style={{ marginTop: 'var(--space-2)' }}>
          <Button variant="ghost" icon="swap" onClick={onSwap}>
            Swap
          </Button>
          <Button variant="ghost" icon="x" onClick={() => void drop.run(ex.sessionExerciseId)}>
            Remove
          </Button>
        </div>
      ) : null}

      <SetEditor
        set={editingSet}
        exercise={ex}
        unit={unit}
        stepLb={ex.prescription.stepLb}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          if (editingSet) void update.run(editingSet.id, patch)
          setEditing(null)
        }}
        onDelete={() => {
          if (editingSet) void remove.run(editingSet.id)
          setEditing(null)
        }}
      />
    </Card>
  )
}
