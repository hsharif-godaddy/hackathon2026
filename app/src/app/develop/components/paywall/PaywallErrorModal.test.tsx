/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PaywallErrorModal } from './PaywallErrorModal'

// Mock UX components
vi.mock('@ux/modal', () => ({
  default: ({ children, onClose, centered, 'aria-labelledby': ariaLabelledby }: any) => (
    <div data-testid="modal" data-centered={centered} data-aria-labelledby={ariaLabelledby} role="dialog">
      <button onClick={onClose} aria-label="close">Close</button>
      {children}
    </div>
  ),
}))

vi.mock('@ux/text', () => ({
  default: {
    h2: ({ children, className, id }: any) => <h2 data-testid="text-h2" className={className} id={id}>{children}</h2>,
    p: ({ children, className }: any) => <p data-testid="text-p" className={className}>{children}</p>,
  },
}))

vi.mock('@ux/icon/alert', () => ({
  default: ({ className }: any) => (
    <svg data-testid="alert-icon" className={className} />
  ),
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: unknown, defaultMessage?: string) => {
    const translations: Record<string, string> = {
      builder_paywall_error_title: 'Unable to load',
      builder_paywall_error_description: "We couldn't load the purchase options. Please close and try again later.",
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

    // Title should be visible (now inside the modal body, not as modal title)
    expect(screen.getByTestId('text-h2')).toHaveTextContent('Unable to load')

    // Error message should be visible
    expect(screen.getByTestId('text-p')).toHaveTextContent(/couldn't load the purchase options/i)
  })

  it('should render alert icon', function renderAlertIcon() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    expect(screen.getByTestId('alert-icon')).toBeInTheDocument()
  })

  it('should render alert icon with size styling', function alertIconStyling() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    const icon = screen.getByTestId('alert-icon')
    expect(icon).toHaveClass('w-10', 'h-10')
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

  it('should render title centered', function titleCentered() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    expect(screen.getByTestId('text-h2')).toHaveClass('text-center')
  })

  it('should render description centered', function descriptionStyling() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    expect(screen.getByTestId('text-p')).toHaveClass('text-center')
  })

  it('should have accessible labeling via aria-labelledby', function accessibleLabeling() {
    const mockOnClose = vi.fn()
    render(<PaywallErrorModal onClose={mockOnClose} />)

    const modal = screen.getByTestId('modal')
    expect(modal).toHaveAttribute('data-aria-labelledby', 'paywall-error-title')

    const title = screen.getByTestId('text-h2')
    expect(title).toHaveAttribute('id', 'paywall-error-title')
  })
})
