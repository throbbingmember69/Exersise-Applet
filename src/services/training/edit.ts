// Edit mode: explicit corrections to a finished or abandoned session, entered from the session
// detail after a confirm (a session in progress is changed in the logger, session.ts). It can fix
// a set's load, reps, RIR, warm-up flag or note, add a missed set, delete (void) and restore sets,
// change the session's note, joint-pain and deload flags, bodyweight and finished/abandoned
// status, and delete (void) or restore the whole session. Every change stamps `editedAt` on the
// row it touches and on its session. Suggestions are re-derived from history, so a correction
// takes effect on the next suggestion without rewriting anything else.
//
// The prescription snapshots (`sessionExercises`) are never modified: every write transaction
// here is scoped to `sessions` and `setLogs` only, so Dexie itself would refuse a snapshot write.
// Only the one session a command names is ever written.
import {
  assertCanEdit,
  assertEditable,
  assertLoad,
  assertReps,
  assertRir,
  assertSessionExerciseOf,
  assertSetNotVoided,
  assertSetOf,
  assertSetValues,
  checkSessionPatch,
  checkSetPatch,
  nextSetIndex,
  requireSession,
  requireSessionExercise,
  requireSet,
  type SessionPatch,
  type SetPatch,
} from '@/db/guards'
import type { Session, SessionExercise, SetLog } from '@/domain/types'
import type { ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { buildSetLog, type LogSetInput } from './session'

export type { SessionPatch, SetPatch }

/** Correct a set of a finished or abandoned session. */
export async function editSet(ctx: ServiceCtx, setId: string, patch: SetPatch): Promise<void> {
  const p = checkSetPatch(patch)
  if (p.reps !== undefined) assertReps(p.reps)
  if (p.rir !== undefined) assertRir(p.rir)
  if (Object.keys(p).length === 0) return
  await withEditableSet(ctx, setId, async ({ set, se, now }) => {
    assertSetNotVoided(set)
    assertSetValues({ ...set, ...p }, se.loadType)
    await ctx.db.setLogs.update(set.id, { ...p, editedAt: now })
  })
}

/** Add a set that was missed while logging. Returns the new set id. */
export async function addSet(ctx: ServiceCtx, input: LogSetInput): Promise<string> {
  const { db } = ctx
  const rir = input.rir ?? null
  assertReps(input.reps)
  assertRir(rir)
  checkSetPatch({ isWarmup: input.isWarmup, note: input.note })
  // Snapshots never change after the session starts, so reading one outside the transaction is safe.
  const se = requireSessionExercise(
    await db.sessionExercises.get(input.sessionExerciseId),
    input.sessionExerciseId,
  )
  assertLoad(input.loadLb, se.loadType)
  const id = ctx.newId()
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.setLogs], async () => {
    const session = requireSession(await db.sessions.get(se.sessionId), se.sessionId)
    assertSessionExerciseOf(se, session)
    assertCanEdit(session)
    const existing = await db.setLogs.where('sessionExerciseId').equals(se.id).toArray()
    await db.setLogs.add(
      buildSetLog(
        { ...input, rir },
        { id, se, setIndex: nextSetIndex(existing), loggedAt: now, editedAt: now },
      ),
    )
    await db.sessions.update(session.id, { editedAt: now })
  })
  return id
}

/** Delete (soft-void) a set of a finished or abandoned session. Restorable. */
export async function voidSetInEdit(ctx: ServiceCtx, setId: string): Promise<void> {
  await withEditableSet(ctx, setId, async ({ set, now }) => {
    assertSetNotVoided(set)
    await ctx.db.setLogs.update(set.id, { voidedAt: now, editedAt: now })
  })
}

/** Restore a voided set of a finished or abandoned session. */
export async function restoreSet(ctx: ServiceCtx, setId: string): Promise<void> {
  await withEditableSet(ctx, setId, async ({ set, now }) => {
    if (set.voidedAt === null) {
      throw new ServiceError('set_not_voided', "That set isn't deleted.", { setId })
    }
    await ctx.db.setLogs.update(set.id, { voidedAt: null, editedAt: now })
  })
}

/**
 * Change a finished or abandoned session's note, joint-pain flag, deload flag, bodyweight or
 * status (finished ↔ abandoned). An edited bodyweight becomes a manual one.
 */
export async function editSession(
  ctx: ServiceCtx,
  sessionId: string,
  patch: SessionPatch,
): Promise<void> {
  const p = checkSessionPatch(patch)
  if (Object.keys(p).length === 0) return
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.sessions, async () => {
    assertCanEdit(requireSession(await db.sessions.get(sessionId), sessionId))
    await db.sessions.update(sessionId, {
      ...p,
      ...(p.bodyweightLb !== undefined && { bodyweightSource: 'manual' as const }),
      editedAt: now,
    })
  })
}

/** Delete (soft-void) a finished or abandoned session: kept, restorable, excluded everywhere. */
export async function voidSession(ctx: ServiceCtx, sessionId: string): Promise<void> {
  await withEditableSession(ctx, sessionId, async (session, now) => {
    if (session.voidedAt !== null) {
      throw new ServiceError('session_voided', 'This session is already deleted.', { sessionId })
    }
    await ctx.db.sessions.update(sessionId, { voidedAt: now, editedAt: now })
  })
}

/** Restore a voided session. */
export async function restoreSession(ctx: ServiceCtx, sessionId: string): Promise<void> {
  await withEditableSession(ctx, sessionId, async (session, now) => {
    if (session.voidedAt === null) {
      throw new ServiceError('session_not_voided', "This session isn't deleted.", { sessionId })
    }
    await ctx.db.sessions.update(sessionId, { voidedAt: null, editedAt: now })
  })
}

async function withEditableSession(
  ctx: ServiceCtx,
  sessionId: string,
  write: (session: Session, now: number) => Promise<void>,
): Promise<void> {
  const { db } = ctx
  const now = ctx.now()
  await db.transaction('rw', db.sessions, async () => {
    const session = requireSession(await db.sessions.get(sessionId), sessionId)
    assertEditable(session)
    await write(session, now)
  })
}

/**
 * Run a set edit: the set, its snapshot and its session are checked to belong together and to be
 * editable, then `write` runs and the session's `editedAt` is stamped, all in one transaction.
 */
async function withEditableSet(
  ctx: ServiceCtx,
  setId: string,
  write: (rows: {
    set: SetLog
    se: SessionExercise
    session: Session
    now: number
  }) => Promise<void>,
): Promise<void> {
  const { db } = ctx
  const pre = requireSet(await db.setLogs.get(setId), setId)
  const se = requireSessionExercise(
    await db.sessionExercises.get(pre.sessionExerciseId),
    pre.sessionExerciseId,
  )
  const now = ctx.now()
  await db.transaction('rw', [db.sessions, db.setLogs], async () => {
    const set = requireSet(await db.setLogs.get(setId), setId)
    const session = requireSession(await db.sessions.get(set.sessionId), set.sessionId)
    assertSetOf(set, se, session)
    assertCanEdit(session)
    await write({ set, se, session, now })
    await db.sessions.update(session.id, { editedAt: now })
  })
}
