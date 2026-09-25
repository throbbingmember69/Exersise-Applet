import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

describe('App shell', () => {
  beforeEach(() => {
    window.location.hash = '#/'
  })

  it('renders Today with the bottom navigation', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const tab of ['Today', 'Train', 'Body', 'Food', 'More']) {
      expect(nav).toHaveTextContent(tab)
    }
  })

  it('navigates between tabs with hash routing', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Today' })
    await userEvent.click(screen.getByRole('link', { name: 'Train' }))
    expect(await screen.findByRole('heading', { name: 'Train' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/train')
    expect(screen.getByRole('link', { name: 'Train' })).toHaveAttribute('aria-current', 'page')
  })
})
