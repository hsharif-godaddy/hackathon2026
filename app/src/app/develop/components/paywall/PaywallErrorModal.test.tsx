import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PaywallErrorModal } from './PaywallErrorModal'

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

vi.mock('@ux/text', () => ({
  default: {
    p: ({ children }: any) => <p data-testid="text-p">{children}</p>,
  },
}))

vi.mock('@ux/icon/alert', () => ({
  default: ({ className }: any) => (
    <svg data-testid="alert-icon" className={className} />
  ),
}))

vi.mock('@ux/button', () => ({
  default: ({ children, onClick, design, size }: any) => (
    <button
      data-testid="retry-button"
      data-design={design}
      data-size={size}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: unknown, defaultMessage?: string) => {
    const translations: Record<string, string> = {
      builder_common_something_went_wrong: 'Something went wrong',
      builder_paywall_load_error: 'We couldn\'t load the purchase options.',
    }
    return translations[key] || defaultMessage || key
  },
}))

describe('PaywallErrorModal', function paywallErrorModalTests() {
  it('should render error modal with title and message', function renderModal() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    // Modal should be rendered
    expect(screen.getByTestId('modal')).toBeInTheDocument()

    // Title should be visible
    expect(screen.getByTestId('modal-title')).toHaveTextContent('Something went wrong')

    // Error message should be visible
    expect(screen.getByTestId('text-p')).toHaveTextContent(/couldn't load the purchase options/i)
  })

  it('should render alert icon', function renderAlertIcon() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    expect(screen.getByTestId('alert-icon')).toBeInTheDocument()
  })

  it('should render alert icon with critical styling', function alertIconStyling() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    const icon = screen.getByTestId('alert-icon')
    expect(icon).toHaveClass('text-intents-ux-critical-textColor')
  })

  it('should call onClose when close button is clicked', function closeModal() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    const closeButton = screen.getByRole('button', { name: /close/i })
    closeButton.click()

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('should be centered', function centeredModal() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    expect(screen.getByTestId('modal')).toHaveAttribute('data-centered', 'true')
  })

  it('should render retry button when onRetry is provided', function renderRetryButton() {
    const mockOnClose = vi.fn()
    const mockOnRetry = vi.fn()

    render(<PaywallErrorModal onClose={mockOnClose} onRetry={mockOnRetry} />)

    const retryButton = screen.getByTestId('retry-button')
    expect(retryButton).toBeInTheDocument()
    expect(retryButton).toHaveTextContent('Try again')
  })

  it('should call onRetry when retry button is clicked', function callOnRetry() {
    const mockOnClose = vi.fn()
    const mockOnRetry = vi.fn()

    render(<PaywallErrorModal onClose={mockOnClose} onRetry={mockOnRetry} />)

    const retryButton = screen.getByTestId('retry-button')
    retryButton.click()

    expect(mockOnRetry).toHaveBeenCalledTimes(1)
  })

  it('should not render retry button when onRetry is not provided', function noRetryButton() {
    const mockOnClose = vi.fn()

    render(<PaywallErrorModal onClose={mockOnClose} />)

    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument()
  })
})
