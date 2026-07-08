/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { createMockSite, mockRouter } from '@/tests/mocks'
import { renderWithProviders } from '@/tests/test-utils'
import ProjectsLayout from './ProjectsLayout'

vi.mock('@/lib/gasket-config')

vi.mock('@/app/[market]/apps/components/TransferInitiateDialog', () => ({
  default: ({ appId }: { appId: string }) => (
    <div data-testid="transfer-initiate-dialog" data-app-id={appId} />
  ),
}))

const mockRouterInstance = mockRouter()
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouterInstance,
}))

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => ({ isMdBreakpoint: true }),
}))

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}))

const mockOpenUpgradeModal = vi.fn()
vi.mock('@/stores/usePaywallStore', () => ({
  usePaywallStore: vi.fn((selector: (s: { openUpgradeModal: typeof mockOpenUpgradeModal }) => unknown) =>
    selector({ openUpgradeModal: mockOpenUpgradeModal })
  ),
}))

vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: vi.fn((selector: (s: { deleteSite: () => void; fetchAllSites: () => void }) => unknown) =>
    selector({ deleteSite: vi.fn(), fetchAllSites: vi.fn() })
  ),
}))

global.ResizeObserver = vi.fn().mockImplementation(function () {
  return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
})

describe('ProjectsLayout — handleTransfer branching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouterInstance.push.mockClear()
  })

  async function openTransferMenu(user: ReturnType<typeof userEvent.setup>) {
    // ProjectsLayout renders two kebab buttons with the same label:
    // [0] = header menu, [1] = project card menu. Target the card's.
    const menuButtons = screen.getAllByRole('button', { name: 'builder_apps_menu_actions' })
    await user.click(menuButtons[menuButtons.length - 1])
    await waitFor(() => {
      expect(screen.getByText('builder_transfer_menu_item')).toBeInTheDocument()
    })
    await user.click(screen.getByText('builder_transfer_menu_item'))
  }

  it('opens upgrade modal for Starter users (transferAllowed=false)', async () => {
    const user = userEvent.setup()
    const site = createMockSite({ name: 'My App' })
    renderWithProviders(
      <ProjectsLayout sites={[site]} showTransfer transferAllowed={false} />
    )

    await openTransferMenu(user)

    expect(mockOpenUpgradeModal).toHaveBeenCalledWith('transfer.upgrade', PAYWALL_ITC.UPGRADE)
    expect(screen.queryByTestId('transfer-initiate-dialog')).not.toBeInTheDocument()
  })

  it('opens transfer dialog for Pro/Ultimate users (transferAllowed=true)', async () => {
    const user = userEvent.setup()
    const site = createMockSite({ name: 'My App' })
    renderWithProviders(
      <ProjectsLayout sites={[site]} showTransfer transferAllowed />
    )

    await openTransferMenu(user)

    expect(mockOpenUpgradeModal).not.toHaveBeenCalled()
    expect(screen.getByTestId('transfer-initiate-dialog')).toBeInTheDocument()
  })
})
