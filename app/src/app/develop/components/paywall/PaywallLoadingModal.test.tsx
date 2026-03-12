import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PaywallLoadingModal, PaywallLoadingModalVariant } from './PaywallLoadingModal'

// Mock UX components
vi.mock('@ux/modal', () => ({
  default: ({ children, title, onClose, centered }: any) => (
    <div data-testid="modal" data-centered={centered} role="dialog">
      <div data-testid="modal-title">{title}</div>
      <button onClick={onClose} aria-label="close">Close</button>
      {children}
    </div>
  ),
}))

vi.mock('@ux/box', () => ({
  default: ({ children, className }: any) => (
    <div data-testid="box" className={className}>{children}</div>
  ),
}))

vi.mock('@ux/spinner', () => ({
  default: ({ size }: any) => (
    <div data-testid="spinner" data-size={size} role="status">Loading...</div>
  ),
}))

describe('PaywallLoadingModal', function paywallLoadingModalTests() {
  it('should render a modal with spinner', function renderModal() {
    const mockOnClose = vi.fn()
    render(<PaywallLoadingModal onClose={mockOnClose} />)

    // Modal should be rendered
    expect(screen.getByTestId('modal')).toBeInTheDocument()

    // Spinner should be visible
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  it('should render with empty title', function emptyTitle() {
    const mockOnClose = vi.fn()
    render(<PaywallLoadingModal onClose={mockOnClose} />)

    expect(screen.getByTestId('modal-title')).toHaveTextContent('')
  })

  it('should call onClose when close button is clicked', async function closeModal() {
    const mockOnClose = vi.fn()
    render(<PaywallLoadingModal onClose={mockOnClose} />)

    const closeButton = screen.getByRole('button', { name: /close/i })
    closeButton.click()

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('should be centered', function centeredModal() {
    const mockOnClose = vi.fn()
    render(<PaywallLoadingModal onClose={mockOnClose} />)

    expect(screen.getByTestId('modal')).toHaveAttribute('data-centered', 'true')
  })

  it('should render large spinner', function largeSpinner() {
    const mockOnClose = vi.fn()
    render(<PaywallLoadingModal onClose={mockOnClose} />)

    expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', 'lg')
  })

  describe('higher-plans variant', function higherPlansVariantTests() {
    it('should render skeleton plan cards instead of spinner', function renderSkeletonCards() {
      const mockOnClose = vi.fn()
      render(<PaywallLoadingModal onClose={mockOnClose} variant={PaywallLoadingModalVariant.HigherPlans} />)

      // Modal should be rendered
      expect(screen.getByTestId('modal')).toBeInTheDocument()

      // Spinner should NOT be visible
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()

      // Should render 3 skeleton plan cards (check for animated elements)
      const skeletonElements = document.querySelectorAll('.animate-pulse')
      expect(skeletonElements.length).toBeGreaterThan(0)
    })

    it('should call onClose when close button is clicked', function closeHigherPlansModal() {
      const mockOnClose = vi.fn()
      render(<PaywallLoadingModal onClose={mockOnClose} variant={PaywallLoadingModalVariant.HigherPlans} />)

      const closeButton = screen.getByRole('button', { name: /close/i })
      closeButton.click()

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should be centered', function centeredHigherPlansModal() {
      const mockOnClose = vi.fn()
      render(<PaywallLoadingModal onClose={mockOnClose} variant={PaywallLoadingModalVariant.HigherPlans} />)

      expect(screen.getByTestId('modal')).toHaveAttribute('data-centered', 'true')
    })
  })
})
