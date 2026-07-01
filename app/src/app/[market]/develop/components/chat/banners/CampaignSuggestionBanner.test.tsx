/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CAMPAIGN_KEYS } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { CAMPAIGN_DEFAULT_MESSAGES } from '@/lib/translations/campaign-defaults'
import { renderWithProviders } from '@/tests/test-utils'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'
import CampaignSuggestionBanner from './CampaignSuggestionBanner'

const mockDismiss = vi.fn()
const mockSendUserMessage = vi.fn()
const mockUseCampaignSuggestions = vi.fn()
const mockUseIsActivelyStreaming = vi.fn()
const mockUseIsLoading = vi.fn()
const mockUseLatestNBAs = vi.fn()
const mockUseCampaigns = vi.fn()

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-1',
}))

vi.mock('@/app/[market]/develop/components/settings/Campaigns/useCampaigns', () => ({
  useCampaigns: (...args: unknown[]) => mockUseCampaigns(...args),
}))

vi.mock('@/app/[market]/develop/hooks/useCampaignSuggestions', () => ({
  useCampaignSuggestions: (...args: unknown[]) => mockUseCampaignSuggestions(...args),
}))

vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: () => mockSendUserMessage,
}))

vi.mock('@/app/[market]/develop/components/chat/useLatestNBAs', () => ({
  useLatestNBAs: () => mockUseLatestNBAs(),
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => mockUseIsActivelyStreaming(),
  useIsLoading: () => mockUseIsLoading(),
}))

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}))

const suggestions = [
  { text: 'Launch a summer promo', prompt: 'Create a summer promo campaign' },
  { text: 'Grow email list', prompt: 'Create an email list growth campaign' },
]

function mockReadySuggestions(overrides: Record<string, unknown> = {}) {
  mockUseCampaignSuggestions.mockReturnValue({
    suggestions,
    loading: false,
    dismissed: false,
    dismiss: mockDismiss,
    mounted: true,
    ...overrides,
  })
}

describe('CampaignSuggestionBanner', function bannerTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
    mockReadySuggestions()
    mockUseCampaigns.mockReturnValue({ campaigns: [] })
    mockUseIsActivelyStreaming.mockReturnValue(false)
    mockUseIsLoading.mockReturnValue(false)
    mockUseLatestNBAs.mockReturnValue(null)
  })

  it('renders when suggestions are ready', function ready() {
    renderWithProviders(<CampaignSuggestionBanner />)

    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionTitle])).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '1. Launch a summer promo' })).toBeInTheDocument()
  })

  it('stays visible while agent is processing after it was shown', function latchedDuringProcessing() {
    mockUseIsActivelyStreaming.mockReturnValue(false)
    const { rerender } = renderWithProviders(<CampaignSuggestionBanner />)

    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionTitle])).toBeInTheDocument()

    mockUseIsActivelyStreaming.mockReturnValue(true)
    mockUseIsLoading.mockReturnValue(true)
    rerender(<CampaignSuggestionBanner />)

    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionTitle])).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '1. Launch a summer promo' })).toBeDisabled()
  })

  it('hides while an NBA is active and re-shows when it clears', function hideOnNba() {
    const { rerender } = renderWithProviders(<CampaignSuggestionBanner />)

    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionTitle])).toBeInTheDocument()

    mockUseLatestNBAs.mockReturnValue({
      question: 'Pick one',
      suggestions: [{ text: 'Option A' }],
      source: 'askQuestion',
    })
    rerender(<CampaignSuggestionBanner />)

    expect(screen.queryByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionTitle])).not.toBeInTheDocument()

    mockUseLatestNBAs.mockReturnValue(null)
    rerender(<CampaignSuggestionBanner />)

    expect(screen.getByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionTitle])).toBeInTheDocument()
  })

  it('dismisses via close button', async function dismiss() {
    const user = userEvent.setup()
    renderWithProviders(<CampaignSuggestionBanner />)

    await user.click(screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionDismiss] }))

    expect(mockDismiss).toHaveBeenCalled()
  })

  it('hides when the app already has campaigns', function hasCampaigns() {
    mockUseCampaigns.mockReturnValue({
      campaigns: [{ id: 'camp-1', name: 'Summer promo' }],
    })

    renderWithProviders(<CampaignSuggestionBanner />)

    expect(screen.queryByText(CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionTitle])).not.toBeInTheDocument()
    expect(logClickEvent).toHaveBeenCalledWith('chat.campaignSuggestion.autoDismiss', { reason: 'hasCampaigns' })
    expect(mockDismiss).toHaveBeenCalled()
  })

  describe('analytics', function analyticsTests() {
    it('logs impression with suggestion count', function impression() {
      renderWithProviders(<CampaignSuggestionBanner />)

      expect(logImpressionEvent).toHaveBeenCalledWith('chat.campaignSuggestion.view', {
        suggestionCount: 2,
      })
    })

    it('logs preset select click', async function select() {
      const user = userEvent.setup()
      renderWithProviders(<CampaignSuggestionBanner />)

      await user.click(screen.getByRole('option', { name: '1. Launch a summer promo' }))

      expect(logClickEvent).toHaveBeenCalledWith('chat.campaignSuggestion.select', {
        suggestionIndex: 0,
        selectionType: 'preset',
      })
      expect(mockSendUserMessage).toHaveBeenCalledWith('Create a summer promo campaign')
      expect(mockDismiss).toHaveBeenCalled()
    })

    it('logs dismiss click', async function dismissClick() {
      const user = userEvent.setup()
      renderWithProviders(<CampaignSuggestionBanner />)

      await user.click(screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionDismiss] }))

      expect(logClickEvent).toHaveBeenCalledWith('chat.campaignSuggestion.dismiss')
    })

    it('logs other expand click', async function otherExpand() {
      const user = userEvent.setup()
      renderWithProviders(<CampaignSuggestionBanner />)

      await user.click(screen.getByRole('option', { name: '3. Something else...' }))

      expect(logClickEvent).toHaveBeenCalledWith('chat.campaignSuggestion.otherExpand')
    })

    it('logs other cancel on Escape', async function otherCancel() {
      const user = userEvent.setup()
      renderWithProviders(<CampaignSuggestionBanner />)

      await user.click(screen.getByRole('option', { name: '3. Something else...' }))
      const input = screen.getByRole('textbox', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] })
      await user.type(input, 'draft')
      await user.keyboard('{Escape}')

      expect(logClickEvent).toHaveBeenCalledWith('chat.campaignSuggestion.otherCancel')
    })
  })
})
