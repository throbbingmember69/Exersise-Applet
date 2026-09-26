// Screen-level acceptance tests (M3): settings are all editable; the logger pre-fills the
// suggestion and starts the rest timer; a finished session is read-only until Edit.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { disposeCtx, renderScreen, type TestCtx } from '@/app/testing'
import { SETTINGS_REGISTRY } from '@/domain/settings/registry'
import { createTestCtx } from '@/services/context'
import { loadSettings } from '@/services/settings'
import { getRestTimer } from '@/services/training/restTimerState'
import { finishSession, logSet, startSession } from '@/services/training/session'
import SessionDetail from './history/SessionDetail'
import Logger from './logger/Logger'
import Settings from './settings'

const ctxs: TestCtx[] = []
function ctx(): TestCtx {
  const c = createTestCtx()
  ctxs.push(c)
  return c
}
afterEach(async () => {
  for (const c of ctxs.splice(0)) await disposeCtx(c)
})

describe('Settings screen', () => {
  it('acceptance: every setting (all Heuristic ones included) is listed and editable', async () => {
    const c = ctx()
    renderScreen(<Settings />, { ctx: c, route: '/settings' })
    await screen.findByRole('heading', { name: 'Settings' })
    // Each row's accessible name starts with its label, directly followed by its value.
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    for (const m of SETTINGS_REGISTRY) {
      const row = names.find(
        (n) => n.startsWith(m.label) && /^(?: · changed)?\s*[-\d]/.test(n.slice(m.label.length)),
      )
      expect(row, m.label).toBeDefined()
    }
    // Edit one heuristic setting through the sheet.
    await userEvent.click(screen.getByRole('button', { name: /^Activity factor/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Activity factor' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Increase Activity factor' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await loadSettings(c)).activityFactor).toBe(1.6))
  })
})

describe('Logger screen', () => {
  it('pre-fills the suggested load and reps, logs a set and starts the rest timer', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    renderScreen(<Logger />, { ctx: c, route: '/train/session/:id', path: `/train/session/${id}` })
    const load = await screen.findByLabelText('Smith machine squat load (lb)')
    expect(load).toHaveValue('220')
    expect(screen.getByLabelText('Smith machine squat reps')).toHaveValue('6')
    const card = load.closest('section')!
    await userEvent.click(within(card).getByRole('button', { name: 'Log set 1' }))
    expect(await within(card).findByRole('button', { name: 'Edit set 1' })).toHaveTextContent(
      '220 lb × 6',
    )
    await waitFor(async () => expect((await getRestTimer(c))?.timer.restMinSec).toBe(120))
    expect(await screen.findByRole('timer')).toBeInTheDocument()
  })
})

describe('Session detail', () => {
  it('is read-only until Edit is confirmed', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const row = (await c.db.sessionExercises.where('sessionId').equals(id).first())!
    await logSet(c, { sessionExerciseId: row.id, loadLb: 220, reps: 8 })
    await finishSession(c, id, {})
    renderScreen(<SessionDetail />, {
      ctx: c,
      route: '/train/history/:id',
      path: `/train/history/${id}`,
    })
    const set = await screen.findByRole('button', { name: 'Set 1' })
    expect(set).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Edit this session?' })).getByRole(
        'button',
        { name: 'Edit' },
      ),
    )
    expect(await screen.findByRole('button', { name: 'Set 1, edit' })).toBeEnabled()
  })
})
