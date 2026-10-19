import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { disposeCtx, renderScreen, type TestCtx } from '@/app/testing'
import type { LocalDate, Phase } from '@/domain/types'
import { createTestCtx } from '@/services/context'
import VolumeRampCard from './VolumeRampCard'

const ctxs: TestCtx[] = []
afterEach(async () => {
  for (const c of ctxs.splice(0)) await disposeCtx(c)
})

describe('VolumeRampCard', () => {
  it('offers the lagging muscles’ next set during a bulk and adds it on "Add set"', async () => {
    const c = createTestCtx({ seed: true, startMs: Date.UTC(2026, 10, 10, 12) })
    ctxs.push(c)
    await c.db.phases.add({
      id: 'bulk-1',
      type: 'bulk',
      startDate: '2026-09-01',
      endDate: null,
      status: 'active',
    } as Phase)
    renderScreen(<VolumeRampCard today={'2026-11-10' as LocalDate} />, { ctx: c })
    expect(await screen.findByText('Grow lagging muscles')).toBeInTheDocument()
    expect(screen.getByText('Lats')).toBeInTheDocument()
    expect(screen.getByText('Traps')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Add set' })[0]!)
    await waitFor(async () =>
      expect((await c.db.programSlots.get('slot-upper-lat-pulldown'))?.sets).toBe(4),
    )
    await waitFor(() => expect(screen.queryByText('Lats')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByText('Grow lagging muscles')).toBeNull())
    expect((await c.db.programSlots.get('slot-push-shrug'))?.sets).toBe(2)
  })
})
