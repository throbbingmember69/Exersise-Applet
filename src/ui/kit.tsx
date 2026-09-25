// Small presentational building blocks shared by every feature.
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { cx } from './cx'
import Icon, { type IconName } from './Icon'
import styles from './kit.module.css'

export function PageHeader({
  title,
  back,
  actions,
}: {
  title: string
  /** Route to go back to, or true for browser history back. */
  back?: string | true
  actions?: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <header className={styles.pageHeader}>
      {back === true ? (
        <button
          type="button"
          className={cx(styles.backLink, styles.ghost, styles.button, styles.iconButton)}
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <Icon name="chevron-left" />
        </button>
      ) : back ? (
        <Link className={styles.backLink} to={back} aria-label="Back">
          <Icon name="chevron-left" />
        </Link>
      ) : null}
      <h1>{title}</h1>
      {actions}
    </header>
  )
}

export function Card({
  title,
  children,
  className,
}: {
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cx(styles.card, className)}>
      {title ? <h2 className={styles.cardTitle}>{title}</h2> : null}
      {children}
    </section>
  )
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>
}

type Variant = 'default' | 'primary' | 'danger' | 'ghost'

function buttonClass(variant: Variant, block?: boolean, iconOnly?: boolean) {
  return cx(
    styles.button,
    variant === 'primary' && styles.primary,
    variant === 'danger' && styles.danger,
    variant === 'ghost' && styles.ghost,
    block && styles.block,
    iconOnly && styles.iconButton,
  )
}

export function Button({
  variant = 'default',
  block,
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  block?: boolean
  icon?: IconName
}) {
  return (
    <button
      type={type}
      className={cx(buttonClass(variant, block, !children && !!icon), className)}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

export function ButtonLink({
  to,
  variant = 'default',
  block,
  icon,
  children,
}: {
  to: string
  variant?: Variant
  block?: boolean
  icon?: IconName
  children: ReactNode
}) {
  return (
    <Link to={to} className={buttonClass(variant, block)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  )
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={styles.badge} data-tone={tone === 'neutral' ? undefined : tone}>
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={styles.empty}>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  )
}

export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

export function LinkList({ children }: { children: ReactNode }) {
  return <ul className={styles.linkList}>{children}</ul>
}

export function LinkRow({
  to,
  icon,
  label,
  hint,
  trailing,
}: {
  to: string
  icon?: IconName
  label: ReactNode
  hint?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <li>
      <Link to={to} className={styles.linkRow}>
        {icon ? <Icon name={icon} /> : null}
        <span className={styles.linkRowText}>
          <span>{label}</span>
          {hint ? <span className={styles.linkRowHint}>{hint}</span> : null}
        </span>
        {trailing}
        <Icon name="chevron-right" size={18} />
      </Link>
    </li>
  )
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className={cx(styles.muted, styles.small)}>{hint}</span> : null}
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: ReactNode
}) {
  return (
    <label className={styles.toggle}>
      <span>
        {label}
        {hint ? (
          <>
            <br />
            <span className={cx(styles.muted, styles.small)}>{hint}</span>
          </>
        ) : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
