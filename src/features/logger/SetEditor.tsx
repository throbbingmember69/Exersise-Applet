import { useState } from 'react'
import type { LoadType, UnitSystem } from '@/domain/types'
import type { SetView } from '@/services/training/queries'
import { Button, Field, Toggle } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import MassInput from '@/ui/MassInput'
import NumberStepper from '@/ui/NumberStepper'
import RirChips from '@/ui/RirChips'
import Sheet from '@/ui/Sheet'

export interface SetPatchInput {
  loadLb: number
  reps: number
  rir: number | null
  isWarmup: boolean
}

/** Correct or delete a logged set. */
export default function SetEditor({
  set,
  exercise,
  unit,
  stepLb,
  onSave,
  onDelete,
  onClose,
}: {
  set: SetView | null
  exercise: { loadType: LoadType; perHand: boolean }
  unit: UnitSystem
  stepLb: number
  onSave: (patch: SetPatchInput) => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={set !== null} title={set ? `Set ${set.setIndex + 1}` : 'Set'} onClose={onClose}>
      {set ? (
        <SetEditorForm
          key={set.id}
          set={set}
          exercise={exercise}
          unit={unit}
          stepLb={stepLb}
          onSave={onSave}
          onDelete={onDelete}
        />
      ) : null}
    </Sheet>
  )
}

function SetEditorForm({
  set,
  exercise,
  unit,
  stepLb,
  onSave,
  onDelete,
}: {
  set: SetView
  exercise: { loadType: LoadType; perHand: boolean }
  unit: UnitSystem
  stepLb: number
  onSave: (patch: SetPatchInput) => void
  onDelete: () => void
}) {
  const [loadLb, setLoadLb] = useState<number | null>(set.loadLb)
  const [reps, setReps] = useState<number | null>(set.reps)
  const [rir, setRir] = useState<number | null>(set.rir)
  const [isWarmup, setWarmup] = useState(set.isWarmup)
  return (
    <div className={kit.stack}>
      <Field label={`Load (${unit})${exercise.perHand ? ' per hand' : ''}`}>
        <MassInput
          label="Load"
          valueLb={loadLb}
          onChangeLb={setLoadLb}
          unit={unit}
          stepLb={stepLb}
          allowNegative={exercise.loadType === 'bodyweight_plus'}
        />
      </Field>
      <Field label="Reps">
        <NumberStepper label="Reps" value={reps} onChange={setReps} step={1} min={0} decimals={0} />
      </Field>
      <Field label="Reps in reserve">
        <RirChips value={rir} onChange={setRir} />
      </Field>
      <Toggle label="Warm-up set" checked={isWarmup} onChange={setWarmup} />
      <div className={kit.actions}>
        <Button variant="danger" onClick={onDelete}>
          Delete set
        </Button>
        <Button
          variant="primary"
          disabled={loadLb === null || reps === null}
          onClick={() => onSave({ loadLb: loadLb!, reps: reps!, rir, isWarmup })}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
