// Small responsive line chart on uPlot (canvas, ~20 KB, touch-friendly). X values are LocalDate
// strings; each series is a y array aligned with them (null = gap). Colors come from the theme
// tokens so charts follow light/dark mode.
import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { dayNumber, fromDayNumber } from '@/domain/dates'
import type { LocalDate } from '@/domain/types'
import styles from './LineChart.module.css'

export type SeriesTone = 'accent' | 'muted' | 'good' | 'warn' | 'bad'

export interface ChartSeries {
  label: string
  values: readonly (number | null)[]
  tone?: SeriesTone
  /** Draw points only (e.g. raw weigh-ins under a trend line). */
  pointsOnly?: boolean
  dashed?: boolean
}

export interface LineChartProps {
  /** Accessible summary of what the chart shows. */
  label: string
  dates: readonly LocalDate[]
  series: readonly ChartSeries[]
  height?: number
  /** Format y-axis values and tooltip values (e.g. mass in the display unit). */
  formatY?: (v: number) => string
  /** Optional shaded horizontal band (e.g. a target range). */
  band?: { min: number; max: number }
}

const TONE_VAR: Record<SeriesTone, string> = {
  accent: '--accent',
  muted: '--text-muted',
  good: '--good',
  warn: '--warn',
  bad: '--bad',
}

const DAY_SEC = 86_400

/** Canvas 2D and ResizeObserver are required (absent in test DOMs, where the chart stays blank). */
function canDraw(): boolean {
  if (typeof ResizeObserver === 'undefined') return false
  try {
    return document.createElement('canvas').getContext('2d') != null
  } catch {
    return false
  }
}

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#888'
}

export default function LineChart({
  label,
  dates,
  series,
  height = 200,
  formatY = (v) => String(Math.round(v * 10) / 10),
  band,
}: LineChartProps) {
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el || dates.length === 0 || !canDraw()) return
    const xs = dates.map((d) => dayNumber(d) * DAY_SEC)
    const text = cssVar(el, '--text-muted')
    const grid = cssVar(el, '--border')
    const bandFill = cssVar(el, '--surface-2')

    const opts: uPlot.Options = {
      width: el.clientWidth || 320,
      height,
      legend: { show: series.length > 1 },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          values: (_u, splits) =>
            splits.map((s) => {
              const d = fromDayNumber(Math.round(s / DAY_SEC))
              return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
            }),
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 52,
          values: (_u, splits) => splits.map((s) => formatY(s)),
        },
      ],
      series: [
        { value: (_u, v) => (v == null ? '' : fromDayNumber(Math.round(v / DAY_SEC))) },
        ...series.map((s) => {
          const color = cssVar(el, TONE_VAR[s.tone ?? 'accent'])
          return {
            label: s.label,
            stroke: s.pointsOnly ? 'transparent' : color,
            width: 2,
            dash: s.dashed ? [6, 4] : undefined,
            spanGaps: true,
            points: {
              show: s.pointsOnly ? true : dates.length <= 40,
              size: 5,
              fill: color,
              stroke: color,
            },
            value: (_u: uPlot, v: number | null) => (v == null ? '–' : formatY(v)),
          }
        }),
      ],
      hooks: band
        ? {
            drawClear: [
              (u) => {
                const top = u.valToPos(band.max, 'y', true)
                const bottom = u.valToPos(band.min, 'y', true)
                u.ctx.save()
                u.ctx.fillStyle = bandFill
                u.ctx.fillRect(u.bbox.left, top, u.bbox.width, bottom - top)
                u.ctx.restore()
              },
            ],
          }
        : {},
    }
    const data = [xs, ...series.map((s) => [...s.values])] as uPlot.AlignedData
    const plot = new uPlot(opts, data, el)
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      plot.destroy()
    }
  }, [dates, series, height, formatY, band])

  return (
    <figure className={styles.figure}>
      <div ref={wrap} className={styles.chart} role="img" aria-label={label} />
      <figcaption className={styles.caption}>{label}</figcaption>
    </figure>
  )
}
