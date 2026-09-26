import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useCommand, useLive, useUnits } from '@/app/hooks'
import type { Exercise, LoadType, MuscleWeight, Regime } from '@/domain/types'
import { formatMassWithUnit } from '@/domain/units'
import {
  archiveExercise,
  createExercise,
  defaultEquipmentSpecific,
  defaultPerHand,
  restoreExercise,
  setTrackStart,
  updateExercise,
} from '@/services/program/commands'
import { getExerciseDetail, getMuscles, type TrackStartView } from '@/services/program/queries'
import { formatDate } from '@/ui/format'
import { Badge, Button, Card, EmptyState, Field, PageHeader, Stack, Toggle } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import MassInput from '@/ui/MassInput'
import NumberStepper from '@/ui/NumberStepper'
import Sheet from '@/ui/Sheet'
import Spinner from '@/ui/Spinner'
import styles from './program.module.css'

const LOAD_TYPES: { type: LoadType; label: string }[] = [
  { type: 'barbell', label: 'Barbell' },
  { type: 'dumbbell', label: 'Dumbbell' },
  { type: 'machine', label: 'Machine' },
  { type: 'cable', label: 'Cable' },
  { type: 'bodyweight_plus', label: 'Bodyweight +' },
]

const DEFAULT_REGIME: Regime = {
  sets: 3,
  repMin: 8,
  repMax: 12,
  rirMin: 1,
  rirMax: 2,
  restMinSec: 90,
  restMaxSec: 120,
}

type Draft = Omit<Exercise, 'id' | 'archivedAt' | 'createdAt' | 'updatedAt'>

function blankDraft(): Draft {
  return {
    name: '',
    loadType: 'machine',
    equipmentSpecific: true,
    unilateral: false,
    perHand: false,
    stepLb: 5,
    defaultRegime: DEFAULT_REGIME,
    muscleWeights: {},
    isMainLift: false,
    isFinisher: false,
    notes: '',
  }
}

export default function ExerciseEditor() {
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const { data: detail } = useLive(
    (ctx) => (isNew ? Promise.resolve(null) : getExerciseDetail(ctx, id)),
    [id, isNew],
  )
  if (!isNew && detail === undefined) return <Spinner />
  if (!isNew && detail === null) {
    return (
      <>
        <PageHeader title="Exercise" back="/program/exercises" />
        <EmptyState title="Exercise not found" />
      </>
    )
  }
  const initial: Draft = detail ? { ...detail.exercise } : blankDraft()
  return <Editor key={id} id={isNew ? null : id} initial={initial} detail={detail ?? null} />
}

function Editor({
  id,
  initial,
  detail,
}: {
  id: string | null
  initial: Draft
  detail: Awaited<ReturnType<typeof getExerciseDetail>>
}) {
  const navigate = useNavigate()
  const units = useUnits()
  const { data: muscles } = useLive((ctx) => getMuscles(ctx), [])
  const [d, setD] = useState<Draft>(initial)
  const [track, setTrack] = useState<TrackStartView | null>(null)
  const create = useCommand(createExercise, { success: 'Exercise created' })
  const update = useCommand(updateExercise, { success: 'Saved' })
  const archive = useCommand(archiveExercise, { success: 'Archived' })
  const restore = useCommand(restoreExercise)

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setWeight = (muscleId: string, w: MuscleWeight | null) =>
    setD((x) => {
      const next = { ...x.muscleWeights } as Record<string, MuscleWeight>
      if (w === null) delete next[muscleId]
      else next[muscleId] = w
      return { ...x, muscleWeights: next }
    })
  const regimeNum = (k: keyof Regime, label: string, step: number, min: number, max: number) => (
    <Field label={label}>
      <NumberStepper
        label={label}
        value={d.defaultRegime[k]}
        onChange={(v) => v !== null && set('defaultRegime', { ...d.defaultRegime, [k]: v })}
        step={step}
        min={min}
        max={max}
        decimals={0}
      />
    </Field>
  )

  const onSave = async () => {
    const input = {
      name: d.name,
      loadType: d.loadType,
      stepLb: d.stepLb,
      defaultRegime: d.defaultRegime,
      muscleWeights: d.muscleWeights,
      equipmentSpecific: d.equipmentSpecific,
      perHand: d.perHand,
      unilateral: d.unilateral,
      isMainLift: d.isMainLift,
      isFinisher: d.isFinisher,
      notes: d.notes,
    }
    if (id === null) {
      const newId = await create.run(input)
      if (newId) navigate(`/program/exercises/${newId}`, { replace: true })
    } else {
      await update.run(id, input)
    }
  }

  return (
    <>
      <PageHeader title={id === null ? 'New exercise' : initial.name} back="/program/exercises" />
      <Stack>
        {detail?.archived ? (
          <Card>
            <p>
              <Badge>Archived</Badge> Hidden from pickers; its history is kept.
            </p>
            <Button block onClick={() => void restore.run(id!)}>
              Restore
            </Button>
          </Card>
        ) : null}
        <Card>
          <div className={kit.stack}>
            <Field label="Name" htmlFor="ex-name">
              <input
                id="ex-name"
                className={kit.input}
                value={d.name}
                maxLength={80}
                onChange={(e) => set('name', e.target.value)}
              />
            </Field>
            <Field label="Load type">
              <div className={kit.chips} role="group" aria-label="Load type">
                {LOAD_TYPES.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    className={kit.chip}
                    aria-pressed={d.loadType === t.type}
                    onClick={() =>
                      setD((x) => ({
                        ...x,
                        loadType: t.type,
                        equipmentSpecific: defaultEquipmentSpecific(t.type),
                        perHand: defaultPerHand(t.type),
                      }))
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label={`Progression step (${units})`}
              hint="Added once every set reaches the top of the range"
            >
              <MassInput
                label="Step"
                valueLb={d.stepLb}
                onChangeLb={(v) => v !== null && set('stepLb', v)}
                unit={units}
                stepLb={2.5}
              />
            </Field>
            <Toggle
              label="Loads differ between gyms"
              hint="Machine and cable stacks: separate loads per gym"
              checked={d.equipmentSpecific}
              onChange={(v) => set('equipmentSpecific', v)}
            />
            <Toggle
              label="Load is per hand"
              checked={d.perHand}
              onChange={(v) => set('perHand', v)}
            />
            <Toggle
              label="One side at a time"
              hint="Log the weaker side’s reps"
              checked={d.unilateral}
              onChange={(v) => set('unilateral', v)}
            />
            <Toggle
              label="Main lift"
              hint="Used for the cut’s strength check"
              checked={d.isMainLift}
              onChange={(v) => set('isMainLift', v)}
            />
            <Toggle
              label="Finisher"
              hint="Logged and counted for volume, no progression"
              checked={d.isFinisher}
              onChange={(v) => set('isFinisher', v)}
            />
          </div>
        </Card>

        <Card title="Muscles">
          <p className={styles.hint}>1 = the muscle it mainly trains, ½ = an assisting muscle.</p>
          <div className={styles.weights}>
            {(muscles ?? [])
              .filter((m) => !m.archived)
              .map((m) => {
                const w = d.muscleWeights[m.muscle.id] ?? null
                return (
                  <FragmentRow key={m.muscle.id} name={m.muscle.name}>
                    <div className={kit.chips} role="group" aria-label={`${m.muscle.name} weight`}>
                      {([null, 0.5, 1] as const).map((v) => (
                        <button
                          key={String(v)}
                          type="button"
                          className={kit.chip}
                          aria-pressed={w === v}
                          onClick={() => setWeight(m.muscle.id, v)}
                        >
                          {v === null ? '–' : v === 0.5 ? '½' : '1'}
                        </button>
                      ))}
                    </div>
                  </FragmentRow>
                )
              })}
          </div>
        </Card>

        <Card title="Default sets and reps">
          <p className={styles.hint}>Used when you add this exercise to a day or a workout.</p>
          <div className={styles.twoCol}>
            {regimeNum('sets', 'Sets', 1, 1, 10)}
            <span />
            {regimeNum('repMin', 'Reps from', 1, 1, 50)}
            {regimeNum('repMax', 'Reps to', 1, 1, 50)}
            {regimeNum('rirMin', 'RIR from', 1, 0, 5)}
            {regimeNum('rirMax', 'RIR to', 1, 0, 5)}
            {regimeNum('restMinSec', 'Rest min (s)', 15, 0, 900)}
            {regimeNum('restMaxSec', 'Rest max (s)', 15, 0, 900)}
          </div>
        </Card>

        <Button variant="primary" block disabled={!d.name.trim()} onClick={() => void onSave()}>
          {id === null ? 'Create exercise' : 'Save'}
        </Button>

        {detail ? (
          <>
            <Card title="Starting loads">
              <p className={styles.hint}>
                Where each program day starts before there’s history.{' '}
                {detail.loggedSessionCount > 0
                  ? `Logged in ${detail.loggedSessionCount} sessions${detail.lastLoggedOn ? `, last ${formatDate(detail.lastLoggedOn)}` : ''}.`
                  : ''}
              </p>
              {detail.trackStarts.length === 0 ? (
                <p className={styles.hint}>Not in the program.</p>
              ) : null}
              {detail.trackStarts.map((t) => (
                <div key={t.trackKey} className={styles.slot}>
                  <span className={styles.slotMain}>
                    {t.dayName}
                    {t.gymName ? <span className={styles.hint}> · {t.gymName}</span> : null}
                    <div className={styles.hint}>
                      {t.startLoadLb === null
                        ? 'Find a load (calibration)'
                        : formatMassWithUnit(t.startLoadLb, units)}
                      {t.calibrate && t.startLoadLb !== null ? ' · recalibrate' : ''}
                    </div>
                  </span>
                  {t.editable ? (
                    <Button variant="ghost" onClick={() => setTrack(t)}>
                      Edit
                    </Button>
                  ) : (
                    <Badge>{t.lockedBy === 'history' ? 'Has history' : 'In use'}</Badge>
                  )}
                </div>
              ))}
            </Card>
            {!detail.archived ? (
              <Button variant="danger" block onClick={() => void archive.run(id!)}>
                Archive exercise
              </Button>
            ) : null}
          </>
        ) : null}
      </Stack>
      <TrackSheet track={track} exerciseId={id} onClose={() => setTrack(null)} />
    </>
  )
}

function FragmentRow({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <>
      <span>{name}</span>
      {children}
    </>
  )
}

function TrackSheet({
  track,
  exerciseId,
  onClose,
}: {
  track: TrackStartView | null
  exerciseId: string | null
  onClose: () => void
}) {
  return (
    <Sheet
      open={track !== null}
      title={track ? `Start at ${track.dayName}` : 'Start'}
      onClose={onClose}
    >
      {track && exerciseId ? (
        <TrackForm key={track.trackKey} track={track} exerciseId={exerciseId} onClose={onClose} />
      ) : null}
    </Sheet>
  )
}

function TrackForm({
  track,
  exerciseId,
  onClose,
}: {
  track: TrackStartView
  exerciseId: string
  onClose: () => void
}) {
  const units = useUnits()
  const [load, setLoad] = useState<number | null>(track.startLoadLb)
  const [calibrate, setCalibrate] = useState(track.calibrate)
  const save = useCommand(setTrackStart, { success: 'Starting load saved' })
  return (
    <div className={kit.stack}>
      <Field label={`Starting load (${units})`} hint="Leave empty to find it in the first session">
        <MassInput
          label="Starting load"
          valueLb={load}
          onChangeLb={setLoad}
          unit={units}
          stepLb={5}
          allowNegative
        />
      </Field>
      <Toggle
        label="First session is calibration"
        hint="Its last working load becomes the base"
        checked={calibrate || load === null}
        onChange={setCalibrate}
      />
      <div className={kit.actions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() =>
            void save
              .tryRun(track.dayId, exerciseId, track.scope, {
                startLoadLb: load,
                calibrate: calibrate || load === null,
              })
              .then((ok) => ok && onClose())
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}
