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
import CampaignSuggestionCard from './CampaignSuggestionCard'

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}))

const suggestions = [
  { text: 'Launch a summer promo', prompt: 'Create a summer promo campaign' },
  { text: 'Grow email list', prompt: 'Create an email list growth campaign' },
]

describe('CampaignSuggestionCard', function cardTests() {
  beforeEach(function reset() {
    vi.clearAllMocks()
  })

  it('logs impression on mount with suggestion count', function impression() {
    renderWithProviders(
      <CampaignSuggestionCard suggestions={suggestions} onSelect={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(logImpressionEvent).toHaveBeenCalledWith('settings.campaignSuggestion.view', {
      suggestionCount: 2,
    })
  })

  it('logs select click with suggestion index', async function select() {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(
      <CampaignSuggestionCard suggestions={suggestions} onSelect={onSelect} onDismiss={vi.fn()} />,
    )

    await user.click(screen.getByRole('option', { name: '1. Launch a summer promo' }))

    expect(logClickEvent).toHaveBeenCalledWith('settings.campaignSuggestion.select', {
      suggestionIndex: 0,
      selectionType: 'preset',
    })
    expect(onSelect).toHaveBeenCalledWith('Create a summer promo campaign')
  })

  it('logs dismiss click', async function dismiss() {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    renderWithProviders(
      <CampaignSuggestionCard suggestions={suggestions} onSelect={vi.fn()} onDismiss={onDismiss} />,
    )

    await user.click(screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionDismiss] }))

    expect(logClickEvent).toHaveBeenCalledWith('settings.campaignSuggestion.dismiss')
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('logs other expand click', async function otherExpand() {
    const user = userEvent.setup()
    renderWithProviders(
      <CampaignSuggestionCard suggestions={suggestions} onSelect={vi.fn()} onDismiss={vi.fn()} />,
    )

    await user.click(screen.getByRole('option', { name: '3. Something else...' }))

    expect(logClickEvent).toHaveBeenCalledWith('settings.campaignSuggestion.otherExpand')
  })

  it('logs other select click', async function otherSelect() {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(
      <CampaignSuggestionCard suggestions={suggestions} onSelect={onSelect} onDismiss={vi.fn()} />,
    )

    await user.click(screen.getByRole('option', { name: '3. Something else...' }))
    const input = screen.getByRole('textbox', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] })
    await user.type(input, 'Holiday flash sale')
    await user.click(screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] }))

    expect(logClickEvent).toHaveBeenCalledWith('settings.campaignSuggestion.select', {
      suggestionIndex: -1,
      selectionType: 'other',
    })
    expect(onSelect).toHaveBeenCalledWith('Create a marketing campaign: Holiday flash sale')
  })

  it('logs other cancel on Escape', async function otherCancel() {
    const user = userEvent.setup()
    renderWithProviders(
      <CampaignSuggestionCard suggestions={suggestions} onSelect={vi.fn()} onDismiss={vi.fn()} />,
    )

    await user.click(screen.getByRole('option', { name: '3. Something else...' }))
    const input = screen.getByRole('textbox', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] })
    await user.type(input, 'draft')
    await user.keyboard('{Escape}')

    expect(logClickEvent).toHaveBeenCalledWith('settings.campaignSuggestion.otherCancel')
    expect(screen.getByRole('option', { name: '3. Something else...' })).toBeInTheDocument()
  })
})
