/**
 * @vitest-environment jsdom
 */
import { describe, expect,it } from 'vitest'
import { render, screen } from '@testing-library/react'

import CostSparkline from './CostSparkline'

describe('CostSparkline', () => {
  it('renders placeholder when values is empty', () => {
    render(<CostSparkline values={[]} />)
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
  })

  it('renders one bar per value', () => {
    const { container } = render(<CostSparkline values={[0.001, 0.002, 0.003]} />)
    expect(container.querySelectorAll('rect[data-testid="cost-sparkline-bar"]')).toHaveLength(3)
  })

  it('scales bars relative to max', () => {
    const { container } = render(<CostSparkline values={[1, 2, 4]} />)
    const bars = container.querySelectorAll('rect[data-testid="cost-sparkline-bar"]')
    const heights = Array.from(bars).map((b) => Number(b.getAttribute('height')))
    expect(heights[2]).toBeGreaterThan(heights[1])
    expect(heights[1]).toBeGreaterThan(heights[0])
  })
})
