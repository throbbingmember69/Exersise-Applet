import styles from './kit.module.css'

export default function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={styles.spinnerWrap} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.srOnly}>{label}</span>
    </div>
  )
}
