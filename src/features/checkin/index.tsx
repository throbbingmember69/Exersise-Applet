import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCommand, useLive, useToday, useUnits } from '@/app/hooks'
import { lbToDisplay } from '@/domain/units'
import type { CheckIn } from '@/domain/types'
import { respondCheckIn, respondSwitchPrompt } from '@/services/nutrition/checkin'
import { getCheckInView } from '@/services/nutrition/queries'
import { formatDate, formatInt, formatKcal, formatSigned } from '@/ui/format'
import { Badge, Button, Card, EmptyState, Field, PageHeader, Stack, Stat } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import LineChart from '@/ui/LineChart'
import NumberStepper from '@/ui/NumberStepper'
import Spinner from '@/ui/Spinner'
import styles from '@/features/food/food.module.css'
import { useCheckInSync } from './useCheckInSync'

function pct(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function verdict(c: CheckIn): string {
  switch (c.suggestionType) {
    case 'none_first_week':
      return 'First week of the phase: water and glycogen shift the scale, so no change yet.'
    case 'none_insufficient':
      return 'Not enough weigh-ins to judge this week.'
    case 'none_in_band':
      return 'On track: the trend is inside your band.'
    case 'none_streak':
      return `Outside the band ${c.missDirection === 'high' ? '(too fast)' : '(too slow)'} — one more week before changing anything.`
    case 'kcal_change':
      return `Outside the band two weeks running ${c.missDirection === 'high' ? '(too fast)' : '(too slow)'}.`
  }
}

export default function CheckInScreen() {
  const today = useToday()
  const units = useUnits()
  const navigate = useNavigate()
  useCheckInSync(today)
  const { data: view } = useLive((ctx) => getCheckInView(ctx, { asOf: today }), [today])
  const respond = useCommand(respondCheckIn, { success: 'Check-in saved' })
  const answerPrompt = useCommand(respondSwitchPrompt)
  const [custom, setCustom] = useState<number | null>(null)

  if (!view) return <Spinner />
  if (!view.phase) {
    return (
      <>
        <PageHeader title="Weekly check-in" back="/food" />
        <EmptyState title="No active phase">
          Check-ins run weekly once a phase is set up.
        </EmptyState>
      </>
    )
  }

  const pending = view.pending
  const c = pending?.checkIn

  return (
    <>
      <PageHeader title="Weekly check-in" back="/food" />
      <Stack>
        {pending && c ? (
          <>
            <Card title={`Week ${c.phaseWeekIndex} · ${formatDate(c.dueDate)}`}>
              <div className={styles.stats}>
                <Stat
                  value={`${pct(c.trendRatePct)}/wk`}
                  label={`Band ${pct(c.bandMinPct)} to ${pct(c.bandMaxPct)}`}
                />
                <Stat
                  value={c.tdeeEstimate !== null ? formatKcal(c.tdeeEstimate) : '—'}
                  label={
                    c.tdeeSource === 'measured'
                      ? 'Measured maintenance'
                      : c.tdeeSource === 'formula'
                        ? 'Maintenance (formula)'
                        : 'Maintenance (last known)'
                  }
                />
              </div>
              <p className={styles.hint}>
                Logged: intake {formatInt(c.intakeLoggedPct)}% of days, weigh-ins{' '}
                {formatInt(c.weighInLoggedPct)}%
                {c.missStreak > 0
                  ? ` · ${c.missStreak} week${c.missStreak > 1 ? 's' : ''} outside the band`
                  : ''}
              </p>
              {pending.trend.length > 1 ? (
                <LineChart
                  label="Trend weight, last three weeks"
                  dates={pending.trend.map((p) => p.date)}
                  series={[
                    {
                      label: 'Weigh-ins',
                      tone: 'muted',
                      pointsOnly: true,
                      values: pending.trend.map((p) =>
                        p.interpolated ? null : lbToDisplay(p.weightLb, units),
                      ),
                    },
                    {
                      label: 'Trend',
                      values: pending.trend.map((p) => lbToDisplay(p.trendLb, units)),
                    },
                  ]}
                  height={160}
                  formatY={(v) => v.toFixed(1)}
                />
              ) : null}
            </Card>

            <Card title="Suggestion">
              <p>{verdict(c)}</p>
              {c.suggestionType === 'kcal_change' &&
              pending.proposedTarget &&
              pending.currentTarget ? (
                <>
                  <p className={styles.hint}>
                    {formatSigned(c.suggestedKcalChange)} kcal:{' '}
                    {formatKcal(pending.currentTarget.kcal)} →{' '}
                    <strong>{formatKcal(pending.proposedTarget.kcal)}</strong> from tomorrow
                    (protein stays at {formatInt(pending.proposedTarget.proteinG)} g).
                  </p>
                  <div className={kit.actions}>
                    <Button onClick={() => void respond.run(c.id, { action: 'skip' })}>Skip</Button>
                    <Button
                      variant="primary"
                      onClick={() => void respond.run(c.id, { action: 'accept' })}
                    >
                      Accept
                    </Button>
                  </div>
                  {c.stepsAlternative !== null ? (
                    <Button
                      block
                      onClick={() => void respond.run(c.id, { action: 'accept_steps' })}
                    >
                      Add {formatInt(c.stepsAlternative)} steps a day instead
                      {pending.stepsTarget !== null
                        ? ` (target ${formatInt(pending.stepsTarget)})`
                        : ''}
                    </Button>
                  ) : null}
                </>
              ) : null}
              <Field label="Or change by a custom amount (kcal/day)">
                <NumberStepper
                  label="Custom calorie change"
                  value={custom}
                  onChange={setCustom}
                  step={25}
                  decimals={0}
                />
              </Field>
              <div className={kit.actions}>
                <Button
                  disabled={custom === null || custom === 0}
                  onClick={() =>
                    void respond
                      .tryRun(c.id, { action: 'custom', kcalChange: custom! })
                      .then((ok) => ok && setCustom(null))
                  }
                >
                  Apply {custom !== null ? formatSigned(custom) : ''} kcal
                </Button>
                {c.suggestionType !== 'kcal_change' ? (
                  <Button
                    variant="primary"
                    onClick={() => void respond.run(c.id, { action: 'skip' })}
                  >
                    Done
                  </Button>
                ) : null}
              </div>
            </Card>

            {c.switchPrompt && c.switchResponse === null ? (
              <Card
                title={
                  c.switchPrompt.kind === 'end_bulk'
                    ? 'End the bulk?'
                    : c.switchPrompt.kind === 'end_cut'
                      ? 'End the cut?'
                      : 'Maintenance done'
                }
              >
                <p className={styles.hint} style={{ marginTop: 0 }}>
                  <Badge tone={c.switchPrompt.severity === 'firm' ? 'warn' : 'neutral'}>
                    {c.switchPrompt.severity === 'firm' ? 'Recommended' : 'Soon'}
                  </Badge>{' '}
                  {c.switchPrompt.reasons.map((r) => r.replace(/_/g, ' ')).join(', ')}
                </p>
                <div className={kit.actions}>
                  <Button onClick={() => void answerPrompt.run(c.id, 'dismissed')}>Not yet</Button>
                  <Button
                    variant="primary"
                    onClick={() =>
                      void answerPrompt
                        .tryRun(c.id, 'plan_next')
                        .then(
                          (ok) =>
                            ok && navigate(`/food/phase/new?type=${c.switchPrompt!.suggestedNext}`),
                        )
                    }
                  >
                    Plan next phase
                  </Button>
                </div>
              </Card>
            ) : null}
          </>
        ) : (
          <Card>
            <p className={styles.hint} style={{ marginTop: 0 }}>
              No check-in due. The next one is 7 days after the last.
            </p>
          </Card>
        )}

        {view.history.length > 0 ? (
          <Card title="History">
            <ul className={kit.linkList} style={{ border: 0 }}>
              {view.history.map((h) => (
                <li key={h.id} className={kit.linkRow}>
                  <span className={kit.linkRowText}>
                    <span>
                      Week {h.phaseWeekIndex} · {formatDate(h.dueDate)}
                    </span>
                    <span className={kit.linkRowHint}>
                      {pct(h.trendRatePct)}/wk ·{' '}
                      {h.status === 'accepted'
                        ? `${formatSigned(h.appliedKcalChange ?? 0)} kcal`
                        : h.status === 'accepted_steps'
                          ? 'more steps'
                          : h.status === 'skipped'
                            ? 'skipped'
                            : 'no answer'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </Stack>
    </>
  )
}
