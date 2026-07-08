/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { TransferMenuLabel } from './transfer-menu-label'

describe('TransferMenuLabel', () => {
  it('renders the label text', () => {
    render(<TransferMenuLabel label="Transfer" />)
    expect(screen.getByText('Transfer')).toBeInTheDocument()
  })

  it('renders Diamond icon when needsUpgrade is true', () => {
    const { container } = render(<TransferMenuLabel label="Transfer" needsUpgrade />)
    // LinkIcon (always present) + DiamondIcon = 2 SVGs
    expect(container.querySelectorAll('svg.uxicon-svg-container')).toHaveLength(2)
  })

  it('does not render Diamond icon when needsUpgrade is false', () => {
    const { container } = render(<TransferMenuLabel label="Transfer" needsUpgrade={false} />)
    // Only LinkIcon present
    expect(container.querySelectorAll('svg.uxicon-svg-container')).toHaveLength(1)
  })

  it('does not render Diamond icon by default', () => {
    const { container } = render(<TransferMenuLabel label="Transfer" />)
    // Only LinkIcon present
    expect(container.querySelectorAll('svg.uxicon-svg-container')).toHaveLength(1)
  })
})
