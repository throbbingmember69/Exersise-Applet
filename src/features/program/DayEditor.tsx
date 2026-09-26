import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useCommand, useLive } from '@/app/hooks'
import type { Regime, Weekday } from '@/domain/types'
import {
  archiveDay,
  archiveSlot,
  createSlot,
  reorderSlots,
  restoreDay,
  restoreSlot,
  setGymSlotOverride,
  updateDay,
  updateSlot,
} from '@/services/program/commands'
import {
  getExerciseLibrary,
  getGyms,
  getProgramOverview,
  type ProgramSlotView,
} from '@/services/program/queries'
import ExercisePicker from '@/features/logger/ExercisePicker'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { formatRegime } from '@/ui/format'
import { Badge, Button, Card, EmptyState, Field, PageHeader, Stack } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'
import PromptSheet from '@/ui/PromptSheet'
import Sheet from '@/ui/Sheet'
import Spinner from '@/ui/Spinner'
import styles from './program.module.css'
import { WEEKDAYS } from './text'

export default function DayEditor() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const { data: gyms } = useLive((ctx) => getGyms(ctx), [])
  const gymId = params.get('gym') ?? gyms?.find((g) => !g.archived)?.gym.id ?? null
  const { data: overview } = useLive(
    (ctx) => (gymId ? getProgramOverview(ctx, { gymId }) : Promise.resolve(null)),
    [gymId],
  )
  const [renaming, setRenaming] = useState(false)
  const [editing, setEditing] = useState<ProgramSlotView | null>(null)
  const [adding, setAdding] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const rename = useCommand(updateDay)
  const reorder = useCommand(reorderSlots)
  const addSlot = useCommand(createSlot, { success: 'Exercise added' })
  const archive = useCommand(archiveDay)
  const restore = useCommand(restoreDay)
  const unarchiveSlot = useCommand(restoreSlot)
  const { data: library } = useLive((ctx) => getExerciseLibrary(ctx), [])

  if (!overview || !gyms) return <Spinner />
  const dayView = overview.days.find((d) => d.day.id === id)
  if (!dayView) {
    return (
      <>
        <PageHeader title="Day" back="/program" />
        <EmptyState title="Day not found" />
      </>
    )
  }
  const { day } = dayView
  const active = dayView.slots.filter((s) => !s.archived)
  const move = (index: number, delta: number) => {
    const ids = active.map((s) => s.slot.id)
    const [item] = ids.splice(index, 1)
    ids.splice(index + delta, 0, item!)
    void reorder.run(day.id, ids)
  }

  return (
    <>
      <PageHeader
        title={day.name}
        back="/program"
        actions={
          <Button
            variant="ghost"
            icon="edit"
            aria-label="Rename day"
            onClick={() => setRenaming(true)}
          />
        }
      />
      <Stack>
        {dayView.archived ? (
          <Card>
            <p>
              <Badge>Archived</Badge> Not offered when starting a workout.
            </p>
            <Button block onClick={() => void restore.run(day.id)}>
              Restore day
            </Button>
          </Card>
        ) : null}
        <Card title="Scheduled on">
          <div className={kit.chips} role="group" aria-label="Weekday">
            {WEEKDAYS.map((w, i) => (
              <button
                key={w}
                type="button"
                className={kit.chip}
                aria-pressed={day.weekday === i}
                onClick={() =>
                  void rename.run(day.id, { weekday: day.weekday === i ? null : (i as Weekday) })
                }
              >
                {w}
              </button>
            ))}
          </div>
        </Card>

        <Card title={`${active.length} exercises · ${dayView.volume.totalSets} sets`}>
          {dayView.overSessionCap.length > 0 ? (
            <p className={styles.hint}>
              <Badge tone="warn">Over {overview.sessionCap}</Badge>{' '}
              {dayView.overSessionCap.map((m) => `${m.name} ${m.sets}`).join(', ')} sets in one
              session
            </p>
          ) : null}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {active.map((s, i) => (
              <li
                key={s.slot.id}
                className={styles.slot}
                style={{ borderTop: i ? '1px solid var(--border)' : undefined }}
              >
                <button type="button" className={styles.slotMain} onClick={() => setEditing(s)}>
                  <div className={styles.slotName}>
                    {s.exercise?.name ?? 'Missing exercise'}{' '}
                    {s.isOverride ? <Badge>Gym swap</Badge> : null}
                  </div>
                  <div className={styles.hint}>{formatRegime(s.slot)}</div>
                </button>
                <div className={styles.order}>
                  <Button
                    variant="ghost"
                    icon="chevron-down"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    style={{ transform: 'rotate(180deg)' }}
                  />
                  <Button
                    variant="ghost"
                    icon="chevron-down"
                    aria-label="Move down"
                    disabled={i === active.length - 1}
                    onClick={() => move(i, 1)}
                  />
                </div>
              </li>
            ))}
          </ul>
          <Button block icon="plus" onClick={() => setAdding(true)}>
            Add exercise
          </Button>
        </Card>

        {dayView.slots.some((s) => s.archived) ? (
          <Card title="Removed exercises">
            {dayView.slots
              .filter((s) => s.archived)
              .map((s) => (
                <div key={s.slot.id} className={styles.slot}>
                  <span className={styles.slotMain}>{s.exercise?.name ?? s.slot.label}</span>
                  <Button variant="ghost" onClick={() => void unarchiveSlot.run(s.slot.id)}>
                    Restore
                  </Button>
                </div>
              ))}
          </Card>
        ) : null}

        {!dayView.archived ? (
          <Button variant="danger" block onClick={() => setArchiving(true)}>
            Archive day
          </Button>
        ) : null}
      </Stack>

      <PromptSheet
        open={renaming}
        title="Rename day"
        label="Name"
        initial={day.name}
        onClose={() => setRenaming(false)}
        onSubmit={(name) => void rename.run(day.id, { name }).then(() => setRenaming(false))}
      />
      <ExercisePicker
        open={adding}
        title="Add exercise"
        exclude={active.map((s) => s.slot.defaultExerciseId)}
        onClose={() => setAdding(false)}
        onPick={(exerciseId) => {
          setAdding(false)
          const ex = library?.find((e) => e.exercise.id === exerciseId)?.exercise
          if (ex) void addSlot.run(day.id, { exerciseId, ...ex.defaultRegime })
        }}
      />
      <SlotSheet
        slot={editing}
        gymId={gymId}
        gymName={overview.gym?.name ?? ''}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={archiving}
        title="Archive this day?"
        confirmLabel="Archive"
        danger
        onCancel={() => setArchiving(false)}
        onConfirm={() => {
          setArchiving(false)
          void archive.run(day.id)
        }}
      >
        Its history stays; it just won’t be offered when you start a workout.
      </ConfirmDialog>
    </>
  )
}

function SlotSheet({
  slot,
  gymId,
  gymName,
  onClose,
}: {
  slot: ProgramSlotView | null
  gymId: string | null
  gymName: string
  onClose: () => void
}) {
  return (
    <Sheet open={slot !== null} title={slot?.exercise?.name ?? 'Exercise'} onClose={onClose}>
      {slot ? (
        <SlotForm
          key={slot.slot.id}
          view={slot}
          gymId={gymId}
          gymName={gymName}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  )
}

function SlotForm({
  view,
  gymId,
  gymName,
  onClose,
}: {
  view: ProgramSlotView
  gymId: string | null
  gymName: string
  onClose: () => void
}) {
  const s = view.slot
  const [regime, setRegime] = useState<Regime>({
    sets: s.sets,
    repMin: s.repMin,
    repMax: s.repMax,
    rirMin: s.rirMin,
    rirMax: s.rirMax,
    restMinSec: s.restMinSec,
    restMaxSec: s.restMaxSec,
  })
  const [picking, setPicking] = useState<'default' | 'alternate' | 'gym' | null>(null)
  const save = useCommand(updateSlot, { success: 'Saved' })
  const override = useCommand(setGymSlotOverride)
  const remove = useCommand(archiveSlot)
  const num = (k: keyof Regime, label: string, step: number, min: number, max: number) => (
    <Field label={label}>
      <NumberStepper
        label={label}
        value={regime[k]}
        onChange={(v) => v !== null && setRegime((r) => ({ ...r, [k]: v }))}
        step={step}
        min={min}
        max={max}
        decimals={0}
      />
    </Field>
  )

  return (
    <div className={kit.stack}>
      <div className={styles.twoCol}>
        {num('sets', 'Sets', 1, 1, 10)}
        <span />
        {num('repMin', 'Reps from', 1, 1, 50)}
        {num('repMax', 'Reps to', 1, 1, 50)}
        {num('rirMin', 'RIR from', 1, 0, 5)}
        {num('rirMax', 'RIR to', 1, 0, 5)}
        {num('restMinSec', 'Rest min (s)', 15, 0, 900)}
        {num('restMaxSec', 'Rest max (s)', 15, 0, 900)}
      </div>
      <Button
        variant="primary"
        block
        onClick={() => void save.tryRun(s.id, regime).then((ok) => ok && onClose())}
      >
        Save sets and reps
      </Button>

      <Field label="Exercise">
        <Button block onClick={() => setPicking('default')}>
          {view.defaultExercise?.name ?? 'Choose'} — change
        </Button>
      </Field>
      <Field label="Suggested swaps" hint="Offered first when you swap during a workout">
        <div className={kit.chips}>
          {view.alternates.map((a) => (
            <button
              key={a.id}
              type="button"
              className={kit.chip}
              onClick={() =>
                void save.run(s.id, {
                  alternateExerciseIds: view.alternates
                    .filter((x) => x.id !== a.id)
                    .map((x) => x.id),
                })
              }
              aria-label={`Remove ${a.name}`}
            >
              {a.name} ✕
            </button>
          ))}
          <button type="button" className={kit.chip} onClick={() => setPicking('alternate')}>
            + Add
          </button>
        </div>
      </Field>
      {gymId ? (
        <Field
          label={`At ${gymName}`}
          hint="Use a different exercise in this slot at this gym only"
        >
          <div className={kit.chips}>
            <button type="button" className={kit.chip} onClick={() => setPicking('gym')}>
              {view.isOverride ? `${view.exercise?.name} — change` : 'Choose a gym swap'}
            </button>
            {view.isOverride ? (
              <button
                type="button"
                className={kit.chip}
                onClick={() => void override.run(gymId, s.id, null)}
              >
                Remove swap
              </button>
            ) : null}
          </div>
        </Field>
      ) : null}
      <Button
        variant="danger"
        block
        onClick={() => void remove.tryRun(s.id).then((ok) => ok && onClose())}
      >
        Remove from day
      </Button>

      <ExercisePicker
        open={picking !== null}
        title={
          picking === 'gym'
            ? `Exercise at ${gymName}`
            : picking === 'alternate'
              ? 'Add a suggested swap'
              : 'Exercise'
        }
        exclude={[s.defaultExerciseId, ...s.alternateExerciseIds]}
        onClose={() => setPicking(null)}
        onPick={(exerciseId) => {
          if (picking === 'default') void save.run(s.id, { defaultExerciseId: exerciseId })
          if (picking === 'alternate')
            void save.run(s.id, { alternateExerciseIds: [...s.alternateExerciseIds, exerciseId] })
          if (picking === 'gym' && gymId) void override.run(gymId, s.id, exerciseId)
          setPicking(null)
        }}
      />
    </div>
  )
}
