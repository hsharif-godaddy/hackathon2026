/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { CAMPAIGN_KEYS } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { CAMPAIGN_DEFAULT_MESSAGES } from '@/lib/translations/campaign-defaults'
import { renderWithProviders } from '@/tests/test-utils'
import { logClickEvent } from '@/utils/instrumentation'
import CampaignCard from './CampaignCard'
import type { Campaign } from './types'

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}))

const mockCampaign: Campaign = {
  id: 'camp-1',
  name: 'Summer Sale',
  campaignType: 'landing-page',
  status: 'ready',
  offer: 'Boost summer bookings',
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  assets: [{ id: 'a1', assetType: 'blog', assetRef: 'ref', title: 'Post', status: 'draft' }],
}

describe('CampaignCard', function cardTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks()
  })

  it('renders campaign summary and details action', function summary() {
    renderWithProviders(<CampaignCard campaign={mockCampaign} onDetails={vi.fn()} />)

    expect(screen.getByText('Summer Sale')).toBeInTheDocument()
    expect(screen.getByText('Boost summer bookings')).toBeInTheDocument()
    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.statusLabel.ready].toUpperCase())).toBeInTheDocument()
    expect(screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.seeDetails] })).toBeInTheDocument()
  })

  it('calls onDetails when See details is clicked', function detailsClick() {
    const onDetails = vi.fn()
    renderWithProviders(<CampaignCard campaign={mockCampaign} onDetails={onDetails} />)

    screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.seeDetails] }).click()
    expect(onDetails).toHaveBeenCalledOnce()
  })

  it('fires logClickEvent settings.campaigns.details with campaignId and calls onDetails when See details is clicked', function detailsInstrumented() {
    const innerFn = vi.fn()
    vi.mocked(logClickEvent).mockReturnValue(innerFn)
    const onDetails = vi.fn()

    renderWithProviders(<CampaignCard campaign={mockCampaign} onDetails={onDetails} />)

    screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.seeDetails] }).click()

    expect(logClickEvent).toHaveBeenCalledWith('settings.campaigns.details', { campaignId: 'camp-1' })
    expect(innerFn).toHaveBeenCalledOnce()
    expect(onDetails).toHaveBeenCalledOnce()
  })
})
