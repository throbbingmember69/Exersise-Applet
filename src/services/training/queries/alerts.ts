// Training cards for the Today screen: a session to resume, stalled lifts, and the deload state.
import type { LocalDate } from '@/domain/types'
import type { ServiceCtx } from '../../context'
import {
  compareScopes,
  deloadView,
  loadQueryData,
  modelAsOf,
  openStallViews,
  queryDate,
  type DeloadView,
  type StallView,
} from './shared'

export interface TrainingAlerts {
  inProgressSessionId: string | null
  /**
   * Stalled series as of `asOf` that weren't answered in the suggestion log, oldest stall first.
   * Only exercises still in the program are checked (TrainingModel.stallFlags).
   */
  stalls: StallView[]
  deload: DeloadView
}

/**
 * Alerts from history up to `asOf`, including the suggestion log as it stood then (the session to
 * resume is whatever is in progress now). Throws ServiceError 'invalid_date' for a bad date.
 */
export async function getTrainingAlerts(
  ctx: Pick<ServiceCtx, 'db'>,
  { asOf: asOfInput }: { asOf: LocalDate },
): Promise<TrainingAlerts> {
  const asOf = queryDate(asOfInput, 'As-of date')
  const q = await loadQueryData(ctx)
  const model = modelAsOf(q.data, asOf)
  const stalls = openStallViews(q, model).sort(
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
