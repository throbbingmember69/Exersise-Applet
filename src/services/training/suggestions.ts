// The suggestion log (finding #47): advisory suggestions (stall, deload, deload end, volume ramp,
// strength slide) and the user's answer. A suggestion is recorded the first time it is shown,
// under a deterministic key (e.g. the deload trigger's fingerprint) so the same situation isn't
// suggested again, and it is answered once. Nothing else is stored: whether a deload is running
// is derived from the accepted 'deload' and 'deload_end' rows by the training model.
import type { Suggestion, SuggestionKind } from '@/domain/types'
import type { ServiceCtx } from '../context'
import { ServiceError } from '../errors'
import { loadTrainingModel } from './model'

export const SUGGESTION_KINDS: readonly SuggestionKind[] = [
  'stall',
  'deload',
  'deload_end',
  'volume_ramp',
  'strength_slide',
]

export type SuggestionResponse = 'accepted' | 'dismissed'

export interface SuggestionInput {
  kind: SuggestionKind
  /** Deterministic fingerprint of the situation. */
  key: string
  payload?: Readonly<Record<string, unknown>>
}

/**
 * Record that a suggestion was shown. The first time creates a 'shown' row; later calls with the
 * same key return the existing row untouched (its status is kept). Returns the row id.
 */
export async function recordShown(ctx: ServiceCtx, input: SuggestionInput): Promise<string> {
  checkInput(input)
  const { db } = ctx
  const id = ctx.newId()
  const now = ctx.now()
  return db.transaction('rw', db.suggestions, async () => {
    const existing = await db.suggestions.where('key').equals(input.key).first()
    if (existing) {
      assertSameKind(existing, input.kind)
      return existing.id
    }
    await db.suggestions.add({
      id,
      kind: input.kind,
      key: input.key,
      status: 'shown',
      payload: { ...input.payload },
      firstShownAt: now,
      respondedAt: null,
    })
    return id
  })
}

/**
 * Accept or dismiss a shown suggestion. A suggestion is answered once. Accepting a deload starts
 * it, and answers the other shown deload suggestions as `acceptDeload` does.
 */
export async function respondSuggestion(
  ctx: ServiceCtx,
  id: string,
  response: SuggestionResponse,
): Promise<void> {
  if (response !== 'accepted' && response !== 'dismissed') {
    throw new ServiceError('invalid_response', 'Accept or dismiss the suggestion.', { response })
  }
  const { db } = ctx
  const row = await db.suggestions.get(id)
  if (!row) throw notFound(id)
  // Accepting a deload (or its end) goes through the same checks as the dedicated commands.
  if (response === 'accepted' && (row.kind === 'deload' || row.kind === 'deload_end')) {
    await assertDeloadActive(ctx, row.kind === 'deload_end')
  }
  const now = ctx.now()
  await db.transaction('rw', db.suggestions, async () => {
    const current = await db.suggestions.get(id)
    if (!current) throw notFound(id)
    assertUnanswered(current)
    await db.suggestions.update(id, { status: response, respondedAt: now })
    if (response === 'accepted' && current.kind === 'deload') {
      await closeShownDeloads(ctx, current.id, now)
    }
  })
}

/**
 * Accept a deload suggestion (creating its row if it was never recorded). The training model then
 * reports the deload active until its sessions are done or it is ended. Every other deload
 * suggestion still shown is accepted with it (however a deload starts). Returns the row id.
 */
export async function acceptDeload(
  ctx: ServiceCtx,
  input: { key: string; payload?: Readonly<Record<string, unknown>> },
): Promise<string> {
  checkInput({ kind: 'deload', ...input })
  await assertDeloadActive(ctx, false)
  return acceptRow(ctx, { kind: 'deload', key: input.key, payload: input.payload })
}

/** End the running deload early. Returns the 'deload_end' row id. */
export async function endDeload(ctx: ServiceCtx): Promise<string> {
  const acceptedAt = await assertDeloadActive(ctx, true)
  return acceptRow(ctx, {
    kind: 'deload_end',
    key: `deload_end;${ctx.now()}`,
    payload: { deloadAcceptedAt: acceptedAt },
  })
}

/** Start a deload by hand ("suggest deload" button). Returns the 'deload' row id. */
export async function startManualDeload(ctx: ServiceCtx): Promise<string> {
  return acceptDeload(ctx, { key: `manual;${ctx.now()}`, payload: { manual: true } })
}

/** The logged suggestion with this key, if any (for hiding already-answered suggestions). */
export async function suggestionByKey(
  ctx: Pick<ServiceCtx, 'db'>,
  key: string,
): Promise<Suggestion | null> {
  return (await ctx.db.suggestions.where('key').equals(key).first()) ?? null
}

async function acceptRow(ctx: ServiceCtx, input: SuggestionInput): Promise<string> {
  const { db } = ctx
  const id = ctx.newId()
  const now = ctx.now()
  return db.transaction('rw', db.suggestions, async () => {
    const existing = await db.suggestions.where('key').equals(input.key).first()
    let rowId = id
    if (existing) {
      assertSameKind(existing, input.kind)
      assertUnanswered(existing)
      await db.suggestions.update(existing.id, { status: 'accepted', respondedAt: now })
      rowId = existing.id
    } else {
      await db.suggestions.add({
        id,
        kind: input.kind,
        key: input.key,
        status: 'accepted',
        payload: { ...input.payload },
        firstShownAt: now,
        respondedAt: now,
      })
    }
    if (input.kind === 'deload') await closeShownDeloads(ctx, rowId, now)
    return rowId
  })
}

/**
 * A deload has just started (row `startedId`): every other deload suggestion still 'shown' is
 * answered as accepted too, since the deload covers it. Otherwise the same stale trigger would be
 * offered again as soon as the deload ends, depending on which button started it. Runs inside
 * the caller's suggestions transaction.
 */
async function closeShownDeloads(
  ctx: Pick<ServiceCtx, 'db'>,
  startedId: string,
  now: number,
): Promise<void> {
  await ctx.db.suggestions
    .where('kind')
    .equals('deload')
    .filter((s) => s.status === 'shown' && s.id !== startedId)
    .modify({ status: 'accepted', respondedAt: now })
}

/**
 * Starting a deload needs none running; ending one needs one running. Returns when the running
 * deload was accepted (null when none).
 */
async function assertDeloadActive(ctx: ServiceCtx, wanted: boolean): Promise<number | null> {
  const { status, acceptedAt } = (await loadTrainingModel(ctx)).deloadState()
  if (status.active && !wanted) {
    throw new ServiceError('deload_active', 'A deload is already running.', {
      remaining: status.remaining,
    })
  }
  if (!status.active && wanted) {
    throw new ServiceError('no_active_deload', 'No deload is running.')
  }
  return status.active ? acceptedAt : null
}

function checkInput(input: SuggestionInput): void {
  if (!SUGGESTION_KINDS.includes(input.kind)) {
    throw new ServiceError('invalid_kind', 'Unknown kind of suggestion.', { kind: input.kind })
  }
  if (typeof input.key !== 'string' || input.key.length === 0) {
    throw new ServiceError('invalid_key', 'A suggestion needs a key.')
  }
}

function assertSameKind(row: Suggestion, kind: SuggestionKind): void {
  if (row.kind !== kind) {
    throw new ServiceError('suggestion_key_conflict', 'That key belongs to another suggestion.', {
      key: row.key,
      kind: row.kind,
    })
  }
}

function assertUnanswered(row: Suggestion): void {
  if (row.status !== 'shown') {
    throw new ServiceError('suggestion_answered', 'That suggestion was already answered.', {
      id: row.id,
      status: row.status,
    })
  }
}

function notFound(id: string): ServiceError {
  return new ServiceError('suggestion_not_found', 'That suggestion no longer exists.', { id })
}
