import { useState } from 'react'
import { Button, Field } from './kit'
import styles from './kit.module.css'
import Sheet from './Sheet'

/** Ask for a short piece of text (a name). */
export default function PromptSheet({
  open,
  title,
  label,
  initial = '',
  confirmLabel = 'Save',
  onSubmit,
  onClose,
}: {
  open: boolean
  title: string
  label: string
  initial?: string
  confirmLabel?: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {open ? (
        <PromptForm
          label={label}
          initial={initial}
          confirmLabel={confirmLabel}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  )
}

function PromptForm({
  label,
  initial,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  label: string
  initial: string
  confirmLabel: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onSubmit(value.trim())
      }}
    >
      <Field label={label} htmlFor="prompt-input">
        <input
          id="prompt-input"
          className={styles.input}
          value={value}
          maxLength={80}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <div className={styles.actions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!value.trim()}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  )
}
