/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { CAMPAIGN_KEYS } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { CAMPAIGN_DEFAULT_MESSAGES } from '@/lib/translations/campaign-defaults'
import { mockRouter } from '@/tests/mocks'
import { renderWithProviders } from '@/tests/test-utils'
import CampaignPlanToolRenderer from './CampaignPlanToolRenderer'

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
  usePathname: () => '/test-app-id/develop',
  useParams: () => ({ id: 'test-app-id' }),
}))

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: vi.fn(async (path: string) => `https://agent.test/${path}`),
}))

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({ campaign: null }),
  })),
}))

const mockCampaign = {
  id: 'camp-1',
  appId: 'test-app-id',
  name: 'Summer Sale',
  campaignType: 'landing-page' as const,
  status: 'ready' as const,
  offer: 'Boost summer bookings',
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
}

describe('CampaignPlanToolRenderer', function rendererTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
  })

  it('renders campaign card when tool completes with ready status', async function readyCard() {
    renderWithProviders(
      <CampaignPlanToolRenderer
        toolName="campaignPlanCreate"
        toolStatus="completed"
        result={{ campaign: mockCampaign }}
      />
    )

    await waitFor(function assertCard() {
      expect(screen.getByText('Summer Sale')).toBeInTheDocument()
      expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.statusLabel.ready].toUpperCase())).toBeInTheDocument()
      expect(screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.seeDetails] })).toBeInTheDocument()
    })
  })

  it('returns null for draft campaigns', function draftHidden() {
    const { container } = renderWithProviders(
      <CampaignPlanToolRenderer
        toolName="campaignPlanCreate"
        toolStatus="completed"
        result={{ campaign: { ...mockCampaign, status: 'draft' } }}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('shows creating plan label while running', function creatingPlan() {
    renderWithProviders(
      <CampaignPlanToolRenderer
        toolName="campaignPlanCreate"
        toolStatus="running"
        result={{}}
      />
    )

    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.creatingPlan])).toBeInTheDocument()
  })
})
