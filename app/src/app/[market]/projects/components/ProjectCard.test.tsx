/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { createMockSite, mockRouter } from '@/tests/mocks'
import { renderWithProviders } from '@/tests/test-utils'
import ProjectCard from './ProjectCard'

vi.mock('@/lib/gasket-config')

const mockRouterInstance = mockRouter()
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouterInstance,
}))

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => ({ isMdBreakpoint: true }),
}))

global.ResizeObserver = vi.fn().mockImplementation(function () {
  return {
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }
})

describe('ProjectCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouterInstance.push.mockClear()
  })

  describe('Share/Transfer menu item gating', () => {
    it.each([
      {
        name: 'website, published, transfer on -> share and transfer both shown',
        siteOverrides: { name: 'My Website', variants: ['publish'] },
        showTransfer: true,
        expectShare: true,
        expectTransfer: true,
      },
      {
        name: 'website, unpublished, transfer on -> share still shown (no longer requires isPublished)',
        siteOverrides: { name: 'My Website', variants: [] },
        showTransfer: true,
        expectShare: true,
        expectTransfer: true,
      },
      {
        name: 'logo project, published, transfer on -> share hidden, transfer still shown',
        siteOverrides: { name: 'My Logo', variants: ['publish'] },
        showTransfer: true,
        expectShare: false,
        expectTransfer: true,
      },
      {
        name: 'website, published, transfer off -> share shown, transfer hidden (no longer requires isPublished)',
        siteOverrides: { name: 'My Website', variants: ['publish'] },
        showTransfer: false,
        expectShare: true,
        expectTransfer: false,
      },
    ])('$name', async ({ siteOverrides, showTransfer, expectShare, expectTransfer }) => {
      const site = createMockSite(siteOverrides)
      const { user } = renderWithProviders(<ProjectCard site={site} showTransfer={showTransfer} />)

      const menuButton = screen.getByRole('button', { name: 'builder_apps_menu_actions' })
      await user.click(menuButton)

      await waitFor(() => {
        expect(screen.getByText('builder_common_rename')).toBeInTheDocument()
      })

      if (expectShare) {
        expect(screen.getByText('builder_social_share')).toBeInTheDocument()
      } else {
        expect(screen.queryByText('builder_social_share')).not.toBeInTheDocument()
      }

      if (expectTransfer) {
        expect(screen.getByText('builder_transfer_menu_item')).toBeInTheDocument()
      } else {
        expect(screen.queryByText('builder_transfer_menu_item')).not.toBeInTheDocument()
      }
    })
  })
})
