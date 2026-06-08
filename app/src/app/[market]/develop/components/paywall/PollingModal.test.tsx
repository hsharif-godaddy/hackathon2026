/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { GrantPollingModal } from './GrantPollingModal'
import { PollingModal } from './PollingModal'
import { RenewalPollingModal } from './RenewalPollingModal'
import { UpgradePollingModal } from './UpgradePollingModal'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@ux/message-overlay', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="message-overlay">{children}</div>
  ),
}))

vi.mock('@ux/spinner', () => ({
  default: () => <div data-testid="spinner" />,
}))

vi.mock('@ux/text', () => ({
  default: {
    strong: ({ children }: { children: React.ReactNode }) => (
      <strong data-testid="text-strong">{children}</strong>
    ),
  },
}))

describe('PollingModal', function pollingModalTests() {
  it('renders spinner and text key', function rendersSpinnerAndText() {
    renderWithProviders(<PollingModal textKey="test_key" />)

    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    expect(screen.getByTestId('text-strong')).toHaveTextContent('test_key')
  })
})

describe('GrantPollingModal', function grantPollingModalTests() {
  it('renders with credits processing key', function rendersCorrectKey() {
    renderWithProviders(<GrantPollingModal />)

    expect(screen.getByTestId('text-strong')).toHaveTextContent('builder_credits_processing')
  })
})

describe('RenewalPollingModal', function renewalPollingModalTests() {
  it('renders with renewal processing key', function rendersCorrectKey() {
    renderWithProviders(<RenewalPollingModal />)

    expect(screen.getByTestId('text-strong')).toHaveTextContent('builder_manageplan_renewal_processing')
  })
})

describe('UpgradePollingModal', function upgradePollingModalTests() {
  it('renders with upgrade processing key', function rendersCorrectKey() {
    renderWithProviders(<UpgradePollingModal />)

    expect(screen.getByTestId('text-strong')).toHaveTextContent('builder_upgrade_processing')
  })
})
