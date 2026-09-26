import { useEffect, useState } from 'react'
import { useCommand, useCtx } from '@/app/hooks'
import { restView, type RestTimer } from '@/domain/restTimer'
import { clearRestTimer, extendRestTimer } from '@/services/training/restTimerState'
import { formatClock } from '@/ui/format'
import { Button } from '@/ui/kit'
import styles from './logger.module.css'

/** Sticky countdown to the minimum rest, then the maximum, with +N s and Skip. */
export default function RestTimerBar({
  timer,
  extendSec,
}: {
  timer: RestTimer
  extendSec: number
}) {
  const ctx = useCtx()
  const [now, setNow] = useState(() => ctx.now())
  useEffect(() => {
    const id = setInterval(() => setNow(ctx.now()), 250)
    return () => clearInterval(id)
  }, [ctx])
  const extend = useCommand(extendRestTimer)
  const skip = useCommand(clearRestTimer)
  const view = restView(timer, now)
  const label =
    view.stage === 'rest' ? 'Rest' : view.stage === 'min' ? 'Minimum rest done' : 'Rest over'
  // Counts down to the minimum rest, then to the maximum, then shows overtime (+m:ss).
  const clock = formatClock(view.stage === 'rest' ? view.msToMin : view.msToMax)
  return (
    <div className={styles.timerBar} data-stage={view.stage} role="timer" aria-live="off">
      <div className={styles.timerClock}>
        {clock}
        <span className={styles.timerLabel}>
          {label}
          {view.stage === 'min' ? ' · up to max' : ''}
        </span>
      </div>
      <Button onClick={() => void extend.run()} aria-label={`Add ${extendSec} seconds`}>
        +{extendSec}s
      </Button>
      <Button variant="ghost" onClick={() => void skip.run()}>
        Skip
      </Button>
    </div>
  )
}
