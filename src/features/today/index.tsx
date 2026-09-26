import { useLive, useToday, useUnits } from '@/app/hooks'
import { formatMassWithUnit } from '@/domain/units'
import { getBackupReminder } from '@/services/data/backup'
import { proposePhase } from '@/services/nutrition/phase'
import {
  getBodyView,
  getCheckInView,
  getPhaseView,
  getTodayNutrition,
} from '@/services/nutrition/queries'
import { getStartOptions, getTrainingAlerts } from '@/services/training/queries'
import { useCheckInSync } from '@/features/checkin/useCheckInSync'
import WeighInCard from '@/features/body/WeighInCard'
import IntakeCard from '@/features/food/IntakeCard'
import { deloadReasonText } from '@/features/logger/text'
import { formatDate, formatGrams, formatKcal } from '@/ui/format'
import { Badge, ButtonLink, Card, LinkList, LinkRow, PageHeader, Stack, Stat } from '@/ui/kit'
import Spinner from '@/ui/Spinner'
import styles from './today.module.css'

const PHASE_NAME = { bulk: 'Lean bulk', maintenance: 'Maintenance', cut: 'Cut' } as const

export default function Today() {
  const today = useToday()
  const units = useUnits()
  useCheckInSync(today)

  const { data: start } = useLive((ctx) => getStartOptions(ctx, { today }), [today])
  const { data: alerts } = useLive((ctx) => getTrainingAlerts(ctx, { asOf: today }), [today])
  const { data: food } = useLive((ctx) => getTodayNutrition(ctx, { date: today }), [today])
  const { data: body } = useLive((ctx) => getBodyView(ctx, { asOf: today, days: 14 }), [today])
  const { data: checkIns } = useLive((ctx) => getCheckInView(ctx, { asOf: today }), [today])
  const { data: phaseView } = useLive((ctx) => getPhaseView(ctx, { asOf: today }), [today])
  const { data: backup } = useLive((ctx) => getBackupReminder(ctx), [today])
  const { data: bulkProposal } = useLive(
    (ctx) =>
      phaseView && phaseView.phase === null
        ? proposePhase(ctx, { type: 'bulk', startDate: today })
        : Promise.resolve(null),
    [today, phaseView?.phase === null],
  )

  if (!start || !food || !body) return <Spinner />

  const doneToday = start.days.find((d) => d.lastDoneDate === today)
  const nextDay = start.days.find((d) => d.id === start.suggestedDayId)
  const todayWeight =
    body.entries.find((e) => e.date === today && e.source === 'user')?.weightLb ?? null

  return (
    <>
      <PageHeader title="Today" />
      <p className={styles.date}>{formatDate(today)}</p>
      <Stack>
        {/* ── Training ─────────────────────────────── */}
        {start.inProgressSessionId ? (
          <Card title="Workout in progress">
            <ButtonLink
              to={`/train/session/${start.inProgressSessionId}`}
              variant="primary"
              block
              icon="play"
            >
              Resume workout
            </ButtonLink>
          </Card>
        ) : (
          <Card
            title={
              doneToday
                ? `Trained today: ${doneToday.name}`
                : `Next up: ${nextDay?.name ?? 'Workout'}`
            }
          >
            {start.deload.active ? (
              <p className={styles.note}>
                <Badge tone="accent">Deload</Badge> {start.deload.remaining} of {start.deload.total}{' '}
                sessions left
              </p>
            ) : null}
            <ButtonLink
              to="/train/start"
              variant={doneToday ? 'default' : 'primary'}
              block
              icon="play"
            >
              {doneToday ? 'Start another workout' : 'Start workout'}
            </ButtonLink>
          </Card>
        )}

        {alerts && (alerts.deload.suggested || alerts.stalls.length > 0) ? (
          <Card title="Training flags">
            {alerts.deload.suggested ? (
              <p className={styles.note}>
                <Badge tone="warn">Deload suggested</Badge>{' '}
                {deloadReasonText(alerts.deload.reasons)}
              </p>
            ) : null}
            {alerts.stalls.length > 0 ? (
              <p className={styles.note}>
                <Badge tone="warn">Stalled</Badge> {alerts.stalls.map((s) => s.name).join(', ')}
              </p>
            ) : null}
            <LinkList>
              <LinkRow to="/train/progress" icon="chart" label="See progress" />
            </LinkList>
          </Card>
        ) : null}

        {/* ── Check-in and phase prompts ───────────── */}
        {checkIns?.pending ? (
          <LinkList>
            <LinkRow
              to="/food/checkin"
              icon="info"
              label={`Weekly check-in: week ${checkIns.pending.checkIn.phaseWeekIndex}`}
              hint={
                checkIns.pending.checkIn.suggestionType === 'kcal_change'
                  ? 'A calorie change is suggested'
                  : 'Review your trend'
              }
              trailing={<Badge tone="accent">Due</Badge>}
            />
          </LinkList>
        ) : null}
        {phaseView?.prompt ? (
          <LinkList>
            <LinkRow
              to="/food"
              icon="warning"
              label={
                phaseView.prompt.kind === 'end_bulk'
                  ? 'Time to end the bulk?'
                  : phaseView.prompt.kind === 'end_cut'
                    ? 'Time to end the cut?'
                    : 'Maintenance is done'
              }
              hint="Plan your next phase"
              trailing={
                <Badge tone={phaseView.prompt.severity === 'firm' ? 'warn' : 'neutral'}>
                  {phaseView.prompt.severity === 'firm' ? 'Recommended' : 'Soon'}
                </Badge>
              }
            />
          </LinkList>
        ) : null}

        {/* ── Nutrition ────────────────────────────── */}
        {food.phase && food.target ? (
          <Card title={`${PHASE_NAME[food.phase.type]} · week ${food.weekIndex ?? 1}`}>
            <div className={styles.stats}>
              <Stat
                value={formatKcal(food.remaining?.kcal ?? food.target.kcal)}
                label="kcal left"
              />
              <Stat
                value={formatGrams(food.remaining?.proteinG ?? food.target.proteinG)}
                label="protein left"
              />
            </div>
            <p className={styles.note}>
              Target {formatKcal(food.target.kcal)} · {formatGrams(food.target.proteinG)} protein (~
              {formatGrams(food.perMealProteinG ?? 0)} per meal over 4)
            </p>
          </Card>
        ) : (
          <Card title="Start your lean bulk">
            <p className={styles.note}>
              {bulkProposal
                ? `Suggested: ${formatKcal(bulkProposal.proposal.kcal)} and ${formatGrams(bulkProposal.proposal.proteinG)} protein a day, aiming for about +${bulkProposal.proposal.targetRatePct.toFixed(2)}% bodyweight a week.`
                : 'Set up a phase to get daily calorie and protein targets.'}
            </p>
            <ButtonLink to="/food/phase/new" variant="primary" block>
              Set up phase
            </ButtonLink>
          </Card>
        )}
        {food.phase ? <IntakeCard date={today} entry={food.intake} compact /> : null}

        {/* ── Body ─────────────────────────────────── */}
        <WeighInCard initialLb={body.latestWeight?.weightLb ?? null} loggedToday={todayWeight} />
        {body.currentTrend ? (
          <p className={styles.note}>
            Trend {formatMassWithUnit(body.currentTrend.trendLb, units)}
            {body.weeklyRatePct !== null
              ? ` · ${body.weeklyRatePct >= 0 ? '+' : ''}${body.weeklyRatePct.toFixed(2)}%/week`
              : ''}
          </p>
        ) : null}

        {backup?.due ? (
          <LinkList>
            <LinkRow
              to="/settings/data"
              icon="download"
              label="Back up your data"
              hint={
                backup.daysSince === null
                  ? 'No backup yet'
                  : `Last backup ${backup.daysSince} days ago`
              }
            />
          </LinkList>
        ) : null}
      </Stack>
    </>
  )
}
