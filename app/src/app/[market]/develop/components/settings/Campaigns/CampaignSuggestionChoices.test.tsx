/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CAMPAIGN_KEYS } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { CAMPAIGN_DEFAULT_MESSAGES } from '@/lib/translations/campaign-defaults'
import { renderWithProviders } from '@/tests/test-utils'
import CampaignSuggestionChoices from './CampaignSuggestionChoices'

const suggestions = [
  { text: 'Launch a summer promo', prompt: 'Create a summer promo campaign' },
  { text: 'Grow email list', prompt: 'Create an email list growth campaign' },
]

describe('CampaignSuggestionChoices', function choicesTests() {
  it('renders preset suggestions and Other option', function options() {
    renderWithProviders(
      <CampaignSuggestionChoices suggestions={suggestions} ariaLabel="Campaign suggestions" onSelect={vi.fn()} />,
    )

    expect(screen.getByRole('option', { name: '1. Launch a summer promo' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2. Grow email list' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '3. Something else...' })).toBeInTheDocument()
  })

  it('calls onSelect with preset prompt', async function preset() {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(
      <CampaignSuggestionChoices suggestions={suggestions} ariaLabel="Campaign suggestions" onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('option', { name: '1. Launch a summer promo' }))

    expect(onSelect).toHaveBeenCalledWith({
      prompt: 'Create a summer promo campaign',
      suggestionIndex: 0,
    })
  })

  it('uses solid white backgrounds when elevatedBackground is set', function elevated() {
    renderWithProviders(
      <CampaignSuggestionChoices
        suggestions={suggestions}
        ariaLabel="Campaign suggestions"
        elevatedBackground
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('option', { name: '1. Launch a summer promo' }))
      .toHaveStyle({ backgroundColor: '#fff' })
  })

  it('uses solid white background on Other input when elevatedBackground is set', async function elevatedOther() {
    const user = userEvent.setup()
    renderWithProviders(
      <CampaignSuggestionChoices
        suggestions={suggestions}
        ariaLabel="Campaign suggestions"
        elevatedBackground
        onSelect={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('option', { name: '3. Something else...' }))

    expect(screen.getByRole('textbox', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] }).parentElement?.parentElement)
      .toHaveStyle({ backgroundColor: '#fff' })
  })

  it('shows custom input after Other is selected and submits wrapped prompt', async function other() {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(
      <CampaignSuggestionChoices suggestions={suggestions} ariaLabel="Campaign suggestions" onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('option', { name: '3. Something else...' }))
    expect(screen.queryByRole('option', { name: '3. Something else...' })).not.toBeInTheDocument()

    const input = screen.getByRole('textbox', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] })
    await user.type(input, 'Holiday flash sale')
    await user.click(screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] }))

    expect(onSelect).toHaveBeenCalledWith({
      prompt: 'Create a marketing campaign: Holiday flash sale',
      suggestionIndex: 'other',
    })
  })

  it('does not submit Other when input is whitespace only', async function otherWhitespace() {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderWithProviders(
      <CampaignSuggestionChoices suggestions={suggestions} ariaLabel="Campaign suggestions" onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('option', { name: '3. Something else...' }))
    const input = screen.getByRole('textbox', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] })
    await user.type(input, '   ')
    await user.click(screen.getByRole('button', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] }))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('calls onOtherActivate when Other is clicked', async function otherActivate() {
    const user = userEvent.setup()
    const onOtherActivate = vi.fn()
    renderWithProviders(
      <CampaignSuggestionChoices
        suggestions={suggestions}
        ariaLabel="Campaign suggestions"
        onOtherActivate={onOtherActivate}
        onSelect={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('option', { name: '3. Something else...' }))

    expect(onOtherActivate).toHaveBeenCalledOnce()
  })

  it('calls onOtherCancel when Escape is pressed in Other input', async function otherCancel() {
    const user = userEvent.setup()
    const onOtherCancel = vi.fn()
    renderWithProviders(
      <CampaignSuggestionChoices
        suggestions={suggestions}
        ariaLabel="Campaign suggestions"
        onOtherCancel={onOtherCancel}
        onSelect={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('option', { name: '3. Something else...' }))
    const input = screen.getByRole('textbox', { name: CAMPAIGN_DEFAULT_MESSAGES[CAMPAIGN_KEYS.suggestionOtherAriaLabel] })
    await user.type(input, 'draft')
    await user.keyboard('{Escape}')

    expect(onOtherCancel).toHaveBeenCalledOnce()
  })
})
