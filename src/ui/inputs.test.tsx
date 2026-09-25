import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { kgToLb } from '@/domain/units'
import type { UnitSystem } from '@/domain/types'
import MassInput from './MassInput'
import NumberStepper from './NumberStepper'
import RirChips from './RirChips'

function StepperHarness({ initial, decimals = 1 }: { initial: number | null; decimals?: number }) {
  const [v, setV] = useState<number | null>(initial)
  return (
    <>
      <NumberStepper label="Reps" value={v} onChange={setV} step={1} min={0} decimals={decimals} />
      <output data-testid="value">{v === null ? 'null' : String(v)}</output>
    </>
  )
}

function MassHarness({ initialLb, unit }: { initialLb: number; unit: UnitSystem }) {
  const [lb, setLb] = useState<number | null>(initialLb)
  return (
    <>
      <MassInput label="Load" valueLb={lb} onChangeLb={setLb} unit={unit} stepLb={10} />
      <output data-testid="lb">{lb === null ? 'null' : String(lb)}</output>
    </>
  )
}

describe('NumberStepper', () => {
  it('bumps by the step and respects min', async () => {
    render(<StepperHarness initial={1} decimals={0} />)
    await userEvent.click(screen.getByRole('button', { name: 'Increase Reps' }))
    expect(screen.getByTestId('value')).toHaveTextContent('2')
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Reps' }))
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Reps' }))
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Reps' }))
    expect(screen.getByTestId('value')).toHaveTextContent('0')
  })

  it('commits typed values on blur, accepting a comma decimal', async () => {
    render(<StepperHarness initial={null} />)
    const input = screen.getByLabelText('Reps')
    await userEvent.click(input)
    await userEvent.type(input, '37,5')
    await userEvent.tab()
    expect(screen.getByTestId('value')).toHaveTextContent('37.5')
  })

  it('clears to null when emptied and ignores garbage', async () => {
    render(<StepperHarness initial={8} />)
    const input = screen.getByLabelText('Reps')
    await userEvent.clear(input)
    await userEvent.tab()
    expect(screen.getByTestId('value')).toHaveTextContent('null')
    await userEvent.click(input)
    await userEvent.type(input, 'abc')
    await userEvent.tab()
    expect(screen.getByTestId('value')).toHaveTextContent('null')
  })
})

describe('MassInput', () => {
  it('shows lb and steps by the exercise step', async () => {
    render(<MassHarness initialLb={220} unit="lb" />)
    expect(screen.getByLabelText('Load (lb)')).toHaveValue('220')
    await userEvent.click(screen.getByRole('button', { name: 'Increase Load (lb)' }))
    expect(screen.getByTestId('lb')).toHaveTextContent('230')
  })

  it('displays kg but stores lb, keeping lb steps exact', async () => {
    render(<MassHarness initialLb={220} unit="kg" />)
    expect(screen.getByLabelText('Load (kg)')).toHaveValue('99.8')
    await userEvent.click(screen.getByRole('button', { name: 'Increase Load (kg)' }))
    expect(Number(screen.getByTestId('lb').textContent)).toBeCloseTo(230, 1)
  })

  it('converts a typed kg value to lb', async () => {
    render(<MassHarness initialLb={0} unit="kg" />)
    const input = screen.getByLabelText('Load (kg)')
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, '100')
    await userEvent.tab()
    expect(Number(screen.getByTestId('lb').textContent)).toBeCloseTo(kgToLb(100), 6)
    expect(input).toHaveValue('100')
  })
})

describe('RirChips', () => {
  it('selects and clears a value', async () => {
    function Harness() {
      const [v, setV] = useState<number | null>(null)
      return (
        <>
          <RirChips value={v} onChange={setV} />
          <output data-testid="rir">{String(v)}</output>
        </>
      )
    }
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '2' }))
    expect(screen.getByTestId('rir')).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '2' }))
    expect(screen.getByTestId('rir')).toHaveTextContent('null')
  })
})
