/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { usePaywallStore } from '@/stores/usePaywallStore'
import { UpgradeModal } from './UpgradeModal'

const mockShipAnalyticsLog = vi.fn()

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}))

vi.mock('@/app/[market]/develop/components/paywall', () => ({
  UpgradeContainer: ({
    source,
    itc,
    onSuccessClick,
    onClose,
    onErrorClick,
  }: {
    source: string
    itc?: string
    onSuccessClick: () => void
    onClose: () => void
    onErrorClick: () => void
  }) => (
    <div data-testid="upgrade-container" data-source={source} data-itc={itc ?? ''}>
      <button type="button" onClick={onSuccessClick}>success</button>
      <button type="button" onClick={onClose}>close</button>
      <button type="button" onClick={onErrorClick}>error</button>
    </div>
  ),
}))

function resetStore() {
  usePaywallStore.setState({
    showUpgradeModal: false,
    upgradeModalSource: null,
    upgradeModalItc: null,
    paywallLoading: false,
  })
}

describe('UpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  describe('visibility', () => {
    it('renders nothing when showUpgradeModal is false', () => {
      render(<UpgradeModal />)
      expect(screen.queryByTestId('upgrade-container')).not.toBeInTheDocument()
    })

    it('renders UpgradeContainer when showUpgradeModal is true', () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: 'pricing_section.upgrade' })
      render(<UpgradeModal />)
      expect(screen.getByTestId('upgrade-container')).toBeInTheDocument()
    })
  })

  describe('source and itc props', () => {
    it('passes upgradeModalSource to UpgradeContainer', () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: 'publish.limit' })
      render(<UpgradeModal />)
      expect(screen.getByTestId('upgrade-container')).toHaveAttribute('data-source', 'publish.limit')
    })

    it('falls back to "unknown" source when upgradeModalSource is null', () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: null })
      render(<UpgradeModal />)
      expect(screen.getByTestId('upgrade-container')).toHaveAttribute('data-source', 'unknown')
    })

    it('passes upgradeModalItc to UpgradeContainer', () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: 'pricing_section.upgrade', upgradeModalItc: 'itc-abc' })
      render(<UpgradeModal />)
      expect(screen.getByTestId('upgrade-container')).toHaveAttribute('data-itc', 'itc-abc')
    })

    it('passes empty itc when upgradeModalItc is null', () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: 'pricing_section.upgrade', upgradeModalItc: null })
      render(<UpgradeModal />)
      expect(screen.getByTestId('upgrade-container')).toHaveAttribute('data-itc', '')
    })
  })

  describe('onSuccessClick', () => {
    it('closes the modal', async () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: 'pricing_section.upgrade' })
      render(<UpgradeModal />)
      await userEvent.click(screen.getByRole('button', { name: 'success' }))
      expect(usePaywallStore.getState().showUpgradeModal).toBe(false)
    })
  })

  describe('onClose', () => {
    it('closes the modal and logs "<source>.dismissed" with empty analyticsData by default', async () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: 'pricing_section.upgrade' })
      render(<UpgradeModal />)
      await userEvent.click(screen.getByRole('button', { name: 'close' }))
      expect(usePaywallStore.getState().showUpgradeModal).toBe(false)
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('pricing_section.upgrade.dismissed', {})
    })

    it('forwards provided analyticsData to shipAnalyticsLog', async () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: 'publish.limit' })
      render(<UpgradeModal analyticsData={{ appId: 'app-123' }} />)
      await userEvent.click(screen.getByRole('button', { name: 'close' }))
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('publish.limit.dismissed', { appId: 'app-123' })
    })
  })

  describe('onErrorClick', () => {
    it('closes the modal and logs "<source>.error" with empty analyticsData by default', async () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: 'pricing_section.upgrade' })
      render(<UpgradeModal />)
      await userEvent.click(screen.getByRole('button', { name: 'error' }))
      expect(usePaywallStore.getState().showUpgradeModal).toBe(false)
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('pricing_section.upgrade.error', {})
    })

    it('forwards provided analyticsData to shipAnalyticsLog', async () => {
      usePaywallStore.setState({ showUpgradeModal: true, upgradeModalSource: 'publish.limit' })
      render(<UpgradeModal analyticsData={{ appId: 'app-456' }} />)
      await userEvent.click(screen.getByRole('button', { name: 'error' }))
      expect(mockShipAnalyticsLog).toHaveBeenCalledWith('publish.limit.error', { appId: 'app-456' })
    })
  })

  describe('store reactivity', () => {
    it('shows modal when store transitions from closed to open', () => {
      render(<UpgradeModal />)
      expect(screen.queryByTestId('upgrade-container')).not.toBeInTheDocument()

      act(() => {
        usePaywallStore.getState().openUpgradeModal('pricing_section.upgrade', 'itc-xyz')
      })

      expect(screen.getByTestId('upgrade-container')).toBeInTheDocument()
      expect(screen.getByTestId('upgrade-container')).toHaveAttribute('data-source', 'pricing_section.upgrade')
      expect(screen.getByTestId('upgrade-container')).toHaveAttribute('data-itc', 'itc-xyz')
    })

    it('hides modal after success click clears store state', async () => {
      usePaywallStore.getState().openUpgradeModal('pricing_section.upgrade')
      render(<UpgradeModal />)
      expect(screen.getByTestId('upgrade-container')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'success' }))

      expect(screen.queryByTestId('upgrade-container')).not.toBeInTheDocument()
    })
  })
})
