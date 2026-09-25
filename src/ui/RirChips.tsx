import styles from './kit.module.css'

const VALUES = [0, 1, 2, 3, 4, 5] as const

/** Reps-in-reserve picker (0–5). Tapping the selected chip clears it. */
export default function RirChips({
  value,
  onChange,
  label = 'RIR',
}: {
  value: number | null
  onChange: (value: number | null) => void
  label?: string
}) {
  return (
    <div className={styles.chips} role="group" aria-label={label}>
      {VALUES.map((v) => (
        <button
          key={v}
          type="button"
          className={styles.chip}
          aria-pressed={value === v}
          onClick={() => onChange(value === v ? null : v)}
        >
          {v === 5 ? '5+' : v}
        </button>
      ))}
    </div>
  )
}
