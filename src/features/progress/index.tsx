import { useLive, useToday, useUnits } from '@/app/hooks'
import { getProgressOverview, type MetricChange } from '@/services/training/queries'
import { Badge, ButtonLink, EmptyState, LinkList, LinkRow, PageHeader, Stack } from '@/ui/kit'
import Spinner from '@/ui/Spinner'
import { metricText } from './text'

function changeBadge(c: MetricChange | null) {
  if (!c) return null
  const tone = c.direction === 'up' ? 'good' : c.direction === 'down' ? 'bad' : 'neutral'
  const arrow = c.direction === 'up' ? '▲' : c.direction === 'down' ? '▼' : '–'
  const text =
    c.kind === 'e1rm'
      ? `${arrow} ${Math.abs(c.pct).toFixed(1)}%`
      : `${arrow} ${c.repsDelta >= 0 ? '+' : ''}${c.repsDelta} reps`
  return <Badge tone={tone}>{text}</Badge>
}

export default function Progress() {
  const today = useToday()
  const units = useUnits()
  const { data: items } = useLive((ctx) => getProgressOverview(ctx, { asOf: today }), [today])

  return (
    <>
      <PageHeader title="Progress" back="/train" />
      <Stack>
        {items === undefined ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState
            title="No lifts logged yet"
            action={<ButtonLink to="/train/start">Start workout</ButtonLink>}
          >
            Strength trends appear after your first sessions.
          </EmptyState>
        ) : (
          <LinkList>
            {items.map((i) => (
              <LinkRow
                key={`${i.exerciseId}|${i.scope}`}
                to={`/train/progress/${i.exerciseId}`}
                label={
                  <>
                    {i.name}
                    {i.gymName ? (
                      <span style={{ color: 'var(--text-muted)' }}> · {i.gymName}</span>
                    ) : null}
                  </>
                }
                hint={`${metricText(i.latest.value, i, units)} · best ${metricText(i.best.value, i, units)}`}
                trailing={
                  i.stalled ? <Badge tone="warn">Stalled</Badge> : changeBadge(i.changeVs4WeeksAgo)
                }
              />
            ))}
          </LinkList>
        )}
      </Stack>
    </>
  )
}
