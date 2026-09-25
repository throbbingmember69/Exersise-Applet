// Identity of progression tracks and strength series.
//
// Track  = (program day, exercise, gym scope): what the flowchart replays for load suggestions.
//          Separate per program day (user decision).
// Series = (exercise, gym scope): pooled across program days for e1RM charts and stall detection.
// Gym scope = the gym id for equipment-specific exercises (machines/cables), else shared ('*').
// The scope is computed when reading, from the exercise's current `equipmentSpecific` flag, so
// toggling the flag regroups history without rewriting it.
import { SHARED_GYM_SCOPE, type GymScope } from '../types'

const SEP = '|'

export function gymScope(equipmentSpecific: boolean, gymId: string): GymScope {
  return equipmentSpecific ? gymId : SHARED_GYM_SCOPE
}

export function trackKey(programDayId: string, exerciseId: string, scope: GymScope): string {
  assertIdPart(programDayId)
  assertIdPart(exerciseId)
  assertIdPart(scope)
  return [programDayId, exerciseId, scope].join(SEP)
}

export function parseTrackKey(key: string): { programDayId: string; exerciseId: string; scope: GymScope } {
  const parts = key.split(SEP)
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new RangeError(`Malformed track key: ${JSON.stringify(key)}`)
  }
  const [programDayId, exerciseId, scope] = parts as [string, string, string]
  return { programDayId, exerciseId, scope }
}

export function seriesKey(exerciseId: string, scope: GymScope): string {
  assertIdPart(exerciseId)
  assertIdPart(scope)
  return [exerciseId, scope].join(SEP)
}

function assertIdPart(s: string): void {
  if (s.length === 0 || s.includes(SEP)) {
    throw new RangeError(`Id parts must be non-empty and must not contain "${SEP}": ${JSON.stringify(s)}`)
  }
}
