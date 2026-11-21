import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDate, Phase } from '@/domain/types'
import { createTestCtx } from '../context'
import { isServiceError } from '../errors'
import { updateMuscle } from '../program/commands'
import { acceptVolumeRamp, dismissVolumeRamp, getVolumeRamps } from './ramp'

type Ctx = ReturnType<typeof createTestCtx>
const ctxs: Ctx[] = []
const DAY = 86_400_000
/** 2026-11-10 noon UTC: three weeks after Lats/Traps started being tracked (2026-10-19). */
const NOV_10 = Date.UTC(2026, 10, 10, 12)

function ctx(): Ctx {
  const c = createTestCtx({ seed: true, startMs: NOV_10 }) // the live seed: back focus included
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) {
    c.db.close()
    await c.db.delete()
  }
})

const d = (s: string) => s as LocalDate

/** A running phase (only the fields the ramp reads matter). */
async function phase(c: Ctx, type: Phase['type'], startDate: string) {
  await c.db.phases.add({
    id: `phase-${type}`,
    type,
    startDate,
    endDate: null,
    status: 'active',
  } as Phase)
}

describe('volume ramp prompts', () => {
  it('only appear during a bulk', async () => {
    const c = ctx()
    expect(await getVolumeRamps(c, { today: d('2026-11-10') })).toEqual([])
    await phase(c, 'cut', '2026-09-01')
    expect(await getVolumeRamps(c, { today: d('2026-11-10') })).toEqual([])
  })

  it('are due three weeks after tracking starts, one per lagging muscle, on the least-loaded day', async () => {
    const c = ctx()
    await phase(c, 'bulk', '2026-09-01')
    // Lats and Traps count from 2026-10-19 (the update): not due on 11-08, due from 11-09.
    expect(await getVolumeRamps(c, { today: d('2026-11-08') })).toEqual([])
    const ramps = await getVolumeRamps(c, { today: d('2026-11-10') })
    expect(
      ramps.map((r) => [r.muscleName, r.exerciseName, r.dayName, r.fromSets, r.toSets]),
    ).toEqual([
      // Lats: Upper has 4.5 lat sets vs Pull's 7.5, so the Upper pulldown takes it.
      ['Lats', 'Lat pulldown', 'Upper', 3, 4],
      // Traps: 2 sets each on Push, Pull and Upper; the first in the week goes first.
      ['Traps', 'DB shrug', 'Push', 2, 3],
    ])
    expect(ramps[0]).toMatchObject({ plannedNow: 12, plannedAfter: 13, bandMax: 20 })
    expect(ramps[1]).toMatchObject({ plannedNow: 6, plannedAfter: 7, bandMax: 16 })
  })

  it('accepting adds the set and logs it; the next prompt for that muscle waits three weeks', async () => {
    const c = ctx()
    await phase(c, 'bulk', '2026-09-01')
    const [lats] = await getVolumeRamps(c, { today: d('2026-11-10') })
    await acceptVolumeRamp(c, {
      muscleId: 'back',
      slotId: lats!.slotId,
      fromSets: 3,
      dueDate: lats!.dueDate,
    })
    expect((await c.db.programSlots.get('slot-upper-lat-pulldown'))?.sets).toBe(4)
    expect(await c.db.suggestions.toArray()).toMatchObject([
      { kind: 'volume_ramp', status: 'accepted', payload: { muscleId: 'back', fromSets: 3 } },
    ])
    expect((await getVolumeRamps(c, { today: d('2026-11-10') })).map((r) => r.muscleId)).toEqual([
      'traps',
    ])
    c.setNow(NOV_10 + 21 * DAY)
    const next = await getVolumeRamps(c, { today: d('2026-12-01') })
    expect(next.find((r) => r.muscleId === 'back')).toMatchObject({
      exerciseName: 'Lat pulldown',
      fromSets: 4,
      plannedNow: 13,
    })
  })

  it('declining logs it without touching the program', async () => {
    const c = ctx()
    await phase(c, 'bulk', '2026-09-01')
    await dismissVolumeRamp(c, {
      muscleId: 'traps',
      slotId: 'slot-push-shrug',
      fromSets: 2,
      dueDate: d('2026-11-09'),
    })
    expect((await c.db.programSlots.get('slot-push-shrug'))?.sets).toBe(2)
    expect((await getVolumeRamps(c, { today: d('2026-11-10') })).map((r) => r.muscleId)).toEqual([
      'back',
    ])
    await expect(
      dismissVolumeRamp(c, {
        muscleId: 'traps',
        slotId: 'slot-push-shrug',
        fromSets: 2,
        dueDate: d('2026-11-09'),
      }),
    ).rejects.toSatisfy((e) => isServiceError(e, 'already_answered'))
  })

  it('come back the next cycle after "Not now", even for the same slot and set count', async () => {
    const c = ctx()
    await phase(c, 'bulk', '2026-09-01')
    await dismissVolumeRamp(c, {
      muscleId: 'traps',
      slotId: 'slot-push-shrug',
      fromSets: 2,
      dueDate: d('2026-11-09'),
    })
    c.setNow(NOV_10 + 21 * DAY)
    const next = await getVolumeRamps(c, { today: d('2026-12-01') })
    expect(next.find((r) => r.muscleId === 'traps')).toMatchObject({
      exerciseName: 'DB shrug',
      fromSets: 2,
      dueDate: '2026-12-01',
    })
  })

  it('stop at the band ceiling and refuse a prompt that no longer matches the program', async () => {
    const c = ctx()
    await phase(c, 'bulk', '2026-09-01')
    await updateMuscle(c, 'traps', { bandMax: 6 })
    expect((await getVolumeRamps(c, { today: d('2026-11-10') })).map((r) => r.muscleId)).toEqual([
      'back',
    ])
    await expect(
      acceptVolumeRamp(c, {
        muscleId: 'back',
        slotId: 'slot-upper-lat-pulldown',
        fromSets: 2,
        dueDate: d('2026-11-09'),
      }),
    ).rejects.toSatisfy((e) => isServiceError(e, 'stale_ramp'))
    expect((await c.db.programSlots.get('slot-upper-lat-pulldown'))?.sets).toBe(3)
  })
})
