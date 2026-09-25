import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ServiceError } from '@/services/errors'
import { loadProfile, updateProfile } from '@/services/settings'
import { useCommand, useLive, useToday, useUnits } from './hooks'
import { disposeCtx, renderScreen, type TestCtx } from './testing'

const ctxs: TestCtx[] = []
afterEach(async () => {
  for (const c of ctxs.splice(0)) await disposeCtx(c)
})

function track<T extends { ctx: TestCtx }>(r: T): T {
  ctxs.push(r.ctx)
  return r
}

function ProfileName() {
  const { data, loading } = useLive((ctx) => loadProfile(ctx), [])
  const units = useUnits()
  const today = useToday()
  if (loading) return <p>loading</p>
  return (
    <p>
      height {data?.heightIn} units {units} today {today}
    </p>
  )
}

function Commands() {
  const ok = useCommand((ctx) => updateProfile(ctx, { units: 'kg' }), { success: 'Saved' })
  const bad = useCommand(async () => {
    throw new ServiceError('nope', 'That is not allowed')
  })
  return (
    <>
      <button onClick={() => void ok.run()}>ok</button>
      <button onClick={() => void bad.run()}>bad</button>
      <ProfileName />
    </>
  )
}

describe('app hooks', () => {
  it('reads live data, units and today from the service context', async () => {
    track(renderScreen(<ProfileName />))
    expect(await screen.findByText('height 71 units lb today 2026-09-24')).toBeInTheDocument()
  })

  it('re-renders when a command changes the data, and toasts success and ServiceErrors', async () => {
    track(renderScreen(<Commands />))
    await screen.findByText(/units lb/)
    await userEvent.click(screen.getByRole('button', { name: 'ok' }))
    await waitFor(() => expect(screen.getByText(/units kg/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'bad' }))
    expect(await screen.findByRole('button', { name: 'That is not allowed' })).toBeInTheDocument()
  })
})
