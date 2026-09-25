import { afterEach, describe, expect, it } from 'vitest'
import { createTestCtx } from '../context'
import { loadTrainingModel } from './model'
import { finishSession, startSession } from './session'
import {
  acceptDeload,
  endDeload,
  recordShown,
  respondSuggestion,
  startManualDeload,
  suggestionByKey,
} from './suggestions'

type Ctx = ReturnType<typeof createTestCtx>
const ctxs: Ctx[] = []
function ctx(): Ctx {
  const c = createTestCtx()
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

const DAY = 86_400_000

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: 'ServiceError', code })
}

async function deloadStatus(c: Ctx) {
  return (await loadTrainingModel(c)).deloadState().status
}

const STALL = {
  kind: 'stall' as const,
  key: 'stall;ex-weighted-chin-up|*;sess-9',
  payload: { exerciseId: 'ex-weighted-chin-up' },
}

describe('the suggestion log', () => {
  it('records a suggestion once, the first time it is shown', async () => {
    const c = ctx()
    const id = await recordShown(c, STALL)
    expect(await c.db.suggestions.get(id)).toEqual({
      id,
      kind: 'stall',
      key: STALL.key,
      status: 'shown',
      payload: STALL.payload,
      firstShownAt: c.now(),
      respondedAt: null,
    })
    c.advance(60_000)
    expect(await recordShown(c, { ...STALL, payload: { other: true } })).toBe(id)
    expect(await c.db.suggestions.count()).toBe(1)
    expect(await suggestionByKey(c, STALL.key)).toMatchObject({
      firstShownAt: c.now() - 60_000,
      payload: STALL.payload,
    })
    expect(await suggestionByKey(c, 'nope')).toBeNull()
  })

  it('keeps an answered suggestion’s status when it is shown again', async () => {
    const c = ctx()
    const id = await recordShown(c, STALL)
    c.advance(1000)
    await respondSuggestion(c, id, 'dismissed')
    expect(await c.db.suggestions.get(id)).toMatchObject({
      status: 'dismissed',
      respondedAt: c.now(),
    })
    expect(await recordShown(c, STALL)).toBe(id)
    expect((await c.db.suggestions.get(id))?.status).toBe('dismissed')
  })

  it('answers a suggestion only once', async () => {
    const c = ctx()
    const id = await recordShown(c, STALL)
    await respondSuggestion(c, id, 'accepted')
    await expectCode(respondSuggestion(c, id, 'dismissed'), 'suggestion_answered')
    await expectCode(respondSuggestion(c, 'nope', 'accepted'), 'suggestion_not_found')
    await expectCode(respondSuggestion(c, id, 'maybe' as never), 'invalid_response')
    expect((await c.db.suggestions.get(id))?.status).toBe('accepted')
  })

  it('validates the kind and key', async () => {
    const c = ctx()
    await expectCode(recordShown(c, { ...STALL, kind: 'nope' as never }), 'invalid_kind')
    await expectCode(recordShown(c, { ...STALL, key: '' }), 'invalid_key')
    await recordShown(c, STALL)
    await expectCode(recordShown(c, { ...STALL, kind: 'volume_ramp' }), 'suggestion_key_conflict')
  })
})

describe('deloads', () => {
  it('accepting a shown deload suggestion starts the deload', async () => {
    const c = ctx()
    const key = 'deload;joint_pain=a,b'
    const id = await recordShown(c, { kind: 'deload', key, payload: { reasons: ['joint_pain'] } })
    expect((await deloadStatus(c)).active).toBe(false)
    c.advance(1000)
    expect(await acceptDeload(c, { key })).toBe(id)
    expect(await c.db.suggestions.get(id)).toMatchObject({
      kind: 'deload',
      status: 'accepted',
      respondedAt: c.now(),
      payload: { reasons: ['joint_pain'] },
    })
    expect(await deloadStatus(c)).toEqual({ active: true, remaining: 5, total: 5 })
  })

  it('accepting an unrecorded deload creates an accepted row', async () => {
    const c = ctx()
    const id = await acceptDeload(c, { key: 'deload;stalls=a,b,c', payload: { n: 3 } })
    expect(await c.db.suggestions.get(id)).toEqual({
      id,
      kind: 'deload',
      key: 'deload;stalls=a,b,c',
      status: 'accepted',
      payload: { n: 3 },
      firstShownAt: c.now(),
      respondedAt: c.now(),
    })
    expect((await deloadStatus(c)).active).toBe(true)
  })

  it('accepting a deload through the log starts it as well', async () => {
    const c = ctx()
    const id = await recordShown(c, { kind: 'deload', key: 'deload;x' })
    await respondSuggestion(c, id, 'accepted')
    expect((await deloadStatus(c)).active).toBe(true)
    const other = await recordShown(c, { kind: 'deload', key: 'deload;y' })
    await expectCode(respondSuggestion(c, other, 'accepted'), 'deload_active')
    // Dismissing is always allowed.
    await respondSuggestion(c, other, 'dismissed')
  })

  it('refuses a second deload while one runs, or re-accepting an answered one', async () => {
    const c = ctx()
    await acceptDeload(c, { key: 'deload;a' })
    await expectCode(acceptDeload(c, { key: 'deload;b' }), 'deload_active')
    await expectCode(startManualDeload(c), 'deload_active')
    await endDeload(c)
    await expectCode(acceptDeload(c, { key: 'deload;a' }), 'suggestion_answered')
    const dismissed = await recordShown(c, { kind: 'deload', key: 'deload;c' })
    await respondSuggestion(c, dismissed, 'dismissed')
    await expectCode(acceptDeload(c, { key: 'deload;c' }), 'suggestion_answered')
    await recordShown(c, STALL)
    await expectCode(acceptDeload(c, { key: STALL.key }), 'suggestion_key_conflict')
  })

  it('ends a deload early with a deload_end row', async () => {
    const c = ctx()
    await expectCode(endDeload(c), 'no_active_deload')
    const acceptedAt = c.now()
    await startManualDeload(c)
    c.advance(DAY)
    const id = await endDeload(c)
    expect(await c.db.suggestions.get(id)).toEqual({
      id,
      kind: 'deload_end',
      key: `deload_end;${c.now()}`,
      status: 'accepted',
      payload: { deloadAcceptedAt: acceptedAt },
      firstShownAt: c.now(),
      respondedAt: c.now(),
    })
    expect((await deloadStatus(c)).active).toBe(false)
    await expectCode(endDeload(c), 'no_active_deload')
    // A new deload can start afterwards.
    c.advance(DAY)
    await startManualDeload(c)
    expect((await deloadStatus(c)).active).toBe(true)
  })

  it('starts a manual deload keyed by the time', async () => {
    const c = ctx()
    const id = await startManualDeload(c)
    expect(await c.db.suggestions.get(id)).toMatchObject({
      kind: 'deload',
      key: `manual;${c.now()}`,
      status: 'accepted',
      payload: { manual: true },
      respondedAt: c.now(),
    })
  })

  it('counts down finished deload sessions until the deload is over', async () => {
    const c = ctx()
    await startManualDeload(c)
    const days = ['day-lower-a', 'day-push', 'day-pull', 'day-lower-b', 'day-upper']
    for (const [i, day] of days.entries()) {
      c.advance(DAY)
      const id = await startSession(c, { gymId: 'gym-1', programDayId: day })
      expect((await c.db.sessions.get(id))?.isDeload).toBe(true)
      await finishSession(c, id)
      expect(await deloadStatus(c)).toMatchObject({
        active: i < 4,
        remaining: i < 4 ? 4 - i : 0,
      })
    }
    c.advance(DAY)
    const after = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    expect((await c.db.sessions.get(after))?.isDeload).toBe(false)
  })
})
