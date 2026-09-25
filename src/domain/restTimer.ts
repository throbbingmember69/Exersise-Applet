// Timestamp-based rest timer. Rest is a min–max range ("2–3 min" alerts at 2:00 and again at
// 3:00; a single value alerts once). Everything is computed from startedAt and a caller-supplied
// "now", so the timer survives reloads and background throttling. The +N s control shifts both
// alerts; skipping is simply clearing the timer.
import type { Settings } from '@/domain/settings/registry'
import type { EpochMs, Regime } from '@/domain/types'

const MS_PER_SEC = 1000

export interface RestTimer {
  startedAt: EpochMs
  restMinSec: number
  restMaxSec: number
  /** Seconds added with the extend control; shifts both alerts. */
  extendedSec: number
}

/** rest: before the minimum; min: minimum reached; max: maximum reached. */
export type RestStage = 'rest' | 'min' | 'max'

export interface RestView {
  stage: RestStage
  /** Time left until the minimum (0 once reached). */
  msToMin: number
  /** Time left until the maximum (0 once reached). */
  msToMax: number
  elapsedMs: number
}

/** A timer for a regime's rest range, started at `now` (when a set is saved). */
export function startRest(
  now: EpochMs,
  regime: Pick<Regime, 'restMinSec' | 'restMaxSec'>,
): RestTimer {
  return {
    startedAt: now,
    restMinSec: regime.restMinSec,
    restMaxSec: regime.restMaxSec,
    extendedSec: 0,
  }
}

/** The same timer with the configured extension added. */
export function extendRest(t: RestTimer, settings: Settings): RestTimer {
  return { ...t, extendedSec: t.extendedSec + settings.restExtendSec }
}

/** Where the timer stands at `now`. */
export function restView(t: RestTimer, now: EpochMs): RestView {
  const [minAt, maxAt] = alertBounds(t)
  return {
    stage: now >= maxAt ? 'max' : now >= minAt ? 'min' : 'rest',
    msToMin: Math.max(0, minAt - now),
    msToMax: Math.max(0, maxAt - now),
    elapsedMs: Math.max(0, now - t.startedAt),
  }
}

/** Epoch ms of each alert: the minimum, then the maximum when it is later. */
export function alertTimes(t: RestTimer): EpochMs[] {
  const [minAt, maxAt] = alertBounds(t)
  return maxAt > minAt ? [minAt, maxAt] : [minAt]
}

function alertBounds(t: RestTimer): [EpochMs, EpochMs] {
  const minAt = t.startedAt + (t.restMinSec + t.extendedSec) * MS_PER_SEC
  const maxAt = t.startedAt + (Math.max(t.restMinSec, t.restMaxSec) + t.extendedSec) * MS_PER_SEC
  return [minAt, maxAt]
}
