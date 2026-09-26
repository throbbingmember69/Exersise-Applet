// The bodyweight a session starts with (DESIGN (d): the start sheet shows it, editable). One rule,
// shared by the start sheet query (getStartOptions) and startSession, so the value the lifter sees
// is the value that gets stored: the same-day weigh-in, else the trend weight (or the seed
// baseline before any real weigh-in, via domain bodyweightOn), else unknown.
import { bodyweightOn, buildTrend } from '@/domain/trend'
import type { BodyEntry, BodyweightSource, LocalDate, Settings } from '@/domain/types'

export interface SessionBodyweight {
  /** null when there is no body data at all: the lifter enters it (setSessionBodyweight). */
  weightLb: number | null
  /**
   * Where the weight came from. Meaningless when `weightLb` is null: the session then stores
   * 'manual' (the schema has no "none" value), and nothing should label or read it.
   */
  source: BodyweightSource
  /** A trend value carried forward past the last weigh-in. */
  stale: boolean
}

/** Bodyweight for a session on `date`: same-day weigh-in → trend → seed baseline → unknown. */
export function resolveSessionBodyweight(
  data: { bodyEntries: readonly BodyEntry[]; settings: Settings },
  date: LocalDate,
): SessionBodyweight {
  const { bodyEntries: entries, settings } = data
  let weighIn: BodyEntry | null = null
  for (const e of entries) {
    const w = e.weightLb
    if (e.date !== date || e.source !== 'user' || e.voidedAt !== null || w === null) continue
    if (!Number.isFinite(w) || w <= 0) continue
    if (weighIn === null || e.updatedAt >= weighIn.updatedAt) weighIn = e
  }
  if (weighIn !== null && weighIn.weightLb !== null) {
    return { weightLb: weighIn.weightLb, source: 'weighin', stale: false }
  }
  const bw = bodyweightOn(buildTrend(entries, settings), entries, date)
  return bw
    ? { weightLb: bw.weightLb, source: bw.source, stale: bw.stale }
    : { weightLb: null, source: 'manual', stale: false }
}
