/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { CAMPAIGN_KEYS } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { CAMPAIGN_DEFAULT_MESSAGES } from '@/lib/translations/campaign-defaults'
import { renderWithProviders } from '@/tests/test-utils'
import CampaignStatusBadge from './CampaignStatusBadge'

describe('CampaignStatusBadge', function badgeTests() {
  it('renders ready status label', function readyLabel() {
    renderWithProviders(<CampaignStatusBadge status="ready" />)
    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.statusLabel.ready].toUpperCase())).toBeInTheDocument()
  })

  it('uses highlight emphasis for ready status', function readyEmphasis() {
    renderWithProviders(<CampaignStatusBadge status="ready" />)
    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.statusLabel.ready].toUpperCase()).closest('.ux-tag')).toHaveClass('ux-tag-highlight')
  })

  it('uses warning emphasis for launched status', function launchedEmphasis() {
    renderWithProviders(<CampaignStatusBadge status="launched" />)
    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.statusLabel.launched].toUpperCase()).closest('.ux-tag')).toHaveClass('ux-tag-warning')
  })

  it('falls back to draft styling for unknown status', function unknownStatus() {
    renderWithProviders(<CampaignStatusBadge status={'unknown' as 'draft'} />)
    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.statusLabel.draft].toUpperCase())).toBeInTheDocument()
    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.statusLabel.draft].toUpperCase()).closest('.ux-tag')).toHaveClass('ux-tag-warning')
  })
})
