/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { PaywallSuspendedModal } from './PaywallSuspendedModal'

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
    p: ({ children, className, emphasis }: any) => <p data-testid={emphasis === 'critical' ? 'text-p-critical' : 'text-p'} className={className}>{children}</p>,
  },
}))

vi.mock('@ux/icon/alert', () => ({
  default: ({ className }: any) => <svg data-testid="alert-icon" className={className} />,
}))

vi.mock('@ux/button', () => ({
  default: ({ text, onClick, disabled, design, size }: any) => (
    <button data-testid="action-button" data-design={design} data-size={size} onClick={onClick} disabled={disabled}>{text}</button>
  ),
}))

const mockRenewSubscription = vi.fn()
const mockResetError = vi.fn()
let mockIsRenewing = false
let mockError: Error | null = null

vi.mock('@/hooks/useSubscriptionRenewal', () => ({
  useSubscriptionRenewal: () => ({
    renewSubscription: mockRenewSubscription,
    isRenewing: mockIsRenewing,
    error: mockError,
    resetError: mockResetError,
  }),
}))

let mockAutoRenewData: { subscriptionId?: string } | undefined = { subscriptionId: 'sub-123' }

vi.mock('@/hooks/useEcommSubscriptionAutoRenewStatus', () => ({
  useEcommSubscriptionAutoRenewStatus: () => ({
    data: mockAutoRenewData,
  }),
}))

let mockIsEnterpriseUser = false
vi.mock('@/hooks/useIsEnterpriseUser', () => ({
  useIsEnterpriseUser: () => mockIsEnterpriseUser,
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      builder_paywall_suspended_title: 'Subscription Suspended',
      builder_paywall_suspended_description: 'Your subscription is suspended. Renew to continue.',
      builder_chat_suspended_renewal_failed: 'Renewal failed. Please try again.',
      builder_common_retry: 'Retry',
      builder_chat_suspended_renewing: 'Renewing...',
      builder_chat_suspended_renew_button: 'Renew Subscription',
    }
    return translations[key] || key
  },
}))

function resetMocks(): void {
  mockRenewSubscription.mockReset()
  mockResetError.mockReset()
  mockIsRenewing = false
  mockError = null
  mockAutoRenewData = { subscriptionId: 'sub-123' }
  mockIsEnterpriseUser = false
}

describe('PaywallSuspendedModal', function paywallSuspendedModalTests() {
  it('renders title and description', function renderTitleAndDescription() {
    resetMocks()
    const onClose = vi.fn()
    render(<PaywallSuspendedModal onClose={onClose} builderEntitlementId="ent-1" />)

    expect(screen.getByTestId('text-h2')).toHaveTextContent('Subscription Suspended')
    expect(screen.getByTestId('text-p')).toHaveTextContent('Your subscription is suspended. Renew to continue.')
  })

  it('renders nothing for enterprise members (admin-managed billing)', function entHidesModal() {
    // Enterprise billing is centrally managed — there is no per-member
    // ecomm subscription / auto-renew for ent customers. Suppress the
    // entire modal so we don't show a renew button with no actionable
    // target (and so we don't fire the BFF call that would 404).
    resetMocks()
    mockIsEnterpriseUser = true
    const onClose = vi.fn()
    const { container } = render(<PaywallSuspendedModal onClose={onClose} builderEntitlementId="ent-1" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders renew button enabled when subscriptionId is available', function renewEnabled() {
    resetMocks()
    const onClose = vi.fn()
    render(<PaywallSuspendedModal onClose={onClose} builderEntitlementId="ent-1" />)

    const button = screen.getByTestId('action-button')
    expect(button).toHaveTextContent('Renew Subscription')
    expect(button).not.toBeDisabled()
  })

  it('disables renew button when no subscriptionId', function renewDisabledNoSubId() {
    resetMocks()
    mockAutoRenewData = undefined
    const onClose = vi.fn()
    render(<PaywallSuspendedModal onClose={onClose} builderEntitlementId="ent-1" />)

    const button = screen.getByTestId('action-button')
    expect(button).toBeDisabled()
  })

  it('shows renewing state', function renewingState() {
    resetMocks()
    mockIsRenewing = true
    const onClose = vi.fn()
    render(<PaywallSuspendedModal onClose={onClose} builderEntitlementId="ent-1" />)

    const button = screen.getByTestId('action-button')
    expect(button).toHaveTextContent('Renewing...')
    expect(button).toBeDisabled()
  })

  it('calls onClose on successful renewal', async function successClosesModal() {
    resetMocks()
    mockRenewSubscription.mockResolvedValue({ success: true, subscriptionActive: true })
    const onClose = vi.fn()
    render(<PaywallSuspendedModal onClose={onClose} builderEntitlementId="ent-1" />)

    await act(async () => {
      screen.getByTestId('action-button').click()
    })

    expect(mockRenewSubscription).toHaveBeenCalledWith('sub-123')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close modal on failed renewal', async function failureKeepsOpen() {
    resetMocks()
    mockRenewSubscription.mockResolvedValue({ success: false, subscriptionActive: false })
    const onClose = vi.fn()
    render(<PaywallSuspendedModal onClose={onClose} builderEntitlementId="ent-1" />)

    await act(async () => {
      screen.getByTestId('action-button').click()
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows retry UI when renewal error exists', function showsRetryOnError() {
    resetMocks()
    mockError = new Error('Payment failed')
    const onClose = vi.fn()
    render(<PaywallSuspendedModal onClose={onClose} builderEntitlementId="ent-1" />)

    expect(screen.getByTestId('text-p-critical')).toHaveTextContent('Renewal failed. Please try again.')
    expect(screen.getByTestId('action-button')).toHaveTextContent('Retry')
  })

  it('retry resets error and re-attempts renewal', async function retryResetsAndRenews() {
    resetMocks()
    mockError = new Error('Payment failed')
    mockRenewSubscription.mockResolvedValue({ success: true, subscriptionActive: true })
    const onClose = vi.fn()
    render(<PaywallSuspendedModal onClose={onClose} builderEntitlementId="ent-1" />)

    await act(async () => {
      screen.getByTestId('action-button').click()
    })

    expect(mockResetError).toHaveBeenCalledTimes(1)
    expect(mockRenewSubscription).toHaveBeenCalledWith('sub-123')
  })
})
