// Training cards for the Today screen: a session to resume, stalled lifts, and the deload state.
import type { LocalDate } from '@/domain/types'
import type { ServiceCtx } from '../../context'
import {
  compareScopes,
  deloadView,
  loadQueryData,
  modelAsOf,
  stallView,
  type DeloadView,
  type StallView,
} from './shared'

export interface TrainingAlerts {
  inProgressSessionId: string | null
  /** Stalled series as of `asOf`, oldest stall first. */
  stalls: StallView[]
  deload: DeloadView
}

/** Alerts from history up to `asOf` (the session to resume is whatever is in progress now). */
export async function getTrainingAlerts(
  ctx: Pick<ServiceCtx, 'db'>,
  { asOf }: { asOf: LocalDate },
): Promise<TrainingAlerts> {
  const q = await loadQueryData(ctx)
  const model = modelAsOf(q.data, asOf)
  const stalls = model
    .stallFlags()
    .filter((f) => f.result.stalled)
    .map((f) => stallView(q, model, f))
    .sort(
      (a, b) =>
        (a.since ?? '').localeCompare(b.since ?? '') ||
        a.name.localeCompare(b.name) ||
        compareScopes(q.gyms, a.scope, b.scope),
    )
  return {
    inProgressSessionId: q.model.inProgressSession()?.id ?? null,
    stalls,
    deload: deloadView(model),
  }
}
