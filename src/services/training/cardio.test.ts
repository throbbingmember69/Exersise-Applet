import { afterEach, describe, expect, it } from 'vitest'
import { createTestCtx } from '../context'
import { isServiceError } from '../errors'
import {
  addCardioInEdit,
  editCardio,
  getCardioBlock,
  logCardio,
  restoreCardio,
  updateCardio,
  voidCardio,
  voidCardioInEdit,
} from './cardio'
import { finishSession, startSession } from './session'

type Ctx = ReturnType<typeof createTestCtx>
const ctxs: Ctx[] = []
// 2026-11-23 is a Monday (the default training-week start).
const MON = Date.UTC(2026, 10, 23, 17)
const DAY = 86_400_000
function ctx(): Ctx {
  const c = createTestCtx({ startMs: MON })
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

async function rejects(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => isServiceError(e, code))
}

/** A finished workout with that much cardio, on `day` days after Monday 2026-11-23. */
async function workoutWithCardio(c: Ctx, day: number, minutes: number, programDayId = 'day-push') {
  c.setNow(MON + day * DAY)
  const id = await startSession(c, { gymId: 'gym-1', programDayId })
  await logCardio(c, { sessionId: id, modality: 'incline_walk', minutes, intensity: 'easy' })
  await finishSession(c, id, {})
  return id
}

describe('logging cardio in the logger', () => {
  it('adds, corrects and voids entries of the in-progress session', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    const entry = await logCardio(c, {
      sessionId: id,
      modality: 'bike',
      minutes: 12,
      intensity: 'easy',
      avgHeartRate: 128,
    })
    expect(await c.db.cardioLogs.get(entry)).toMatchObject({
      sessionId: id,
      date: '2026-11-23',
      modality: 'bike',
      minutes: 12,
      intensity: 'easy',
      avgHeartRate: 128,
      note: '',
      editedAt: null,
      voidedAt: null,
    })
    await updateCardio(c, entry, { minutes: 15, intensity: 'moderate' })
    expect(await c.db.cardioLogs.get(entry)).toMatchObject({ minutes: 15, editedAt: null })
    await voidCardio(c, entry)
    expect((await c.db.cardioLogs.get(entry))?.voidedAt).toBe(MON)
    await rejects(updateCardio(c, entry, { minutes: 20 }), 'cardio_voided')
  })

  it('rejects bad values and read-only fields', async () => {
    const c = ctx()
    const sessionId = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    const base = { sessionId, modality: 'bike' as const, minutes: 10, intensity: 'easy' as const }
    await rejects(logCardio(c, { ...base, minutes: 0 }), 'invalid_cardio')
    await rejects(logCardio(c, { ...base, minutes: 12.5 }), 'invalid_cardio')
    await rejects(logCardio(c, { ...base, minutes: 181 }), 'invalid_cardio')
    await rejects(logCardio(c, { ...base, modality: 'swim' as never }), 'invalid_cardio')
    await rejects(logCardio(c, { ...base, intensity: 'max' as never }), 'invalid_cardio')
    await rejects(logCardio(c, { ...base, avgHeartRate: 20 }), 'invalid_cardio')
    const id = await logCardio(c, base)
    await rejects(updateCardio(c, id, { sessionId: 'x' } as never), 'field_not_editable')
    await rejects(logCardio(c, { ...base, sessionId: 'nope' }), 'session_not_found')
  })

  it('only writes to an in-progress session from the logger', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    const entry = await logCardio(c, {
      sessionId: id,
      modality: 'bike',
      minutes: 10,
      intensity: 'easy',
    })
    await finishSession(c, id, {})
    await rejects(
      logCardio(c, { sessionId: id, modality: 'bike', minutes: 10, intensity: 'easy' }),
      'session_not_in_progress',
    )
    await rejects(voidCardio(c, entry), 'session_not_in_progress')
  })
})

describe('cardio in Edit mode', () => {
  it('adds, edits, voids and restores entries of a finished session, stamping editedAt', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    await rejects(
      addCardioInEdit(c, { sessionId: id, modality: 'bike', minutes: 10, intensity: 'easy' }),
      'session_not_editable',
    )
    await finishSession(c, id, {})
    c.setNow(MON + DAY)
    const entry = await addCardioInEdit(c, {
      sessionId: id,
      modality: 'rower',
      minutes: 20,
      intensity: 'moderate',
      note: 'forgot to log',
    })
    expect(await c.db.cardioLogs.get(entry)).toMatchObject({
      date: '2026-11-23',
      editedAt: MON + DAY,
    })
    expect((await c.db.sessions.get(id))?.editedAt).toBe(MON + DAY)
    await editCardio(c, entry, { minutes: 25 })
    await voidCardioInEdit(c, entry)
    expect(await c.db.cardioLogs.get(entry)).toMatchObject({ minutes: 25, voidedAt: MON + DAY })
    await restoreCardio(c, entry)
    expect((await c.db.cardioLogs.get(entry))?.voidedAt).toBeNull()
    await rejects(restoreCardio(c, entry), 'cardio_not_voided')
  })
})

describe('getCardioBlock', () => {
  it('starts at 10 minutes, suggests the bike on a leg day and an incline walk otherwise', async () => {
    const c = ctx()
    const legs = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    expect(await getCardioBlock(c, legs)).toMatchObject({
      mode: 'log',
      target: { minutes: 10, weekStart: '2026-11-23', sessionsAtTarget: 0, sessionsNeeded: 3 },
      suggestedModality: 'bike',
      legDay: true,
      entries: [],
      totalMinutes: 0,
      metTarget: false,
    })
    await finishSession(c, legs, {})
    const push = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    expect(await getCardioBlock(c, push)).toMatchObject({
      suggestedModality: 'incline_walk',
      legDay: false,
    })
    expect(await getCardioBlock(c, 'missing')).toBeNull()
  })

  it('repeats the last machine on a non-leg day, and totals this session’s entries', async () => {
    const c = ctx()
    const first = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    await logCardio(c, { sessionId: first, modality: 'elliptical', minutes: 10, intensity: 'easy' })
    await finishSession(c, first, {})
    c.setNow(MON + DAY)
    const next = await startSession(c, { gymId: 'gym-1', programDayId: 'day-pull' })
    await logCardio(c, { sessionId: next, modality: 'bike', minutes: 6, intensity: 'easy' })
    const voided = await logCardio(c, {
      sessionId: next,
      modality: 'bike',
      minutes: 9,
      intensity: 'easy',
    })
    await voidCardio(c, voided)
    await logCardio(c, { sessionId: next, modality: 'bike', minutes: 5, intensity: 'easy' })
    const block = (await getCardioBlock(c, next))!
    expect(block.suggestedModality).toBe('elliptical')
    expect(block.entries.map((e) => e.minutes)).toEqual([6, 5])
    expect(block.voided.map((e) => e.minutes)).toEqual([9])
    expect([block.totalMinutes, block.metTarget]).toEqual([11, true])
  })

  it('ramps to 15 minutes the week after three workouts at 10', async () => {
    const c = ctx()
    for (const day of [0, 1, 2]) await workoutWithCardio(c, day, 10)
    c.setNow(MON + 7 * DAY)
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    const block = (await getCardioBlock(c, id))!
    expect(block.target).toMatchObject({ minutes: 15, weekStart: '2026-11-30' })
    expect(block.mode).toBe('log')
    await finishSession(c, id, {})
    expect((await getCardioBlock(c, id))?.mode).toBe('edit')
  })
})
