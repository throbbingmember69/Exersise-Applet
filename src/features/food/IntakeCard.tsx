import { useState } from 'react'
import { useCommand } from '@/app/hooks'
import type { LocalDate, NutritionEntry } from '@/domain/types'
import { saveIntake } from '@/services/nutrition/intake'
import { Button, Card, Field } from '@/ui/kit'
import kit from '@/ui/kit.module.css'
import NumberStepper from '@/ui/NumberStepper'

type Fields = 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'steps'

const LABELS: Record<Fields, { label: string; step: number }> = {
  kcal: { label: 'Calories (kcal)', step: 50 },
  proteinG: { label: 'Protein (g)', step: 5 },
  carbsG: { label: 'Carbs (g)', step: 10 },
  fatG: { label: 'Fat (g)', step: 5 },
  steps: { label: 'Steps', step: 500 },
}

/**
 * The day's running totals (from your food app or label math). A day counts as logged once it has
 * calories; macros and steps are optional.
 */
export default function IntakeCard({
  date,
  entry,
  compact = false,
}: {
  date: LocalDate
  entry: NutritionEntry | null
  /** Only calories and protein (Today); the Food tab shows every field. */
  compact?: boolean
}) {
  const fields: Fields[] = compact
    ? ['kcal', 'proteinG']
    : ['kcal', 'proteinG', 'carbsG', 'fatG', 'steps']
  const [draft, setDraft] = useState<Partial<Record<Fields, number | null>>>({})
  const save = useCommand(saveIntake, { success: 'Intake saved' })
  const value = (f: Fields) => (f in draft ? draft[f]! : (entry?.[f] ?? null))
  const dirty = Object.keys(draft).length > 0

  return (
    <Card title={compact ? 'Intake so far' : 'Intake'}>
      <div className={kit.stack}>
        {fields.map((f) => (
          <Field key={f} label={LABELS[f].label}>
            <NumberStepper
              label={LABELS[f].label}
              value={value(f)}
              onChange={(v) => setDraft((d) => ({ ...d, [f]: v }))}
              step={LABELS[f].step}
              min={0}
              decimals={0}
            />
          </Field>
        ))}
      </div>
      <div className={kit.actions}>
        <Button
          variant="primary"
          disabled={!dirty || save.pending}
          onClick={() =>
            void save.run({ date, ...draft }).then((r) => {
              if (r !== undefined) setDraft({})
            })
          }
        >
          Save
        </Button>
      </div>
    </Card>
  )
}
