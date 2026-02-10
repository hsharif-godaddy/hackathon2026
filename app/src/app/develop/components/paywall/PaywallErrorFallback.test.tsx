import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PaywallErrorFallback } from './PaywallErrorFallback'

// Mock PaywallErrorModal
vi.mock('./PaywallErrorModal', () => ({
  PaywallErrorModal: ({ onClose, onRetry }: { onClose: () => void; onRetry?: () => void }) => (
    <div data-testid="paywall-error-modal">
      <button data-testid="close-button" onClick={onClose}>Close</button>
      {onRetry && <button data-testid="retry-button" onClick={onRetry}>Retry</button>}
    </div>
  ),
}))

describe('PaywallErrorFallback', function paywallErrorFallbackTests() {
  describe('error logging', function errorLoggingTests() {
    it('should call onError with the error on mount', function callOnErrorOnMount() {
      const mockOnError = vi.fn()
      const mockOnClose = vi.fn()
      const mockReset = vi.fn()
      const error = new Error('Test error')

      render(
        <PaywallErrorFallback
          error={error}
          reset={mockReset}
          onClose={mockOnClose}
          onError={mockOnError}
        />
      )

      expect(mockOnError).toHaveBeenCalledTimes(1)
      expect(mockOnError).toHaveBeenCalledWith(error)
    })

    it('should not call onError again on re-render with same error', function noDoubleLogging() {
      const mockOnError = vi.fn()
      const mockOnClose = vi.fn()
      const mockReset = vi.fn()
      const error = new Error('Test error')

      const { rerender } = render(
        <PaywallErrorFallback
          error={error}
          reset={mockReset}
          onClose={mockOnClose}
          onError={mockOnError}
        />
      )

      expect(mockOnError).toHaveBeenCalledTimes(1)

      // Re-render with same error instance
      rerender(
        <PaywallErrorFallback
          error={error}
          reset={mockReset}
          onClose={mockOnClose}
          onError={mockOnError}
        />
      )

      expect(mockOnError).toHaveBeenCalledTimes(1)
    })

    it('should call onError when error instance changes', function logNewErrors() {
      const mockOnError = vi.fn()
      const mockOnClose = vi.fn()
      const mockReset = vi.fn()
      const firstError = new Error('First error')
      const secondError = new Error('Second error')

      const { rerender } = render(
        <PaywallErrorFallback
          error={firstError}
          reset={mockReset}
          onClose={mockOnClose}
          onError={mockOnError}
        />
      )

      expect(mockOnError).toHaveBeenCalledTimes(1)
      expect(mockOnError).toHaveBeenCalledWith(firstError)

      // Re-render with a different error instance
      rerender(
        <PaywallErrorFallback
          error={secondError}
          reset={mockReset}
          onClose={mockOnClose}
          onError={mockOnError}
        />
      )

      expect(mockOnError).toHaveBeenCalledTimes(2)
      expect(mockOnError).toHaveBeenLastCalledWith(secondError)
    })

    it('should handle undefined onError gracefully', function handleUndefinedOnError() {
      const mockOnClose = vi.fn()
      const mockReset = vi.fn()
      const error = new Error('Test error')

      // Should not throw when onError is undefined
      expect(() => {
        render(
          <PaywallErrorFallback
            error={error}
            reset={mockReset}
            onClose={mockOnClose}
          />
        )
      }).not.toThrow()
    })
  })

  describe('props passing to PaywallErrorModal', function propsPassingTests() {
    it('should render PaywallErrorModal', function renderModal() {
      const mockOnClose = vi.fn()
      const mockReset = vi.fn()
      const error = new Error('Test error')

      render(
        <PaywallErrorFallback
          error={error}
          reset={mockReset}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByTestId('paywall-error-modal')).toBeInTheDocument()
    })

    it('should pass onClose to PaywallErrorModal', function passOnClose() {
      const mockOnClose = vi.fn()
      const mockReset = vi.fn()
      const error = new Error('Test error')

      render(
        <PaywallErrorFallback
          error={error}
          reset={mockReset}
          onClose={mockOnClose}
        />
      )

      screen.getByTestId('close-button').click()
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should pass reset as onRetry to PaywallErrorModal', function passReset() {
      const mockOnClose = vi.fn()
      const mockReset = vi.fn()
      const error = new Error('Test error')

      render(
        <PaywallErrorFallback
          error={error}
          reset={mockReset}
          onClose={mockOnClose}
        />
      )

      screen.getByTestId('retry-button').click()
      expect(mockReset).toHaveBeenCalledTimes(1)
    })
  })
})
