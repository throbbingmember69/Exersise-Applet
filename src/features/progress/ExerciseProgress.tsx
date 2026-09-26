import { useState } from 'react'
import { useParams } from 'react-router'
import { useLive, useUnits } from '@/app/hooks'
import { formatMass, lbToDisplay } from '@/domain/units'
import { getExerciseProgress } from '@/services/training/queries'
import { formatDate, formatLoad } from '@/ui/format'
import { Badge, Card, EmptyState, PageHeader, Stack, Toggle } from '@/ui/kit'
import LineChart from '@/ui/LineChart'
import Spinner from '@/ui/Spinner'

export default function ExerciseProgress() {
  const { exerciseId = '' } = useParams()
  const units = useUnits()
  const [showTotal, setShowTotal] = useState(false)
  const { data: p } = useLive((ctx) => getExerciseProgress(ctx, exerciseId), [exerciseId])

  if (p === undefined) return <Spinner />
  if (p === null) {
    return (
      <>
        <PageHeader title="Progress" back="/train/progress" />
        <EmptyState title="Exercise not found" />
      </>
    )
  }

  return (
    <>
      <PageHeader title={p.name} back="/train/progress" />
      <Stack>
        {p.kind === 'repsAtLoad' ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            High-rep exercise: tracked as the best set’s load and reps (e1RM is unreliable above ~12
            reps).
          </p>
        ) : null}
        {p.isBodyweightPlus ? (
          <Toggle
            label="Show total load (bodyweight + added)"
            hint="Added-load equivalent by default"
            checked={showTotal}
            onChange={setShowTotal}
          />
        ) : null}
        {p.series.length === 0 ? <EmptyState title="No sessions yet" /> : null}
        {p.series.map((s) => {
          const values = s.points.map((pt) =>
            typeof pt.value === 'number'
              ? lbToDisplay(showTotal && pt.totalLb !== null ? pt.totalLb : pt.value, units)
              : lbToDisplay(pt.value.loadLb, units),
          )
          return (
            <Card
              key={s.scope}
              title={
                <>
                  {s.gymName ?? (p.series.length > 1 ? 'All gyms' : 'e1RM')}{' '}
                  {s.stall.stalled ? (
                    <Badge tone="warn">
                      Stalled since {s.stall.since ? formatDate(s.stall.since) : '—'}
                    </Badge>
                  ) : null}
                </>
              }
            >
              {s.points.length > 1 ? (
                <LineChart
                  label={`${p.name} ${p.kind === 'e1rm' ? 'estimated one-rep max' : 'best set load'} over time`}
                  dates={s.points.map((pt) => pt.date)}
                  series={[{ label: p.kind === 'e1rm' ? 'e1RM' : 'Load', values }]}
                  formatY={(v) => v.toFixed(0)}
                />
              ) : null}
              <ul style={{ listStyle: 'none', margin: 'var(--space-2) 0 0', padding: 0 }}>
                {[...s.points]
                  .reverse()
                  .slice(0, 8)
                  .map((pt) => (
                    <li
                      key={pt.sessionId}
                      style={{ display: 'flex', justifyContent: 'space-between', minHeight: 32 }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>{formatDate(pt.date)}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {typeof pt.value === 'number'
                          ? `${formatMass(showTotal && pt.totalLb !== null ? pt.totalLb : pt.value, units)} ${units}`
                          : `${formatLoad(pt.value.loadLb, p, units)} × ${pt.value.reps}`}
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          )
        })}
      </Stack>
    </>
  )
}
