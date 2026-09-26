// The running rest timer, persisted in appState so a reload or the phone killing the tab mid-rest
// keeps the countdown (it's computed from timestamps; see domain/restTimer).
import { extendRest, startRest, type RestTimer } from '@/domain/restTimer'
import type { ServiceCtx } from '../context'
import { getAppState, loadSettings, setAppState } from '../settings'

const KEY = 'restTimer'

export interface RestTimerState {
  sessionId: string
  sessionExerciseId: string
  timer: RestTimer
}

export async function getRestTimer(ctx: Pick<ServiceCtx, 'db'>): Promise<RestTimerState | null> {
  const v = await getAppState<RestTimerState | null>(ctx, KEY)
  return v && typeof v === 'object' && 'timer' in v ? v : null
}

/** Start (or restart) the rest timer after a logged set. */
export async function startRestTimer(
  ctx: ServiceCtx,
  input: { sessionId: string; sessionExerciseId: string; restMinSec: number; restMaxSec: number },
): Promise<void> {
  await setAppState(ctx, KEY, {
    sessionId: input.sessionId,
    sessionExerciseId: input.sessionExerciseId,
    timer: startRest(ctx.now(), input),
  } satisfies RestTimerState)
}

/** The "+30 s" button (restExtendSec). */
export async function extendRestTimer(ctx: ServiceCtx): Promise<void> {
  const current = await getRestTimer(ctx)
  if (!current) return
  const settings = await loadSettings(ctx)
  await setAppState(ctx, KEY, { ...current, timer: extendRest(current.timer, settings) })
}

export async function clearRestTimer(ctx: Pick<ServiceCtx, 'db'>): Promise<void> {
  await setAppState(ctx, KEY, null)
}
