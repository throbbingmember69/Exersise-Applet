import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LocalDate } from '@/domain/types'
import LineChart from './LineChart'

describe('LineChart', () => {
  it('renders an accessible figure without crashing where canvas is unavailable', () => {
    render(
      <LineChart
        label="Trend weight, last 30 days"
        dates={['2026-09-24', '2026-09-25'] as LocalDate[]}
        series={[{ label: 'Trend', values: [163, 163.1] }]}
      />,
    )
    expect(screen.getByRole('img', { name: 'Trend weight, last 30 days' })).toBeInTheDocument()
  })
})
