// When to suggest a deload, and whether an accepted one is still running.
//
// A deload is suggested from data, not the calendar: when at least `deloadStallCount` strength
// series are stalled at once, or joint pain was flagged in at least `deloadJointPainHits` of the
// last `deloadJointPainWindow` sessions (a manual button also exists, outside this module). Once
// accepted it lasts `deloadSessions` finished deload sessions unless ended early.
import type { Settings } from '@/domain/settings/registry'
import type { EpochMs } from '@/domain/types'

export type DeloadReason = 'stalls' | 'joint_pain'

export interface DeloadTriggerInput {
  /** Keys of the currently stalled strength series. */
  stalledSeries: readonly string[]
  /** Recent finished sessions, oldest first. */
  recentSessions: readonly { id: string; jointPain: boolean }[]
}

export interface DeloadTrigger {
  suggest: boolean
  reasons: DeloadReason[]
  /** Deterministic key for the suggestion log (null when nothing is suggested). */
  fingerprint: string | null
}

export interface DeloadStatusInput {
  /** When the current deload was accepted (null = none). */
  acceptedAt: EpochMs | null
  /** When it was ended early (null = not ended); an end before acceptedAt belongs to an older deload. */
  endedAt: EpochMs | null
  /** Finished deload sessions since acceptedAt. */
  deloadSessionsSince: number
}

export interface DeloadStatus {
  active: boolean
  /** Deload sessions still to do (0 when not active). */
  remaining: number
  /** Length of a deload in sessions. */
  total: number
}

/** Whether to suggest a deload, why, and a fingerprint so the same situation isn't re-suggested. */
export function deloadTrigger(input: DeloadTriggerInput, settings: Settings): DeloadTrigger {
  const stalled = [...new Set(input.stalledSeries)].sort()
  const window = Math.max(0, settings.deloadJointPainWindow)
  const recent = window === 0 ? [] : input.recentSessions.slice(-window)
  const painIds = recent.filter((s) => s.jointPain).map((s) => s.id)

  const reasons: DeloadReason[] = []
  const parts: string[] = []
  if (stalled.length >= settings.deloadStallCount) {
    reasons.push('stalls')
    parts.push(`stalls=${stalled.join(',')}`)
  }
  if (painIds.length >= settings.deloadJointPainHits) {
    reasons.push('joint_pain')
    parts.push(`joint_pain=${painIds.join(',')}`)
  }
  const suggest = reasons.length > 0
  return { suggest, reasons, fingerprint: suggest ? ['deload', ...parts].join(';') : null }
}

/** Whether an accepted deload is still running and how many deload sessions remain. */
export function deloadStatus(input: DeloadStatusInput, settings: Settings): DeloadStatus {
  const total = settings.deloadSessions
  const endedEarly =
    input.acceptedAt !== null && input.endedAt !== null && input.endedAt >= input.acceptedAt
  const active = input.acceptedAt !== null && !endedEarly && input.deloadSessionsSince < total
  return { active, remaining: active ? total - Math.max(0, input.deloadSessionsSince) : 0, total }
}
