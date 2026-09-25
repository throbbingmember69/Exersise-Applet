// Small app-wide queries used outside any one feature.
import type { ServiceCtx } from './context'

/** True while a workout is being logged (app updates wait until it's finished). */
export async function hasSessionInProgress(ctx: Pick<ServiceCtx, 'db'>): Promise<boolean> {
  const inProgress = await ctx.db.sessions.where('status').equals('in_progress').toArray()
  return inProgress.some((s) => s.voidedAt === null)
}
