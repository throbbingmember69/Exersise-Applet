import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { disposeCtx, renderScreen, type TestCtx } from '@/app/testing'
import { makeStrXlsx } from '@/domain/xlsxTestFixtures'
import { createTestCtx } from '@/services/context'
import { saveWeighIn } from '@/services/nutrition/body'
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

  it('reads the Arboleaf Excel export and replaces a day typed by hand unless kept', async () => {
    const ctx = createTestCtx({ startMs: Date.UTC(2026, 9, 1, 18) })
    ctxs.push(ctx)
    await saveWeighIn(ctx, { date: '2026-09-22', weightLb: 170, confirmed: true })
    renderScreen(<ScaleImportCard />, { ctx })
    const xlsx = makeStrXlsx([
      ['Measure Time', 'Weight(lb)', 'Body Fat(%)', 'Muscle Mass(lb)', 'Device Name'],
      ['09/26/2026 08:31:01', '163.7', '14.4', '133.1', 'Scale'],
      ['09/26/2026 08:30:40', '163.7', '- -', '- -', 'Scale'],
      ['09/22/2026 05:49:27', '163.5', '14.3', '132.9', 'Scale'],
    ])
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(
      input,
      new File([xlsx as Uint8Array<ArrayBuffer>], 'Body Composition-arboleaf.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )

    expect(await screen.findByText(/dates read as month\/day\/year/)).toBeInTheDocument()
    expect(screen.getByText('1 new')).toBeInTheDocument()
    expect(screen.getByText('1 update')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Keep days I entered by hand/ }))
    expect(await screen.findByText('1 kept yours')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Keep days I entered by hand/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 2 days' }))

    await waitFor(async () => {
      // The weight-only reading (08:30:40) is the earliest; body fat comes from 08:31:01.
      expect(await ctx.db.bodyEntries.get('2026-09-26' as never)).toMatchObject({
        weightLb: 163.7,
        bodyFatPct: 14.4,
        muscleMassLb: 133.1,
      })
    })
    expect((await ctx.db.bodyEntries.get('2026-09-22' as never))?.weightLb).toBe(163.5)
  })
})
