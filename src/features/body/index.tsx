import { useMemo, useState } from 'react'
import { useCommand, useLive, useToday, useUnits } from '@/app/hooks'
import { formatMassWithUnit, lbToDisplay } from '@/domain/units'
import { restoreBodyEntry, saveScaleReading, voidBodyEntry } from '@/services/nutrition/body'
import { getBodyView } from '@/services/nutrition/queries'
import { formatDate } from '@/ui/format'
import { Badge, Button, Card, Field, PageHeader, Stack, Stat } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import LineChart from '@/ui/LineChart'
import MassInput from '@/ui/MassInput'
import NumberStepper from '@/ui/NumberStepper'
import Spinner from '@/ui/Spinner'
import WeighInCard from './WeighInCard'
import styles from './body.module.css'

const RANGES = [
  { days: 30, label: '30 d' },
  { days: 90, label: '90 d' },
  { days: 365, label: '1 y' },
] as const

export default function Body() {
  const today = useToday()
  const units = useUnits()
  const [days, setDays] = useState<number>(30)
  const { data: view } = useLive((ctx) => getBodyView(ctx, { asOf: today, days }), [today, days])

  const chart = useMemo(() => {
    if (!view || view.trend.length === 0) return null
    return {
      dates: view.trend.map((p) => p.date),
      series: [
        {
          label: 'Weigh-ins',
          tone: 'muted' as const,
          pointsOnly: true,
          values: view.trend.map((p) => (p.interpolated ? null : lbToDisplay(p.weightLb, units))),
        },
        {
          label: 'Trend',
          tone: 'accent' as const,
          values: view.trend.map((p) => lbToDisplay(p.trendLb, units)),
        },
      ],
    }
  }, [view, units])

  if (!view) return <Spinner />
  const todayEntry = view.entries.find((e) => e.date === today && e.source === 'user')
  const comp = view.bodyComposition

  return (
    <>
      <PageHeader title="Body" />
      <Stack>
        <WeighInCard
          initialLb={view.latestWeight?.weightLb ?? null}
          loggedToday={todayEntry?.weightLb ?? null}
        />

        <Card title="Trend">
          <div className={styles.stats}>
            <Stat
              value={view.currentTrend ? formatMassWithUnit(view.currentTrend.trendLb, units) : '—'}
              label="Trend weight"
            />
            <Stat
              value={view.sevenDayAvg !== null ? formatMassWithUnit(view.sevenDayAvg, units) : '—'}
              label="7-day average"
            />
            <Stat
              value={
                view.weeklyRatePct !== null
                  ? `${view.weeklyRatePct >= 0 ? '+' : ''}${view.weeklyRatePct.toFixed(2)}%`
                  : '—'
              }
              label="per week"
            />
          </div>
          <div className={kit.chips} role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                className={kit.chip}
                aria-pressed={days === r.days}
                onClick={() => setDays(r.days)}
              >
                {r.label}
              </button>
            ))}
          </div>
          {chart ? (
            <LineChart
              label={`Trend weight over the last ${days} days`}
              dates={chart.dates}
              series={chart.series}
              formatY={(v) => v.toFixed(1)}
            />
          ) : (
            <p className={styles.muted}>Log a few morning weigh-ins to see your trend.</p>
          )}
          {view.currentTrend?.stale ? (
            <p className={styles.muted}>No weigh-in today; the trend carries forward.</p>
          ) : null}
        </Card>

        {comp ? (
          <Card title="Body composition">
            <div className={styles.stats}>
              <Stat
                value={comp.smoothedBodyFat ? `${comp.smoothedBodyFat.pct.toFixed(1)}%` : '—'}
                label={
                  comp.smoothedBodyFat?.quality === 'single' ? 'Body fat (1 reading)' : 'Body fat'
                }
              />
              <Stat
                value={comp.leanMassLb !== null ? formatMassWithUnit(comp.leanMassLb, units) : '—'}
                label="Lean mass"
              />
              <Stat value={comp.ffmi !== null ? comp.ffmi.toFixed(1) : '—'} label="FFMI" />
              <Stat value={comp.bmi !== null ? comp.bmi.toFixed(1) : '—'} label="BMI" />
            </div>
            <p className={styles.muted}>
              Scale body fat can be off by several points; watch the multi-week trend.
            </p>
          </Card>
        ) : null}

        <ScaleReadingCard today={today} />

        <Card title="Entries">
          <ul className={styles.entries}>
            {view.entries.slice(0, 30).map((e) => (
              <EntryRow key={e.date} entry={e} voided={false} />
            ))}
            {view.voidedEntries.map((e) => (
              <EntryRow key={`v-${e.date}`} entry={e} voided />
            ))}
          </ul>
        </Card>
      </Stack>
    </>
  )
}

function EntryRow({
  entry,
  voided,
}: {
  entry: import('@/domain/types').BodyEntry
  voided: boolean
}) {
  const units = useUnits()
  const del = useCommand(voidBodyEntry)
  const restore = useCommand(restoreBodyEntry)
  return (
    <li className={styles.entry}>
      <span>
        {formatDate(entry.date)}
        {entry.source === 'seed' ? (
          <>
            {' '}
            <Badge>Baseline</Badge>
          </>
        ) : null}
        <span className={styles.muted}>
          {' '}
          {entry.weightLb !== null ? formatMassWithUnit(entry.weightLb, units) : ''}
          {entry.bodyFatPct !== null ? ` · ${entry.bodyFatPct}% BF` : ''}
        </span>
      </span>
      {voided ? (
        <Button variant="ghost" onClick={() => void restore.run(entry.date)}>
          Restore
        </Button>
      ) : entry.source === 'user' ? (
        <Button
          variant="ghost"
          aria-label={`Delete ${entry.date}`}
          onClick={() => void del.run(entry.date)}
        >
          Delete
        </Button>
      ) : null}
    </li>
  )
}

/** Weekly smart-scale readings (stored for trends; only body fat feeds calculations). */
function ScaleReadingCard({ today }: { today: import('@/domain/types').LocalDate }) {
  const units = useUnits()
  const [bf, setBf] = useState<number | null>(null)
  const [muscle, setMuscle] = useState<number | null>(null)
  const [skeletal, setSkeletal] = useState<number | null>(null)
  const [subcut, setSubcut] = useState<number | null>(null)
  const [visceral, setVisceral] = useState<number | null>(null)
  const save = useCommand(saveScaleReading, { success: 'Scale reading saved' })
  const any = [bf, muscle, skeletal, subcut, visceral].some((v) => v !== null)

  return (
    <Card title="Scale reading">
      <div className={kit.stack}>
        <Field label="Body fat (%)">
          <NumberStepper
            label="Body fat %"
            value={bf}
            onChange={setBf}
            step={0.1}
            min={2}
            max={70}
          />
        </Field>
        <Field label={`Muscle mass (${units})`}>
          <MassInput
            label="Muscle mass"
            valueLb={muscle}
            onChangeLb={setMuscle}
            unit={units}
            stepLb={0.5}
          />
        </Field>
        <Field label="Skeletal muscle (%)">
          <NumberStepper
            label="Skeletal muscle %"
            value={skeletal}
            onChange={setSkeletal}
            step={0.1}
            min={0}
            max={100}
          />
        </Field>
        <Field label="Subcutaneous fat (%)">
          <NumberStepper
            label="Subcutaneous fat %"
            value={subcut}
            onChange={setSubcut}
            step={0.1}
            min={0}
            max={100}
          />
        </Field>
        <Field label="Visceral fat rating">
          <NumberStepper
            label="Visceral rating"
            value={visceral}
            onChange={setVisceral}
            step={1}
            min={1}
            max={60}
            decimals={0}
          />
        </Field>
      </div>
      <div className={kit.actions}>
        <Button
          variant="primary"
          disabled={!any || save.pending}
          onClick={() =>
            void save
              .run({
                date: today,
                ...(bf !== null ? { bodyFatPct: bf } : {}),
                ...(muscle !== null ? { muscleMassLb: muscle } : {}),
                ...(skeletal !== null ? { skeletalMusclePct: skeletal } : {}),
                ...(subcut !== null ? { subcutFatPct: subcut } : {}),
                ...(visceral !== null ? { visceralRating: visceral } : {}),
              })
              .then((r) => {
                if (r?.status === 'saved') {
                  setBf(null)
                  setMuscle(null)
                  setSkeletal(null)
                  setSubcut(null)
                  setVisceral(null)
                }
              })
          }
        >
          Save reading
        </Button>
      </div>
    </Card>
  )
}
