import { useState } from 'react'
import { useCommand, useToday, useUnits } from '@/app/hooks'
import { formatMassWithUnit } from '@/domain/units'
import { saveWeighIn, type WeighInResult } from '@/services/nutrition/body'
import ConfirmDialog from '@/ui/ConfirmDialog'
import { Button, Card, Field } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import MassInput from '@/ui/MassInput'

/**
 * Today's weigh-in. Readings far from the trend (a likely typo) ask for confirmation first.
 * `initialLb` pre-fills the stepper (e.g. the latest weight) so a small change is two taps.
 */
export default function WeighInCard({
  initialLb,
  loggedToday,
}: {
  initialLb: number | null
  loggedToday: number | null
}) {
  const today = useToday()
  const units = useUnits()
  const [weight, setWeight] = useState<number | null | undefined>(undefined)
  const [confirm, setConfirm] = useState<Extract<
    WeighInResult,
    { status: 'needs_confirm' }
  > | null>(null)
  const save = useCommand(saveWeighIn)
  const value = weight === undefined ? (loggedToday ?? initialLb) : weight

  const submit = async (confirmed: boolean) => {
    if (value == null) return
    const result = await save.run({ date: today, weightLb: value, confirmed })
    if (result?.status === 'needs_confirm') setConfirm(result)
    else if (result?.status === 'saved') {
      setConfirm(null)
      setWeight(undefined)
    }
  }

  return (
    <Card title="Weigh-in">
      <Field
        label={`Morning weight (${units})`}
        hint={
          loggedToday !== null
            ? `Logged today: ${formatMassWithUnit(loggedToday, units)}`
            : 'After the bathroom, before food or drink'
        }
      >
        <MassInput
          label="Morning weight"
          valueLb={value}
          onChangeLb={setWeight}
          unit={units}
          stepLb={0.2}
        />
      </Field>
      <div className={kit.actions}>
        <Button
          variant="primary"
          disabled={value == null || save.pending}
          onClick={() => void submit(false)}
        >
          {loggedToday !== null ? 'Update' : 'Save'}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title="Save this weight?"
        confirmLabel="Save anyway"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void submit(true)}
      >
        {confirm && value != null
          ? `${formatMassWithUnit(value, units)} is ${Math.abs(confirm.deviationPct).toFixed(1)}% ${
              confirm.deviationPct > 0 ? 'above' : 'below'
            } your ${confirm.weightSource === 'trend' ? 'trend' : 'starting weight'} (${formatMassWithUnit(
              confirm.trendLb,
              units,
            )}). Is that right?`
          : null}
      </ConfirmDialog>
    </Card>
  )
}
