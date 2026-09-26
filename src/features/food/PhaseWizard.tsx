import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useCommand, useLive, useToday, useUnits } from '@/app/hooks'
import { formatMassWithUnit, formatRatePerWeek } from '@/domain/units'
import type { PhaseType } from '@/domain/types'
import { proposePhase, startPhase } from '@/services/nutrition/phase'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { formatGrams, formatKcal } from '@/ui/format'
import { Badge, Button, Card, Field, PageHeader, Stack, Stat } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import Spinner from '@/ui/Spinner'
import styles from './food.module.css'

const TYPES: { type: PhaseType; name: string; hint: string }[] = [
  { type: 'bulk', name: 'Lean bulk', hint: 'Gain ~0.25–0.5% bodyweight a week' },
  { type: 'maintenance', name: 'Maintenance', hint: 'Hold weight, 2–4 weeks between phases' },
  { type: 'cut', name: 'Cut', hint: 'Lose ~0.5–0.75% bodyweight a week' },
]

const MAINTENANCE_SOURCE = {
  measured: 'measured from your logs',
  formula: 'estimated from your size (formula)',
  manual: 'entered',
} as const

export default function PhaseWizard() {
  const today = useToday()
  const units = useUnits()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialType = params.get('type') as PhaseType | null

  const [type, setType] = useState<PhaseType | null>(initialType)
  const [band, setBand] = useState<{ min: number; max: number } | null>(null)
  const [edits, setEdits] = useState<{ kcal?: number; proteinG?: number; fatPct?: number }>({})
  const [confirming, setConfirming] = useState(false)

  // First read (no type yet) tells us the suggested type.
  const { data: base } = useLive(
    (ctx) => proposePhase(ctx, { type: type ?? 'bulk', startDate: today }),
    [today, type],
  )
  const chosen = type ?? base?.suggestedType ?? 'bulk'
  const { data: view } = useLive(
    (ctx) =>
      proposePhase(ctx, {
        type: chosen,
        startDate: today,
        ...(band ? { rateMinPct: band.min, rateMaxPct: band.max } : {}),
      }),
    [today, chosen, band?.min, band?.max],
  )
  const start = useCommand(startPhase, { success: 'Phase started' })

  if (!view) return <Spinner />
  const p = view.proposal
  const kcal = edits.kcal ?? p.kcal
  const proteinG = edits.proteinG ?? p.proteinG
  const fatPct = edits.fatPct ?? p.fatPct
  const fatG = (kcal * fatPct) / 100 / 9
  const carbsG = (kcal - 4 * proteinG - 9 * fatG) / 4
  const bandNow = band ?? { min: p.band.minPct, max: p.band.maxPct }

  const onStart = async () => {
    const ok = await start.tryRun({
      type: chosen,
      startDate: today,
      kcal,
      proteinG,
      fatPct,
      rateMinPct: bandNow.min,
      rateMaxPct: bandNow.max,
      proposal: p,
      ...(view.previousPhase ? { endReason: `Started ${chosen}` } : {}),
    })
    if (ok) navigate('/food')
  }

  return (
    <>
      <PageHeader title="New phase" back="/food" />
      <Stack>
        <Card title="Phase">
          <div
            style={{ display: 'grid', gap: 'var(--space-2)' }}
            role="group"
            aria-label="Phase type"
          >
            {TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                className={styles.choice}
                aria-pressed={t.type === chosen}
                onClick={() => {
                  setType(t.type)
                  setBand(null)
                  setEdits({})
                }}
              >
                <span>
                  {t.name}{' '}
                  {t.type === view.suggestedType ? <Badge tone="accent">Suggested</Badge> : null}
                </span>
                <span className={styles.hint}>{t.hint}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Your starting point">
          <div className={styles.stats}>
            <Stat
              value={formatMassWithUnit(view.trendLb, units)}
              label={view.weightSource === 'trend' ? 'Trend weight' : 'Baseline weight'}
            />
            <Stat value={formatKcal(view.maintenance.kcal)} label="Maintenance" />
            <Stat value={view.bodyFat ? `${view.bodyFat.pct.toFixed(1)}%` : '—'} label="Body fat" />
          </div>
          <p className={styles.hint}>Maintenance {MAINTENANCE_SOURCE[view.maintenance.source]}.</p>
        </Card>

        <Card title="Rate">
          <div className={styles.twoCol}>
            <Field label="Min %/week">
              <NumberStepper
                label="Minimum rate"
                value={bandNow.min}
                step={0.05}
                decimals={2}
                onChange={(v) => v !== null && setBand({ ...bandNow, min: v })}
              />
            </Field>
            <Field label="Max %/week">
              <NumberStepper
                label="Maximum rate"
                value={bandNow.max}
                step={0.05}
                decimals={2}
                onChange={(v) => v !== null && setBand({ ...bandNow, max: v })}
              />
            </Field>
          </div>
          <p className={styles.hint}>
            Aiming for {formatRatePerWeek(p.targetRatePct, view.trendLb, units)} (
            {p.targetRatePct >= 0 ? '+' : ''}
            {p.targetRatePct.toFixed(2)}%/week).
          </p>
        </Card>

        <Card title="Daily targets">
          <div className={kit.stack}>
            <Field
              label="Calories (kcal)"
              hint={`${p.impliedSurplusPct >= 0 ? '+' : ''}${p.impliedSurplusPct.toFixed(0)}% vs maintenance`}
            >
              <NumberStepper
                label="Calories"
                value={kcal}
                step={50}
                min={1000}
                decimals={0}
                onChange={(v) => v !== null && setEdits((e) => ({ ...e, kcal: v }))}
              />
            </Field>
            <Field
              label="Protein (g)"
              hint={`${p.proteinGPerKg} g per kg ${p.proteinBasis === 'leanMass' ? 'lean mass' : 'bodyweight'}`}
            >
              <NumberStepper
                label="Protein"
                value={proteinG}
                step={5}
                min={0}
                decimals={0}
                onChange={(v) => v !== null && setEdits((e) => ({ ...e, proteinG: v }))}
              />
            </Field>
            <Field label="Fat (% of calories)">
              <NumberStepper
                label="Fat percent"
                value={fatPct}
                step={1}
                min={10}
                max={45}
                decimals={0}
                onChange={(v) => v !== null && setEdits((e) => ({ ...e, fatPct: v }))}
              />
            </Field>
            <p className={styles.hint}>
              Fat {formatGrams(fatG)} · carbs {formatGrams(carbsG)}
            </p>
            {p.warnings.includes('surplus_high') ? (
              <p>
                <Badge tone="warn">Large surplus</Badge> Beyond ~15% mostly adds fat.
              </p>
            ) : null}
            {carbsG < 0 ? (
              <p>
                <Badge tone="bad">Doesn’t add up</Badge> Protein and fat exceed the calories.
              </p>
            ) : null}
          </div>
        </Card>

        <Button
          variant="primary"
          block
          disabled={carbsG < 0 || start.pending}
          onClick={() => setConfirming(true)}
        >
          Start {TYPES.find((t) => t.type === chosen)?.name.toLowerCase()} today
        </Button>
      </Stack>

      <ConfirmDialog
        open={confirming}
        title="Start this phase?"
        confirmLabel="Start"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void onStart()
        }}
      >
        {view.previousPhase ? 'Your current phase ends yesterday. ' : ''}
        Targets: {formatKcal(kcal)}, {formatGrams(proteinG)} protein. Weekly check-ins adjust
        calories if your trend leaves the band two weeks running.
      </ConfirmDialog>
    </>
  )
}
