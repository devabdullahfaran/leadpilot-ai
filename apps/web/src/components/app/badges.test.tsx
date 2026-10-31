import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PriorityBadge, SampleBadge } from './badges'
import { ScoreBadge, ScoreBar } from './score'

describe('PriorityBadge', () => {
  it('renders the priority label', () => {
    render(<PriorityBadge priority="high" />)
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByTitle('High priority')).toBeInTheDocument()
  })

  it('renders "Unscored" when there is no priority', () => {
    render(<PriorityBadge priority={null} />)
    expect(screen.getByText('Unscored')).toBeInTheDocument()
  })
})

describe('ScoreBar', () => {
  it('exposes the score as a meter with the matching priority band', () => {
    render(<ScoreBar score={82} />)
    const meter = screen.getByRole('meter', { name: 'Lead score' })
    expect(meter).toHaveAttribute('aria-valuenow', '82')
    expect(meter).toHaveAttribute('data-band', 'high')
    expect(meter).toHaveAttribute('aria-valuetext', '82 out of 100, high priority')
    expect(screen.getByText('82')).toBeInTheDocument()
  })

  it('uses workspace thresholds and clamps out-of-range scores', () => {
    const { rerender } = render(<ScoreBar score={55} thresholds={{ high: 50, medium: 20 }} />)
    expect(screen.getByRole('meter')).toHaveAttribute('data-band', 'high')
    rerender(<ScoreBar score={140} />)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100')
    rerender(<ScoreBar score={12} />)
    expect(screen.getByRole('meter')).toHaveAttribute('data-band', 'low')
  })

  it('renders a placeholder when the lead is not scored', () => {
    render(<ScoreBar score={null} />)
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    expect(screen.getByText('Not scored')).toBeInTheDocument()
  })
})

describe('ScoreBadge and SampleBadge', () => {
  it('renders the rounded score', () => {
    render(<ScoreBadge score={64.6} />)
    expect(screen.getByText('65')).toBeInTheDocument()
  })

  it('labels sample records', () => {
    render(<SampleBadge />)
    expect(screen.getByText('Sample')).toBeInTheDocument()
  })
})
