import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { disposeCtx, renderScreen, type TestCtx } from '@/app/testing'
import { createTestCtx } from '@/services/context'
import ScaleImportCard from './ScaleImportCard'

const ctxs: TestCtx[] = []
afterEach(async () => {
  for (const c of ctxs.splice(0)) await disposeCtx(c)
})

const CSV =
  'Time,Weight(lb),Body Fat(%),Muscle Mass(lb)\n' +
  '2026-09-25 07:05,162.8,14.2,131.9\n' +
  '2026-09-25 19:40,164.0,14.8,132.3\n' +
  '2026-09-26 07:00,163.0,14.1,132.0\n'

describe('ScaleImportCard', () => {
  it('previews a scale export and imports the earliest reading per day', async () => {
    const ctx = createTestCtx({ startMs: Date.UTC(2026, 9, 1, 18) })
    ctxs.push(ctx)
    renderScreen(<ScaleImportCard />, { ctx })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File([CSV], 'arboleaf.csv', { type: 'text/csv' }))

    expect(await screen.findByText(/dates read as year-month-day/)).toBeInTheDocument()
    expect(screen.getByText('2 new')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 days' }))

    await waitFor(async () => {
      expect((await ctx.db.bodyEntries.get('2026-09-25' as never))?.weightLb).toBe(162.8)
    })
    expect((await ctx.db.bodyEntries.get('2026-09-26' as never))?.muscleMassLb).toBe(132)
    expect(await screen.findByRole('button', { name: 'Nothing new to import' })).toBeDisabled()
  })
})
