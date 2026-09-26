import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import ServicesProvider from './app/ServicesProvider'
import ToastProvider from './app/ToastProvider'
import { disposeCtx, type TestCtx } from './app/testing'
import { createTestCtx } from './services/context'

let ctx: TestCtx

function renderApp() {
  return render(
    <ServicesProvider ctx={ctx}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ServicesProvider>,
  )
}

describe('App shell', () => {
  beforeEach(() => {
    window.location.hash = '#/'
    ctx = createTestCtx()
  })
  afterEach(async () => {
    await disposeCtx(ctx)
  })

  it('renders Today with the bottom navigation', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const tab of ['Today', 'Train', 'Body', 'Food', 'More']) {
      expect(nav).toHaveTextContent(tab)
    }
  })

  it('navigates between tabs with hash routing', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Today' })
    await userEvent.click(screen.getByRole('link', { name: 'Train' }))
    expect(await screen.findByRole('heading', { name: 'Train' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/train')
    expect(screen.getByRole('link', { name: 'Train' })).toHaveAttribute('aria-current', 'page')
  })
})
