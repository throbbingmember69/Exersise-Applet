// Spec acceptance: "Logging a session never changes a past session's data." Every row of a
// finished session (its session row, prescription snapshots and sets) is captured, then every
// logger and Edit-mode command is run against other sessions, and the rows are compared after
// each step. Edit mode on the session itself may change its session row and sets, but never its
// snapshots, and never another session.
import { afterEach, describe, expect, it } from 'vitest'
import type { Session, SessionExercise, SetLog } from '@/domain/types'
import { createTestCtx } from '../context'
import {
  addSet,
  editSession,
  editSet,
  restoreSession,
  restoreSet,
  voidSession,
  voidSetInEdit,
} from './edit'
import {
  abandonSession,
  addExercise,
  finishSession,
  logSet,
  removeExercise,
  startSession,
  swapExercise,
  updateSet,
  voidSet,
} from './session'

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

const MIN_MS = 60_000
const DAY_MS = 86_400_000

interface SessionRows {
  session: Session | undefined
  sessionExercises: SessionExercise[]
  setLogs: SetLog[]
}

/** Every row that belongs to a session: by session id, and any set pointing at its snapshots. */
async function rowsOf(c: Ctx, sessionId: string): Promise<SessionRows> {
  const { db } = c
  const sessionExercises = await db.sessionExercises.where('sessionId').equals(sessionId).toArray()
  const byId = new Map<string, SetLog>()
  for (const s of await db.setLogs.where('sessionId').equals(sessionId).toArray()) byId.set(s.id, s)
  const seIds = sessionExercises.map((se) => se.id)
  for (const s of await db.setLogs.where('sessionExerciseId').anyOf(seIds).toArray()) {
    byId.set(s.id, s)
  }
  return {
    session: await db.sessions.get(sessionId),
    sessionExercises: sessionExercises.sort((a, b) => a.id.localeCompare(b.id)),
    setLogs: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: 'ServiceError', code })
}

async function row(c: Ctx, sessionId: string, slotId: string): Promise<SessionExercise> {
  const found = (await c.db.sessionExercises.where('sessionId').equals(sessionId).toArray()).find(
    (r) => r.slotId === slotId,
  )
  if (!found) throw new Error(`no row for ${slotId}`)
  return found
}

/**
 * Finished session A: Lower A with a warm-up, a corrected set, a voided set, joint pain and a
 * note, so every kind of field is present.
 */
async function finishedSessionA(c: Ctx) {
  const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
  const squat = await row(c, id, 'slot-lower-a-1')
  const legExt = await row(c, id, 'slot-lower-a-2')
  const log = (seId: string, loadLb: number, reps: number, extra = {}) => {
    c.advance(MIN_MS)
    return logSet(c, { sessionExerciseId: seId, loadLb, reps, rir: 1, ...extra })
  }
  await log(squat.id, 135, 5, { isWarmup: true, rir: null })
  const setIds = [
    await log(squat.id, 220, 10),
    await log(squat.id, 220, 9),
    await log(squat.id, 220, 8),
    await log(squat.id, 2200, 8),
  ]
  await updateSet(c, setIds[3]!, { loadLb: 220, note: 'typo' })
  const extra = await log(squat.id, 220, 3)
  await voidSet(c, extra)
  for (const reps of [15, 13, 12]) await log(legExt.id, 170, reps, { rir: 0 })
  c.advance(10 * MIN_MS)
  await finishSession(c, id, { jointPain: true, note: 'left knee' })
  return { id, squat, legExt, setIds }
}

describe("Logging a session never changes a past session's data", () => {
  it('leaves every row of a finished session unchanged through later logging and edits', async () => {
    const c = ctx()
    const a = await finishedSessionA(c)
    const snapshotA = structuredClone(await rowsOf(c, a.id))
    expect(snapshotA.sessionExercises).toHaveLength(6)
    expect(snapshotA.setLogs).toHaveLength(9)
    const unchanged = async (step: string) =>
      expect(await rowsOf(c, a.id), step).toStrictEqual(snapshotA)

    // Session B: the same program day, so it replays A's tracks for its suggestions.
    c.advance(DAY_MS)
    const b = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    await unchanged('start B')
    const bSquat = await row(c, b, 'slot-lower-a-1')
    expect(bSquat.suggestion).toMatchObject({ loadLb: 220, branch: 'same_plus_rep' })
    const bSets: string[] = []
    for (const reps of [10, 10, 9, 9]) {
      bSets.push(await logSet(c, { sessionExerciseId: bSquat.id, loadLb: 220, reps, rir: 1 }))
      await unchanged('log a set in B')
    }
    await updateSet(c, bSets[2]!, { reps: 10, rir: 0, note: 'miscounted' })
    await unchanged('update a set in B')
    await voidSet(c, bSets[3]!)
    await unchanged('void a set in B')
    const bCurl = await row(c, b, 'slot-lower-a-3')
    const swapped = await swapExercise(c, bCurl.id, 'ex-leg-press')
    await unchanged('swap an exercise in B')
    await swapExercise(c, swapped, 'ex-seated-leg-curl')
    await unchanged('swap it back in B')
    const shrug = await addExercise(c, b, 'ex-barbell-shrug')
    await unchanged('add an exercise to B')
    await logSet(c, { sessionExerciseId: shrug, loadLb: 135, reps: 12 })
    await unchanged('log a finisher set in B')
    await removeExercise(c, (await row(c, b, 'slot-lower-a-6')).id)
    await unchanged('remove an exercise from B')
    await finishSession(c, b, { note: 'good', jointPain: false })
    await unchanged('finish B')

    // Session C, abandoned.
    c.advance(DAY_MS)
    const cId = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    await logSet(c, {
      sessionExerciseId: (await row(c, cId, 'slot-lower-a-1')).id,
      loadLb: 230,
      reps: 4,
    })
    await unchanged('start C and log')
    await abandonSession(c, cId)
    await unchanged('abandon C')

    // Void and restore B.
    c.advance(MIN_MS)
    await voidSession(c, b)
    await unchanged('void B')
    await restoreSession(c, b)
    await unchanged('restore B')

    // Edit mode on B.
    await editSet(c, bSets[0]!, { loadLb: 225, reps: 9, rir: 2, isWarmup: false, note: 'x' })
    await unchanged('edit a set of B')
    const added = await addSet(c, { sessionExerciseId: bSquat.id, loadLb: 220, reps: 8 })
    await unchanged('add a set to B')
    await voidSetInEdit(c, added)
    await unchanged('void a set of B in Edit mode')
    await restoreSet(c, bSets[3]!)
    await unchanged('restore a set of B')
    await editSession(c, b, {
      note: 'edited',
      jointPain: true,
      isDeload: true,
      bodyweightLb: 170,
      status: 'abandoned',
    })
    await unchanged('edit B')
    await editSession(c, b, { status: 'finished', isDeload: false })
    await unchanged('edit B back')
    // And C in Edit mode.
    await editSession(c, cId, { status: 'finished' })
    await unchanged('mark C finished')
  })

  it("Edit mode on a session never changes its snapshots, nor any other session's rows", async () => {
    const c = ctx()
    const a = await finishedSessionA(c)
    c.advance(DAY_MS)
    const b = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    await logSet(c, {
      sessionExerciseId: (await row(c, b, 'slot-lower-a-1')).id,
      loadLb: 220,
      reps: 10,
    })
    await finishSession(c, b)
    const aSnapshots = structuredClone((await rowsOf(c, a.id)).sessionExercises)
    const snapshotB = structuredClone(await rowsOf(c, b))
    const check = async (step: string) => {
      expect((await rowsOf(c, a.id)).sessionExercises, step).toStrictEqual(aSnapshots)
      expect(await rowsOf(c, b), step).toStrictEqual(snapshotB)
    }

    c.advance(MIN_MS)
    await editSet(c, a.setIds[0]!, { loadLb: 230, reps: 6, rir: 0, isWarmup: true, note: 'x' })
    await check('edit a set of A')
    const added = await addSet(c, { sessionExerciseId: a.legExt.id, loadLb: 175, reps: 10 })
    await check('add a set to A')
    await voidSetInEdit(c, added)
    await check('void a set of A')
    await restoreSet(c, added)
    await check('restore a set of A')
    await editSession(c, a.id, {
      note: 'n',
      jointPain: false,
      isDeload: true,
      bodyweightLb: null,
      status: 'abandoned',
    })
    await check('edit A')
    await voidSession(c, a.id)
    await check('void A')
    await restoreSession(c, a.id)
    await check('restore A')

    // The session row and sets did change, and each change is stamped.
    const after = await rowsOf(c, a.id)
    expect(after.session).toMatchObject({
      status: 'abandoned',
      isDeload: true,
      editedAt: c.now(),
      voidedAt: null,
    })
    expect(after.setLogs.find((s) => s.id === a.setIds[0])).toMatchObject({
      loadLb: 230,
      editedAt: c.now(),
    })
  })

  it('rejects commands aimed across sessions', async () => {
    const c = ctx()
    const a = await finishedSessionA(c)
    c.advance(DAY_MS)
    const d = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    const dRow = await row(c, d, 'slot-push-1')
    const dSet = await logSet(c, { sessionExerciseId: dRow.id, loadLb: 70, reps: 8 })
    const snapshotA = structuredClone(await rowsOf(c, a.id))
    const snapshotD = structuredClone(await rowsOf(c, d))

    // Logger commands can't reach into the finished session A.
    await expectCode(
      logSet(c, { sessionExerciseId: a.squat.id, loadLb: 220, reps: 10 }),
      'session_not_in_progress',
    )
    await expectCode(updateSet(c, a.setIds[0]!, { reps: 10 }), 'session_not_in_progress')
    await expectCode(voidSet(c, a.setIds[0]!), 'session_not_in_progress')
    await expectCode(swapExercise(c, a.squat.id, 'ex-leg-press'), 'session_not_in_progress')
    await expectCode(removeExercise(c, a.legExt.id), 'session_not_in_progress')
    await expectCode(addExercise(c, a.id, 'ex-barbell-shrug'), 'session_not_in_progress')
    await expectCode(finishSession(c, a.id), 'session_not_in_progress')
    await expectCode(abandonSession(c, a.id), 'session_not_in_progress')
    // Edit mode can't reach into the in-progress session D.
    await expectCode(editSet(c, dSet, { reps: 9 }), 'session_not_editable')
    await expectCode(
      addSet(c, { sessionExerciseId: dRow.id, loadLb: 70, reps: 8 }),
      'session_not_editable',
    )
    await expectCode(voidSetInEdit(c, dSet), 'session_not_editable')
    await expectCode(editSession(c, d, { note: 'x' }), 'session_not_editable')
    await expectCode(voidSession(c, d), 'session_not_editable')
    expect(await rowsOf(c, a.id)).toStrictEqual(snapshotA)
    expect(await rowsOf(c, d)).toStrictEqual(snapshotD)

    // Inconsistent rows (a set whose session and snapshot disagree) are refused, never written
    // through. One claims session D but points at A's snapshot; the other the reverse.
    const base = (await c.db.setLogs.get(dSet))!
    await c.db.setLogs.bulkAdd([
      {
        ...base,
        id: 'bad-1',
        sessionId: d,
        sessionExerciseId: a.squat.id,
        exerciseId: 'ex-smith-squat',
      },
      { ...base, id: 'bad-2', sessionId: a.id, sessionExerciseId: dRow.id },
    ])
    const before = structuredClone(await c.db.setLogs.toArray())
    await expectCode(updateSet(c, 'bad-1', { reps: 1 }), 'session_mismatch')
    await expectCode(voidSet(c, 'bad-1'), 'session_mismatch')
    await expectCode(editSet(c, 'bad-2', { reps: 1 }), 'session_mismatch')
    await expectCode(voidSetInEdit(c, 'bad-2'), 'session_mismatch')
    await expectCode(restoreSet(c, 'bad-2'), 'session_mismatch')
    expect(await c.db.setLogs.toArray()).toStrictEqual(before)
    expect((await rowsOf(c, a.id)).sessionExercises).toStrictEqual(snapshotA.sessionExercises)
    expect(await c.db.sessions.get(a.id)).toStrictEqual(snapshotA.session)
  })
})
