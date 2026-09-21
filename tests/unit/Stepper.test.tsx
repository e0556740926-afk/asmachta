import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Stepper } from '../../src/components/ui/Stepper'

describe('Stepper', () => {
  const steps = ['פרטים', 'העלאה', 'סקירה', 'סיום']

  it('renders every step label', () => {
    render(<Stepper steps={steps} current={0} />)
    for (const label of steps) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('marks steps before `current` as done with a checkmark', () => {
    render(<Stepper steps={steps} current={2} />)
    const checkmarks = screen.getAllByText('✓')
    expect(checkmarks).toHaveLength(2)
  })
})
