// Small stroke icon set (24×24 grid, currentColor). Decorative by default; pass `label` for
// icons that carry meaning on their own.

const PATHS = {
  today: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  train: 'M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12',
  body: 'M5 20h14l-2-12H7zM9 8a3 3 0 0 1 6 0M12 12v3',
  food: 'M7 3v8a2 2 0 0 0 4 0V3M9 11v10M16 3c-2 2-2 6 0 8v10',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  timer: 'M12 8v5l3 2M9 2h6M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  swap: 'M7 7h13l-4-4M17 17H4l4 4',
  warning: 'M12 3l10 18H2zM12 10v4M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7h.01',
  chart: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  play: 'M7 4l13 8-13 8z',
  history: 'M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6M12 8v4l3 2',
} as const

export type IconName = keyof typeof PATHS

interface IconProps {
  name: IconName
  size?: number
  /** Accessible label; omit for decorative icons. */
  label?: string
  className?: string
}

export default function Icon({ name, size = 22, label, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
