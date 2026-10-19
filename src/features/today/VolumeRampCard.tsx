import { useCommand, useLive } from '@/app/hooks'
import type { LocalDate } from '@/domain/types'
import {
  acceptVolumeRamp,
  dismissVolumeRamp,
  getVolumeRamps,
  type VolumeRampView,
} from '@/services/training/ramp'
import { Badge, Button, Card } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import styles from './today.module.css'

const fmt = (n: number) => String(Math.round(n * 10) / 10)

/** On a bulk: "add a set" prompts for muscles marked lagging (every few weeks, one at a time). */
export default function VolumeRampCard({ today }: { today: LocalDate }) {
  const { data: ramps } = useLive((ctx) => getVolumeRamps(ctx, { today }), [today])
  const accept = useCommand(acceptVolumeRamp, { success: 'Set added to your program' })
  const dismiss = useCommand(dismissVolumeRamp)
  if (!ramps || ramps.length === 0) return null
  const input = (r: VolumeRampView) => ({
    muscleId: r.muscleId,
    slotId: r.slotId,
    fromSets: r.fromSets,
    dueDate: r.dueDate,
  })
  return (
    <Card title="Grow lagging muscles">
      {ramps.map((r) => (
        <div key={r.key} className={kit.stack} style={{ marginBottom: 'var(--space-3)' }}>
          <p className={styles.note} style={{ margin: 0 }}>
            <Badge tone="accent">{r.muscleName}</Badge> Add a set to{' '}
            <strong>{r.exerciseName}</strong> on {r.dayName}: {r.fromSets} → {r.toSets} sets. Weekly{' '}
            {fmt(r.plannedNow)} → {fmt(r.plannedAfter)} of {fmt(r.bandMax)}.
          </p>
          <div className={kit.actions}>
            <Button
              variant="ghost"
              disabled={dismiss.pending || accept.pending}
              onClick={() => void dismiss.run(input(r))}
            >
              Not now
            </Button>
            <Button
              variant="primary"
              disabled={dismiss.pending || accept.pending}
              onClick={() => void accept.run(input(r))}
            >
              Add set
            </Button>
          </div>
        </div>
      ))}
    </Card>
  )
}
