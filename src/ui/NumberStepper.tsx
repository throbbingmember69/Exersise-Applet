import { useId, useState } from 'react'
import Icon from './Icon'
import styles from './kit.module.css'

export interface NumberStepperProps {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  step: number
  min?: number
  max?: number
  /** Decimals allowed when typing; 0 for integers (reps). */
  decimals?: number
  /** Text shown for the value (defaults to the number itself). */
  format?: (value: number) => string
  placeholder?: string
}

/**
 * − [value] + with a typeable field. Keeps its own draft text while focused so partial input
 * like "37." isn't clobbered; commits on blur or Enter.
 */
export default function NumberStepper({
  label,
  value,
  onChange,
  step,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  decimals = 1,
  format,
  placeholder = '–',
}: NumberStepperProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === null ? '' : (format?.(value) ?? String(value)))

  const clampRound = (v: number) => {
    const f = 10 ** decimals
    return Math.min(max, Math.max(min, Math.round(v * f) / f))
  }

  const commit = (text: string) => {
    setDraft(null)
    const t = text.trim().replace(',', '.')
    if (t === '') return onChange(null)
    const n = Number(t)
    if (Number.isFinite(n)) onChange(clampRound(n))
  }

  const bump = (dir: 1 | -1) => {
    setDraft(null)
    const base = value ?? (dir > 0 ? Math.max(0, min) : Math.max(0, min))
    onChange(clampRound(base + dir * step))
  }

  return (
    <div>
      <label htmlFor={id} className={styles.srOnly}>
        {label}
      </label>
      <div className={styles.stepper}>
        <button type="button" onClick={() => bump(-1)} aria-label={`Decrease ${label}`}>
          <Icon name="minus" />
        </button>
        <input
          id={id}
          inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          enterKeyHint="done"
          autoComplete="off"
          value={shown}
          placeholder={placeholder}
          onFocus={(e) => {
            setDraft(value === null ? '' : String(value))
            e.currentTarget.select()
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <button type="button" onClick={() => bump(1)} aria-label={`Increase ${label}`}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  )
}
