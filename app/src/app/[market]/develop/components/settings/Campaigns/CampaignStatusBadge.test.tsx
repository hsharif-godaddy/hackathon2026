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

  it('uses airo purple background and white text for ready status', function readyColors() {
    const { container } = renderWithProviders(<CampaignStatusBadge status="ready" />)
    const badge = container.querySelector('span')
    expect(badge).toHaveClass('bg-ai')
    expect(badge).toHaveClass('text-white')
    expect(badge).not.toHaveAttribute('style')
  })

  it('uses soft warning background for launched status', function launchedColors() {
    const { container } = renderWithProviders(<CampaignStatusBadge status="launched" />)
    const badge = container.querySelector('span')
    expect(badge).toHaveClass('bg-intents-ux-feedbackWarning-feedbackColor')
    expect(badge).toHaveClass('text-intents-ux-foreground-default')
  })

  it('falls back to draft styling for unknown status', function unknownStatus() {
    const { container } = renderWithProviders(<CampaignStatusBadge status={'unknown' as 'draft'} />)
    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.statusLabel.draft].toUpperCase())).toBeInTheDocument()
    expect(container.querySelector('span')).toHaveClass('bg-intents-ux-feedbackWarning-feedbackColor')
  })
})
