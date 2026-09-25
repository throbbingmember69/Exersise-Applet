import { useEffect, useRef, type ReactNode } from 'react'
import Icon from './Icon'
import styles from './kit.module.css'

/** Bottom sheet built on <dialog> (focus trap, Esc and backdrop close). */
export default function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open ? (
        <>
          <div className={styles.sheetHeader}>
            <h2>{title}</h2>
            <button
              type="button"
              className={`${styles.button} ${styles.ghost} ${styles.iconButton}`}
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="x" />
            </button>
          </div>
          {children}
        </>
      ) : null}
    </dialog>
  )
}
