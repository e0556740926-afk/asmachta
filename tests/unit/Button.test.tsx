import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from '../../src/components/ui/Button'

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>שלום</Button>)
    expect(screen.getByText('שלום')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>לחצו כאן</Button>)
    fireEvent.click(screen.getByText('לחצו כאן'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        מנוטרל
      </Button>,
    )
    fireEvent.click(screen.getByText('מנוטרל'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
