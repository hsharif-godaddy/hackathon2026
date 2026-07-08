/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { CAMPAIGN_KEYS } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { CAMPAIGN_DEFAULT_MESSAGES } from '@/lib/translations/campaign-defaults'
import { renderWithProviders } from '@/tests/test-utils'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'
import CampaignListView from './CampaignListView'

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}))

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'testapp1234'),
}))

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  useParams: vi.fn(() => ({ id: 'testapp1234' })),
}))

vi.mock('@/app/[market]/develop/components/settings/Campaigns/createCampaignInChat', () => ({
  focusChatWithCreateCampaignPrompt: vi.fn(),
}))

const defaultProps = {
  campaigns: [],
  loading: false,
  onSelectCampaign: vi.fn(),
}

describe('CampaignListView instrumentation', function listViewInstrumentation() {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fires logImpressionEvent once when appId is set and loading is false', function impressionFires() {
    const innerFn = vi.fn()
    vi.mocked(logImpressionEvent).mockReturnValue(innerFn)

    renderWithProviders(<CampaignListView {...defaultProps} />)

    expect(logImpressionEvent).toHaveBeenCalledOnce()
    expect(logImpressionEvent).toHaveBeenCalledWith('settings.campaigns.view', undefined)
    expect(innerFn).toHaveBeenCalledOnce()
  })

  it('does not fire logImpressionEvent a second time on re-render', function impressionOnce() {
    const innerFn = vi.fn()
    vi.mocked(logImpressionEvent).mockReturnValue(innerFn)

    const { rerender } = renderWithProviders(<CampaignListView {...defaultProps} />)
    rerender(<CampaignListView {...defaultProps} campaigns={[]} />)

    expect(logImpressionEvent).toHaveBeenCalledOnce()
    expect(innerFn).toHaveBeenCalledOnce()
  })

  it('does not fire logImpressionEvent when loading is true', function impressionDeferredWhileLoading() {
    renderWithProviders(<CampaignListView {...defaultProps} loading={true} />)

    expect(logImpressionEvent).not.toHaveBeenCalled()
  })

  it('fires logClickEvent with settings.campaigns.create when Create button is clicked', function createNewClick() {
    const innerFn = vi.fn()
    vi.mocked(logClickEvent).mockReturnValue(innerFn)

    renderWithProviders(<CampaignListView {...defaultProps} />)

    const createBtn = screen.getByRole('button', {
      name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.createNew],
    })
    createBtn.click()

    expect(logClickEvent).toHaveBeenCalledWith('settings.campaigns.create')
    expect(innerFn).toHaveBeenCalledOnce()
  })
})
