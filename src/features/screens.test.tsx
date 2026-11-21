// Screen-level acceptance tests (M3): settings are all editable; the logger pre-fills the
// suggested load (reps are a hint) and starts the rest timer; a finished session is read-only
// until Edit.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disposeCtx, renderScreen, type TestCtx } from '@/app/testing'
import { SETTINGS_REGISTRY } from '@/domain/settings/registry'
import { FORM_GUIDES, GROWTH_CUES } from '@/seed'
import { createTestCtx } from '@/services/context'
import { loadSettings } from '@/services/settings'
import { getRestTimer } from '@/services/training/restTimerState'
import { finishSession, logSet, startSession } from '@/services/training/session'
import SessionDetail from './history/SessionDetail'
import Logger from './logger/Logger'
import DayEditor from './program/DayEditor'
import ExerciseEditor from './program/ExerciseEditor'
import Settings from './settings'
import Train from './train'

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
  it('pre-fills the suggested load, shows the rep target as a hint, logs a set and starts the rest timer', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    renderScreen(<Logger />, { ctx: c, route: '/train/session/:id', path: `/train/session/${id}` })
    const load = await screen.findByLabelText('Smith machine squat load (lb)')
    expect(load).toHaveValue('220')
    const reps = screen.getByLabelText('Smith machine squat reps')
    // The target is a placeholder, never a value: an untouched field can't log it.
    expect(reps).toHaveValue('')
    expect(reps).toHaveAttribute('placeholder', '6')
    const card = load.closest('section')!
    expect(within(card).getByRole('button', { name: 'Log set 1' })).toBeDisabled()
    await userEvent.click(within(card).getByRole('button', { name: 'Hit target (6)' }))
    expect(await within(card).findByRole('button', { name: 'Edit set 1' })).toHaveTextContent(
      '220 lb × 6',
    )
    await waitFor(async () => expect((await getRestTimer(c))?.timer.restMinSec).toBe(120))
    expect(await screen.findByRole('timer')).toBeInTheDocument()
  })

  it('logs typed reps, and − / + start from the target', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    renderScreen(<Logger />, { ctx: c, route: '/train/session/:id', path: `/train/session/${id}` })
    const reps = await screen.findByLabelText('Smith machine squat reps')
    const card = reps.closest('section')!
    await userEvent.click(
      within(card).getByRole('button', { name: 'Decrease Smith machine squat reps' }),
    )
    expect(reps).toHaveValue('5')
    // With reps entered, only "Log set" remains.
    expect(within(card).queryByRole('button', { name: /Hit target/ })).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: 'Log set 1' }))
    expect(await within(card).findByRole('button', { name: 'Edit set 1' })).toHaveTextContent(
      '220 lb × 5',
    )
    // The next set starts blank again.
    await waitFor(() => expect(reps).toHaveValue(''))
  })

  it('asks for missing RIR when finishing, without blocking it', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    const row = (await c.db.sessionExercises.where('sessionId').equals(id).first())!
    const first = await logSet(c, { sessionExerciseId: row.id, loadLb: 220, reps: 6 })
    await logSet(c, { sessionExerciseId: row.id, loadLb: 220, reps: 6, rir: 2 })
    renderScreen(<Logger />, { ctx: c, route: '/train/session/:id', path: `/train/session/${id}` })
    await userEvent.click(await screen.findByRole('button', { name: 'Finish workout' }))
    const sheet = await screen.findByRole('dialog', { name: 'Finish workout' })
    expect(
      within(sheet).getByText(
        '1 set has no RIR. Add reps in reserve if you remember them (optional).',
      ),
    ).toBeInTheDocument()
    const chips = within(sheet).getByRole('group', { name: 'Smith machine squat set 1 RIR' })
    await userEvent.click(within(chips).getByRole('button', { name: '1' }))
    await waitFor(async () => expect((await c.db.setLogs.get(first))?.rir).toBe(1))
    // The row stays, showing the new value.
    await waitFor(() =>
      expect(within(chips).getByRole('button', { name: '1' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    await userEvent.click(within(sheet).getByRole('button', { name: 'Finish' }))
    await waitFor(async () => expect((await c.db.sessions.get(id))?.status).toBe('finished'))
  })
})

describe('Optional exercises', () => {
  it('carry a badge in the logger and stay out of the planned-set count', async () => {
    const c = ctx()
    await c.db.programSlots.update('slot-lower-a-6', { optional: true })
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    renderScreen(<Logger />, { ctx: c, route: '/train/session/:id', path: `/train/session/${id}` })
    expect(await screen.findByText(/Gym 1 · 0 of 15 sets/)).toBeInTheDocument()
    const card = screen.getByRole('heading', { name: 'Cable crunch' }).closest('section')!
    expect(within(card).getByText('Optional')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /^Hit target/ }))
    expect(await screen.findByText(/0 of 15 sets · \+1 optional/)).toBeInTheDocument()
  })

  it('are switched on and off per slot in the program editor', async () => {
    const c = ctx()
    renderScreen(<DayEditor />, {
      ctx: c,
      route: '/program/day/:id',
      path: '/program/day/day-lower-a',
    })
    await userEvent.click(await screen.findByRole('button', { name: /^Cable crunch/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Cable crunch' })
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Optional/ }))
    await waitFor(async () =>
      expect((await c.db.programSlots.get('slot-lower-a-6'))?.optional).toBe(true),
    )
    // The sheet shows the saved value, and the slot list tags it.
    await waitFor(() =>
      expect(within(sheet).getByRole('checkbox', { name: /Optional/ })).toBeChecked(),
    )
    expect(
      await screen.findByRole('button', { name: /^Cable crunch\s+Optional/ }),
    ).toBeInTheDocument()
  })
})

describe('Cardio', () => {
  it('shows this week’s target after the exercises, suggests the bike on a leg day and logs it', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    renderScreen(<Logger />, { ctx: c, route: '/train/session/:id', path: `/train/session/${id}` })
    const card = (await screen.findByRole('heading', { name: 'Cardio' })).closest('section')!
    expect(within(card).getByText(/Bike suggested/)).toBeInTheDocument()
    expect(
      within(card).getByText('0 of 3 workouts at 10 min this week → 15 min next week.'),
    ).toBeInTheDocument()
    const machines = within(card).getByRole('group', { name: 'Cardio machine' })
    expect(within(machines).getByRole('button', { name: 'Bike' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(card).getByLabelText('Cardio minutes')).toHaveAttribute('placeholder', '10')
    await userEvent.click(within(card).getByRole('button', { name: 'Hit target (10 min)' }))
    expect(await within(card).findByText('Bike · 10 min · easy')).toBeInTheDocument()
    expect(within(card).getByText('Target met')).toBeInTheDocument()
    expect(await c.db.cardioLogs.count()).toBe(1)
  })

  it('logs typed minutes on another machine, and can be removed', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    renderScreen(<Logger />, { ctx: c, route: '/train/session/:id', path: `/train/session/${id}` })
    const card = (await screen.findByRole('heading', { name: 'Cardio' })).closest('section')!
    expect(within(card).queryByText(/Bike suggested/)).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: 'Elliptical' }))
    await userEvent.click(within(card).getByRole('button', { name: 'Moderate' }))
    await userEvent.click(within(card).getByRole('button', { name: 'Increase Cardio minutes' }))
    await userEvent.click(within(card).getByRole('button', { name: 'Log cardio' }))
    const entry = await within(card).findByText('Elliptical · 11 min · moderate')
    expect(entry).toBeInTheDocument()
    await userEvent.click(
      within(card).getByRole('button', { name: 'Remove Elliptical · 11 min · moderate' }),
    )
    await waitFor(() =>
      expect(within(card).queryByText('Elliptical · 11 min · moderate')).toBeNull(),
    )
  })

  it('is added in a past session’s Edit mode', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-push' })
    await finishSession(c, id, {})
    renderScreen(<SessionDetail />, {
      ctx: c,
      route: '/train/history/:id',
      path: `/train/history/${id}`,
    })
    await screen.findByRole('button', { name: 'Edit' })
    // Read-only and empty: no cardio card.
    expect(screen.queryByRole('heading', { name: 'Cardio' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Edit this session?' })).getByRole(
        'button',
        { name: 'Edit' },
      ),
    )
    const card = (await screen.findByRole('heading', { name: 'Cardio' })).closest('section')!
    await userEvent.click(within(card).getByRole('button', { name: 'Hit target (10 min)' }))
    expect(await within(card).findByText('Incline walk · 10 min · easy')).toBeInTheDocument()
    expect((await c.db.cardioLogs.toArray())[0]?.editedAt).not.toBeNull()
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

describe('Form guides', () => {
  it('open from an exercise card during a workout: cues and the curated video', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    renderScreen(<Logger />, { ctx: c, route: '/train/session/:id', path: `/train/session/${id}` })
    // The card shows the first growth cue without opening the sheet.
    expect(
      await screen.findByText(GROWTH_CUES['ex-smith-squat']![0]!.cue, { selector: 'div' }),
    ).toBeInTheDocument()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Form guide for Smith machine squat' }),
    )
    const sheet = await screen.findByRole('dialog', { name: 'Form: Smith machine squat' })
    // Growth cues come first, each with its reason.
    const growth = within(sheet).getByRole('region', { name: 'For growth' })
    for (const g of GROWTH_CUES['ex-smith-squat']!) {
      expect(within(growth).getByText(g.cue)).toBeInTheDocument()
      expect(within(growth).getByText(g.why)).toBeInTheDocument()
    }
    const guide = FORM_GUIDES['ex-smith-squat']!
    for (const cue of guide.cues) expect(within(sheet).getByText(cue)).toBeInTheDocument()
    // The video plays inside the app; nothing loads from YouTube until it's tapped.
    expect(sheet.querySelector('iframe')).toBeNull()
    await userEvent.click(within(sheet).getByRole('button', { name: `Play video: ${guide.title}` }))
    const player = sheet.querySelector('iframe')!
    expect(player.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/fEuYM-miK5U?rel=0&playsinline=1&modestbranding=1&autoplay=1',
    )
    expect(player).toHaveAttribute('title', guide.title)
    expect(player).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    // Still one tap from the YouTube app, in case a video won't play embedded.
    const link = within(sheet).getByRole('link', { name: /Open in YouTube/ })
    expect(link).toHaveAttribute('href', guide.videoUrl)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('explain that the video needs a connection when offline (the cues still show)', async () => {
    const c = ctx()
    const id = await startSession(c, { gymId: 'gym-1', programDayId: 'day-lower-a' })
    renderScreen(<Logger />, { ctx: c, route: '/train/session/:id', path: `/train/session/${id}` })
    await userEvent.click(
      await screen.findByRole('button', { name: 'Form guide for Smith machine squat' }),
    )
    const sheet = await screen.findByRole('dialog', { name: 'Form: Smith machine squat' })
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      await userEvent.click(within(sheet).getByRole('button', { name: /^Play video/ }))
      expect(within(sheet).getByRole('status')).toHaveTextContent(/needs an internet connection/)
      expect(sheet.querySelector('iframe')).toBeNull()
    } finally {
      online.mockRestore()
    }
  })

  it('are one tap from the Train menu’s Exercises entry', async () => {
    renderScreen(<Train />, { ctx: ctx(), route: '/train' })
    expect(await screen.findByRole('link', { name: /Exercises/ })).toHaveAttribute(
      'href',
      '/program/exercises?from=train',
    )
  })

  it('show on the exercise page, where the user can set their own link', async () => {
    const c = ctx()
    renderScreen(<ExerciseEditor />, {
      ctx: c,
      route: '/program/exercises/:id',
      path: '/program/exercises/ex-leg-press?from=train',
    })
    const link = await screen.findByRole('link', { name: /Open in YouTube/ })
    expect(link).toHaveAttribute('href', FORM_GUIDES['ex-leg-press']!.videoUrl)
    expect(screen.getByRole('button', { name: /^Play video/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute(
      'href',
      '/program/exercises?from=train',
    )
    const input = screen.getByLabelText('Your form video link')
    await userEvent.type(input, 'https://www.youtube.com/watch?v=abcdefghijk')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () =>
      expect((await c.db.exercises.get('ex-leg-press'))?.formUrl).toBe(
        'https://www.youtube.com/watch?v=abcdefghijk',
      ),
    )
  })
})
