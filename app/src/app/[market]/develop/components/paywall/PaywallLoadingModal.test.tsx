/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PaywallLoadingModal, PaywallLoadingModalVariant } from './PaywallLoadingModal'

// Mock logging
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

import { shipAnalyticsLog } from '@/lib/logging'

// Mock UX components
vi.mock('@ux/modal', () => ({
  default: ({ children, title, onClose, centered, stretch }: any) => (
    <div data-testid="modal" data-centered={centered} data-stretch={stretch} role="dialog">
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

vi.mock('@ux/skeleton', () => ({
  default: ({ size, width, height, className }: any) => (
    <div data-testid="skeleton" data-size={size} data-width={width} data-height={height} className={className} />
  ),
}))

describe('PaywallLoadingModal', function paywallLoadingModalTests() {
  beforeEach(function setup() {
    vi.clearAllMocks()
  })

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

      expect(screen.getByTestId('modal')).toBeInTheDocument()
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument()

      const skeletonCards = screen.getAllByTestId('skeleton-plan-card')
      expect(skeletonCards).toHaveLength(3)
    })

    it('should call onClose when close button is clicked', function closeHigherPlansModal() {
      const mockOnClose = vi.fn()
      render(<PaywallLoadingModal onClose={mockOnClose} variant={PaywallLoadingModalVariant.HigherPlans} />)

      const closeButton = screen.getByRole('button', { name: /close/i })
      closeButton.click()

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should have stretch prop', function stretchHigherPlansModal() {
      const mockOnClose = vi.fn()
      render(<PaywallLoadingModal onClose={mockOnClose} variant={PaywallLoadingModalVariant.HigherPlans} />)

      expect(screen.getByTestId('modal')).toHaveAttribute('data-stretch', 'true')
    })
  })

  describe('observability logging', function loggingTests() {
    it('should log loading shown event on mount with default variant', function logDefaultShown() {
      const mockOnClose = vi.fn()
      render(
        <PaywallLoadingModal
          onClose={mockOnClose}
          source="test-source"
          component="TestComponent"
        />
      )

      expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.loading.default.shown', {
        source: 'test-source',
        component: 'TestComponent',
        variant: 'default',
      })
    })

    it('should log loading shown event with higher-plans variant', function logHigherPlansShown() {
      const mockOnClose = vi.fn()
      render(
        <PaywallLoadingModal
          onClose={mockOnClose}
          variant={PaywallLoadingModalVariant.HigherPlans}
          source="test-source"
          component="HigherPlansUpgradeContainer"
        />
      )

      expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.loading.higher-plans.shown', {
        source: 'test-source',
        component: 'HigherPlansUpgradeContainer',
        variant: 'higher-plans',
      })
    })

    it('should log loading shown event with credits variant', function logCreditsShown() {
      const mockOnClose = vi.fn()
      render(
        <PaywallLoadingModal
          onClose={mockOnClose}
          variant={PaywallLoadingModalVariant.Credits}
          source="test-source"
          component="CreditsUpgradeContainer"
        />
      )

      expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.loading.credits.shown', {
        source: 'test-source',
        component: 'CreditsUpgradeContainer',
        variant: 'credits',
      })
    })

    it('should only log shown event once on re-renders', function logOnceOnRerender() {
      const mockOnClose = vi.fn()
      const { rerender } = render(
        <PaywallLoadingModal
          onClose={mockOnClose}
          source="test-source"
          component="TestComponent"
        />
      )

      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1)

      // Re-render with same props
      rerender(
        <PaywallLoadingModal
          onClose={mockOnClose}
          source="test-source"
          component="TestComponent"
        />
      )

      // Should still only have logged once
      expect(shipAnalyticsLog).toHaveBeenCalledTimes(1)
    })
  })
})
