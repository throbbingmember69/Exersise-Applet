import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCommand, useLive } from '@/app/hooks'
import { createDay, updateMuscle } from '@/services/program/commands'
import { getGyms, getProgramOverview, type WeeklyMuscleView } from '@/services/program/queries'
import {
  Badge,
  Button,
  Card,
  Field,
  LinkList,
  LinkRow,
  PageHeader,
  Stack,
  Toggle,
  type Tone,
} from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import PromptSheet from '@/ui/PromptSheet'
import Sheet from '@/ui/Sheet'
import Spinner from '@/ui/Spinner'
import styles from './program.module.css'
import { WEEKDAYS } from './text'

const FLAG_TONE: Record<string, Tone> = { low: 'warn', high: 'bad', ok: 'good' }

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export default function Program() {
  const navigate = useNavigate()
  const { data: gyms } = useLive((ctx) => getGyms(ctx), [])
  const [gymId, setGymId] = useState<string | null>(null)
  const activeGyms = (gyms ?? []).filter((g) => !g.archived)
  const gym = gymId ?? activeGyms[0]?.gym.id ?? null
  const { data: overview } = useLive(
    (ctx) => (gym ? getProgramOverview(ctx, { gymId: gym }) : Promise.resolve(null)),
    [gym],
  )
  const [adding, setAdding] = useState(false)
  const [muscle, setMuscle] = useState<WeeklyMuscleView | null>(null)
  const add = useCommand(createDay)

  if (!gyms || overview === undefined) return <Spinner />

  return (
    <>
      <PageHeader title="Program" back="/more" />
      <Stack>
        {activeGyms.length > 1 ? (
          <div className={kit.chips} role="group" aria-label="Gym">
            {activeGyms.map((g) => (
              <button
                key={g.gym.id}
                type="button"
                className={kit.chip}
                aria-pressed={g.gym.id === gym}
                onClick={() => setGymId(g.gym.id)}
              >
                {g.gym.name}
              </button>
            ))}
          </div>
        ) : null}

        <LinkList>
          {(overview?.days ?? [])
            .filter((d) => !d.archived)
            .map((d) => (
              <LinkRow
                key={d.day.id}
                to={`/program/day/${d.day.id}${gym ? `?gym=${gym}` : ''}`}
                label={d.day.name}
                hint={`${d.day.weekday !== null ? WEEKDAYS[d.day.weekday] + ' · ' : ''}${d.slots.filter((s) => !s.archived).length} exercises · ${fmt(d.volume.totalSets)} sets`}
                trailing={
                  d.overSessionCap.length > 0 ? <Badge tone="warn">Over cap</Badge> : undefined
                }
              />
            ))}
        </LinkList>
        <Button block icon="plus" onClick={() => setAdding(true)}>
          Add day
        </Button>

        {overview ? (
          <Card title={`Planned per week · ${fmt(overview.weekly.totalSets)} sets`}>
            <p className={styles.hint}>
              Fractional sets per muscle at {overview.gym?.name}. Tap a muscle to change its band or
              mark it lagging.
            </p>
            <ul className={styles.muscles}>
              {overview.weekly.muscles.map((m) => (
                <li key={m.muscleId}>
                  <button type="button" className={styles.muscleRow} onClick={() => setMuscle(m)}>
                    <span>
                      {m.name}
                      {m.lagging ? (
                        <>
                          {' '}
                          <Badge tone="accent">Lagging</Badge>
                        </>
                      ) : null}
                    </span>
                    <span>
                      {fmt(m.sets)}{' '}
                      <span className={styles.hint}>
                        / {m.band.min}–{m.band.max}
                      </span>{' '}
                      {m.flag && m.flag !== 'ok' ? (
                        <Badge tone={FLAG_TONE[m.flag]}>{m.flag}</Badge>
                      ) : null}
                      {m.exemptLow ? <Badge>exempt</Badge> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <LinkList>
          <LinkRow to="/program/exercises" icon="train" label="Exercise library" />
          <LinkRow to="/program/gyms" icon="swap" label="Gyms" hint="Per-gym exercise swaps" />
        </LinkList>
      </Stack>

      <PromptSheet
        open={adding}
        title="New program day"
        label="Name"
        confirmLabel="Add"
        onClose={() => setAdding(false)}
        onSubmit={(name) =>
          void add.run(name, null).then((id) => {
            setAdding(false)
            if (id) navigate(`/program/day/${id}`)
          })
        }
      />
      <MuscleSheet muscle={muscle} onClose={() => setMuscle(null)} />
    </>
  )
}

function MuscleSheet({
  muscle,
  onClose,
}: {
  muscle: WeeklyMuscleView | null
  onClose: () => void
}) {
  return (
    <Sheet open={muscle !== null} title={muscle?.name ?? 'Muscle'} onClose={onClose}>
      {muscle ? <MuscleForm key={muscle.muscleId} muscle={muscle} onClose={onClose} /> : null}
    </Sheet>
  )
}

function MuscleForm({ muscle, onClose }: { muscle: WeeklyMuscleView; onClose: () => void }) {
  const [min, setMin] = useState<number | null>(muscle.band.min)
  const [max, setMax] = useState<number | null>(muscle.band.max)
  const [exempt, setExempt] = useState(muscle.exemptLow)
  const [lagging, setLagging] = useState(muscle.lagging)
  const save = useCommand(updateMuscle, { success: 'Saved' })
  return (
    <div className={kit.stack}>
      <div className={styles.twoCol}>
        <Field label="Low below (sets/week)">
          <NumberStepper
            label="Band minimum"
            value={min}
            onChange={setMin}
            step={1}
            min={0}
            decimals={1}
          />
        </Field>
        <Field label="High above">
          <NumberStepper
            label="Band maximum"
            value={max}
            onChange={setMax}
            step={1}
            min={1}
            decimals={1}
          />
        </Field>
      </div>
      <Toggle
        label="Never flag as low"
        hint="For muscles you keep low on purpose"
        checked={exempt}
        onChange={setExempt}
      />
      <Toggle
        label="Lagging"
        hint="On a bulk, you’ll be prompted to add a set every few weeks"
        checked={lagging}
        onChange={setLagging}
      />
      <div className={kit.actions}>
        <Button
          onClick={() =>
            void save
              .tryRun(muscle.muscleId, { bandMin: null, bandMax: null })
              .then((ok) => ok && onClose())
          }
        >
          Use default band
        </Button>
        <Button
          variant="primary"
          onClick={() =>
            void save
              .tryRun(muscle.muscleId, { bandMin: min, bandMax: max, exemptLow: exempt, lagging })
              .then((ok) => ok && onClose())
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}
