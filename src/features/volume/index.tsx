import { useState } from 'react'
import { useLive, useToday } from '@/app/hooks'
import { addDays } from '@/domain/dates'
import { getVolumeDashboard, type VolumeMuscleRow } from '@/services/training/queries'
import { formatDate, formatShortDate } from '@/ui/format'
import { Badge, Button, Card, PageHeader, Stack, type Tone } from '@/ui/kit'
import Spinner from '@/ui/Spinner'
import styles from './volume.module.css'

const FLAG_TONE: Record<string, Tone> = { low: 'warn', high: 'bad', ok: 'good' }

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** A muscle's sets against its band: logged bar, planned marker, shaded band. */
function BandBar({ row, mode }: { row: VolumeMuscleRow; mode: 'logged' | 'planned' }) {
  const value = mode === 'logged' ? row.logged : row.planned
  const scale = Math.max(row.bandMax * 1.25, value, row.planned, 1)
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`
  const flag = mode === 'logged' ? row.loggedFlag : row.plannedFlag
  return (
    <div className={styles.row}>
      <div className={styles.label}>
        <span>{row.name}</span>
        <span className={styles.value}>
          {fmt(value)}
          {mode === 'logged' ? <span className={styles.muted}> / {fmt(row.planned)}</span> : null}
          {flag && flag !== 'ok' ? (
            <>
              {' '}
              <Badge tone={FLAG_TONE[flag]}>{flag}</Badge>
            </>
          ) : null}
        </span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-label={`${row.name} sets`}
        aria-valuemin={0}
        aria-valuemax={scale}
        aria-valuenow={value}
      >
        <div
          className={styles.band}
          style={{
            left: pct(row.bandMin),
            width: `calc(${pct(row.bandMax)} - ${pct(row.bandMin)})`,
          }}
        />
        <div className={styles.fill} data-flag={flag ?? 'none'} style={{ width: pct(value) }} />
        {mode === 'logged' ? (
          <div className={styles.marker} style={{ left: pct(row.planned) }} />
        ) : null}
      </div>
    </div>
  )
}

export default function Volume() {
  const today = useToday()
  const [weekOf, setWeekOf] = useState(today)
  const [mode, setMode] = useState<'logged' | 'planned'>('logged')
  const { data: dash } = useLive(
    (ctx) => getVolumeDashboard(ctx, { weekOf, today }),
    [weekOf, today],
  )
  if (!dash) return <Spinner />
  const isCurrent = dash.week.end >= today

  return (
    <>
      <PageHeader title="Weekly volume" back="/train" />
      <Stack>
        <Card>
          <div className={styles.weekNav}>
            <Button
              icon="chevron-left"
              aria-label="Previous week"
              onClick={() => setWeekOf(addDays(dash.week.start, -7))}
            />
            <span>
              {formatShortDate(dash.week.start)} – {formatShortDate(dash.week.end)}
              {isCurrent ? ' · this week' : ''}
            </span>
            <Button
              icon="chevron-right"
              aria-label="Next week"
              disabled={isCurrent}
              onClick={() => setWeekOf(addDays(dash.week.start, 7))}
            />
          </div>
          <div className={styles.tabs} role="group" aria-label="Planned or logged">
            {(['logged', 'planned'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={styles.tab}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === 'logged'
                  ? `Logged (${fmt(dash.logged.totalSets)})`
                  : `Planned (${fmt(dash.planned.totalSets)})`}
              </button>
            ))}
          </div>
          <p className={styles.muted}>
            Fractional sets: 1 for the main muscle, 0.5 for assisting muscles. Shaded: your band
            (10–20 by default).
            {mode === 'logged' && !dash.week.complete
              ? ' “Low” flags wait until the week is over.'
              : ''}
            {dash.week.isDeloadWeek ? ' Deload week: no “low” flags.' : ''}
          </p>
          {dash.muscles.map((m) => (
            <BandBar key={m.muscleId} row={m} mode={mode} />
          ))}
        </Card>

        {dash.planned.capWarnings.length + dash.logged.capWarnings.length > 0 ? (
          <Card title={`Over ${dash.sessionCap} sets in one session`}>
            <p className={styles.muted}>
              Past ~{dash.sessionCap} sets for a muscle in one session, extra sets added no
              detectable growth. Consider moving sets to another day.
            </p>
            <ul className={styles.list}>
              {dash.planned.capWarnings.map((w) => (
                <li key={w.programDayId}>
                  Planned {w.dayName}: {w.muscles.map((m) => `${m.name} ${fmt(m.sets)}`).join(', ')}
                </li>
              ))}
              {dash.logged.capWarnings.map((w) => (
                <li key={w.sessionId}>
                  {formatDate(w.date)} {w.dayName}:{' '}
                  {w.muscles.map((m) => `${m.name} ${fmt(m.sets)}`).join(', ')}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </Stack>
    </>
  )
}
