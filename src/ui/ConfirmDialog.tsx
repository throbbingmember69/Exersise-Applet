import type { ReactNode } from 'react'
import { Button } from './kit'
import styles from './kit.module.css'
import Sheet from './Sheet'

export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Sheet open={open} title={title} onClose={onCancel}>
      {children ? <div className={styles.muted}>{children}</div> : null}
      <div className={styles.actions}>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  )
}
