import { useState } from 'react'
import { useCommand, useLive, useToday } from '@/app/hooks'
import { endPhase, setManualTarget } from '@/services/nutrition/phase'
import {
  getCheckInView,
  getPhaseHistory,
  getPhaseView,
  getTodayNutrition,
} from '@/services/nutrition/queries'
import { useCheckInSync } from '@/features/checkin/useCheckInSync'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { formatDate, formatGrams, formatKcal } from '@/ui/format'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  LinkList,
  LinkRow,
  PageHeader,
  Stack,
  Stat,
} from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import Sheet from '@/ui/Sheet'
import Spinner from '@/ui/Spinner'
import IntakeCard from './IntakeCard'
import styles from './food.module.css'

const PHASE_NAME = { bulk: 'Lean bulk', maintenance: 'Maintenance', cut: 'Cut' } as const

export default function Food() {
  const today = useToday()
  useCheckInSync(today)
  const { data: food } = useLive((ctx) => getTodayNutrition(ctx, { date: today }), [today])
  const { data: phase } = useLive((ctx) => getPhaseView(ctx, { asOf: today }), [today])
  const { data: checkIns } = useLive((ctx) => getCheckInView(ctx, { asOf: today }), [today])
  const { data: history } = useLive((ctx) => getPhaseHistory(ctx), [])
  const [editingTarget, setEditingTarget] = useState(false)
  const [ending, setEnding] = useState(false)
  const end = useCommand(endPhase, { success: 'Phase ended' })

  if (!food || !phase) return <Spinner />

  return (
    <>
      <PageHeader title="Food" />
      <Stack>
        {phase.phase && food.target ? (
          <Card title={`${PHASE_NAME[phase.phase.type]} · week ${phase.weekIndex ?? 1}`}>
            <p className={styles.hint} style={{ marginTop: 0 }}>
              Since {formatDate(phase.phase.startDate)} · planned {phase.plannedWeeks} weeks, max{' '}
              {phase.maxWeeks}
            </p>
            <div className={styles.stats} style={{ marginTop: 'var(--space-3)' }}>
              <Stat value={formatKcal(food.target.kcal)} label="Daily target" />
              <Stat
                value={formatKcal(food.remaining?.kcal ?? food.target.kcal)}
                label="Left today"
              />
            </div>
            <div className={styles.macros}>
              <Stat value={formatGrams(food.target.proteinG)} label="Protein" />
              <Stat value={formatGrams(food.target.carbsG)} label="Carbs" />
              <Stat value={formatGrams(food.target.fatG)} label="Fat" />
              <Stat value={formatGrams(food.perMealProteinG ?? 0)} label="Protein/meal" />
            </div>
            {food.macroMismatch ? (
              <p className={styles.hint}>
                <Badge tone="warn">Check your log</Badge> Logged macros don’t add up to the logged
                calories (±10%).
              </p>
            ) : null}
            {phase.maintenance.current ? (
              <p className={styles.hint}>
                Maintenance {formatKcal(phase.maintenance.current.kcal)} (
                {phase.maintenance.current.source === 'measured'
                  ? 'measured from your logs'
                  : phase.maintenance.current.source === 'formula'
                    ? 'formula estimate until 2–3 weeks are logged'
                    : 'not enough data this week'}
                )
              </p>
            ) : null}
            <div className={kit.actions}>
              <Button onClick={() => setEditingTarget(true)}>Change target</Button>
              <Button variant="danger" onClick={() => setEnding(true)}>
                End phase
              </Button>
            </div>
          </Card>
        ) : (
          <EmptyState
            title="No phase yet"
            action={
              <ButtonLink to="/food/phase/new?type=bulk" variant="primary">
                Set up a lean bulk
              </ButtonLink>
            }
          >
            A phase gives you daily calorie and protein targets, adjusted weekly from your trend.
          </EmptyState>
        )}

        {phase.prompt ? (
          <LinkList>
            <LinkRow
              to={`/food/phase/new?type=${phase.suggestedNextType}`}
              icon="warning"
              label={`Plan your ${PHASE_NAME[phase.suggestedNextType].toLowerCase()}`}
              hint={phase.prompt.reasons.map((r) => r.replace(/_/g, ' ')).join(', ')}
              trailing={
                <Badge tone={phase.prompt.severity === 'firm' ? 'warn' : 'neutral'}>
                  {phase.prompt.severity === 'firm' ? 'Recommended' : 'Soon'}
                </Badge>
              }
            />
          </LinkList>
        ) : null}

        {checkIns?.phase ? (
          <LinkList>
            <LinkRow
              to="/food/checkin"
              icon="info"
              label="Weekly check-in"
              hint={
                checkIns.pending
                  ? `Week ${checkIns.pending.checkIn.phaseWeekIndex} is ready`
                  : 'History and trend'
              }
              trailing={checkIns.pending ? <Badge tone="accent">Due</Badge> : undefined}
            />
          </LinkList>
        ) : null}

        {phase.phase ? <IntakeCard date={today} entry={food.intake} /> : null}

        <LinkList>
          <LinkRow
            to="/settings/data"
            icon="upload"
            label="Import from Cronometer"
            hint="Fill in days from a Cronometer CSV export"
          />
        </LinkList>

        {history && history.length > 0 ? (
          <Card title="Phases">
            <ul className={kit.linkList} style={{ border: 0 }}>
              {history.map((h) => (
                <li key={h.phase.id} className={kit.linkRow}>
                  <span className={kit.linkRowText}>
                    <span>
                      {PHASE_NAME[h.phase.type]}{' '}
                      {h.phase.status === 'active' ? <Badge tone="accent">Active</Badge> : null}
                    </span>
                    <span className={kit.linkRowHint}>
                      {formatDate(h.phase.startDate)}
                      {h.phase.endDate ? ` – ${formatDate(h.phase.endDate)}` : ''}
                      {h.lengthWeeks !== null ? ` · ${h.lengthWeeks} weeks` : ''}
                      {h.latestTarget ? ` · ${formatKcal(h.latestTarget.kcal)}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <ButtonLink to={`/food/phase/new?type=${phase.suggestedNextType}`} block>
              Start a new phase
            </ButtonLink>
          </Card>
        ) : null}
      </Stack>

      {food.target ? (
        <TargetSheet
          open={editingTarget}
          onClose={() => setEditingTarget(false)}
          kcal={food.target.kcal}
          proteinG={food.target.proteinG}
          fatPct={food.target.fatPct}
        />
      ) : null}
      <ConfirmDialog
        open={ending}
        title="End this phase today?"
        danger
        confirmLabel="End phase"
        onCancel={() => setEnding(false)}
        onConfirm={() => {
          setEnding(false)
          void end.run({ date: today, reason: 'Ended by user' })
        }}
      >
        Targets and check-ins stop until you start the next phase.
      </ConfirmDialog>
    </>
  )
}

function TargetSheet({
  open,
  onClose,
  kcal: kcal0,
  proteinG: protein0,
  fatPct: fat0,
}: {
  open: boolean
  onClose: () => void
  kcal: number
  proteinG: number
  fatPct: number
}) {
  const today = useToday()
  const [kcal, setKcal] = useState<number | null>(kcal0)
  const [proteinG, setProtein] = useState<number | null>(protein0)
  const [fatPct, setFat] = useState<number | null>(fat0)
  const save = useCommand(setManualTarget, { success: 'Target changed' })
  return (
    <Sheet open={open} title="Change target" onClose={onClose}>
      <div className={kit.stack}>
        <p className={styles.hint} style={{ marginTop: 0 }}>
          Applies from today. It also restarts the check-in’s two-week miss count.
        </p>
        <Field label="Calories (kcal)">
          <NumberStepper
            label="Calories"
            value={kcal}
            onChange={setKcal}
            step={50}
            min={1000}
            decimals={0}
          />
        </Field>
        <Field label="Protein (g)">
          <NumberStepper
            label="Protein"
            value={proteinG}
            onChange={setProtein}
            step={5}
            min={0}
            decimals={0}
          />
        </Field>
        <Field label="Fat (% of calories)">
          <NumberStepper
            label="Fat percent"
            value={fatPct}
            onChange={setFat}
            step={1}
            min={10}
            max={45}
            decimals={0}
          />
        </Field>
        <div className={kit.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={kcal === null || proteinG === null || fatPct === null}
            onClick={() =>
              void save
                .tryRun({ effectiveDate: today, kcal: kcal!, proteinG: proteinG!, fatPct: fatPct! })
                .then((ok) => ok && onClose())
            }
          >
            Save
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
