import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { disposeCtx, renderScreen, type TestCtx } from '@/app/testing'
import { createTestCtx } from '@/services/context'
import { saveIntake } from '@/services/nutrition/intake'
import CronometerImportCard from './CronometerImportCard'

const ctxs: TestCtx[] = []
afterEach(async () => {
  for (const c of ctxs.splice(0)) await disposeCtx(c)
})

const CSV =
  'Date,Energy (kcal),Carbs (g),Net Carbs (g),Fat (g),Protein (g)\n' +
  '2026-09-25,2712,301,263,82,158\n' +
  '2026-09-26,2988,340,300,91,162\n'

describe('CronometerImportCard', () => {
  it('previews a Daily Nutrition export and imports it over typed values', async () => {
    const ctx = createTestCtx({ startMs: Date.UTC(2026, 9, 1, 18) })
    ctxs.push(ctx)
    await saveIntake(ctx, { date: '2026-09-26', kcal: 2000, steps: 8000 })
    renderScreen(<CronometerImportCard />, { ctx })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File([CSV], 'dailysummary.csv', { type: 'text/csv' }))

    expect(await screen.findByText(/found calories, protein, carbs, fat/)).toBeInTheDocument()
    expect(screen.getByText('1 new')).toBeInTheDocument()
    expect(screen.getByText('1 update')).toBeInTheDocument()
    expect(screen.getByText(/\(was 2,000 kcal\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 days' }))

    await waitFor(async () => {
      expect(await ctx.db.nutritionEntries.get('2026-09-26' as never)).toMatchObject({
        kcal: 2988,
        proteinG: 162,
        steps: 8000,
      })
    })
    expect((await ctx.db.nutritionEntries.get('2026-09-25' as never))?.kcal).toBe(2712)
    expect(await screen.findByRole('button', { name: 'Nothing new to import' })).toBeDisabled()
  })
})
