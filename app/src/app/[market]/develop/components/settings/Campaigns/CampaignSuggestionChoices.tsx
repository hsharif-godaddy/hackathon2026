'use client'

import { useState } from 'react'

import { buildCustomCampaignPrompt, CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { ChoiceOptionRow } from '@/app/[market]/develop/components/tool-renderers/choiceOptionRows'
import OptionInput from '@/app/[market]/develop/components/tool-renderers/OptionInput'
import type { CampaignSuggestion } from '@/app/[market]/develop/hooks/useCampaignSuggestions'
import { useTranslations } from '@/hooks/useTranslations'

export interface CampaignSuggestionSelection {
  prompt: string
  suggestionIndex: number | 'other'
}

interface CampaignSuggestionChoicesProps {
  suggestions: CampaignSuggestion[]
  ariaLabel: string
  disabled?: boolean
  elevatedBackground?: boolean
  onOtherActivate?: () => void
  onOtherCancel?: () => void
  onSelect: (selection: CampaignSuggestionSelection) => void
}

export default function CampaignSuggestionChoices({
  suggestions,
  ariaLabel,
  disabled = false,
  elevatedBackground = false,
  onOtherActivate,
  onOtherCancel,
  onSelect,
}: CampaignSuggestionChoicesProps) {
  const t = useTranslations()
  const [otherActive, setOtherActive] = useState(false)
  const [otherDraft, setOtherDraft] = useState('')
  const otherIndex = suggestions.length

  const otherLabel = translateCampaignKey(t, CAMPAIGN_KEYS.suggestionOther)
  const otherPlaceholder = translateCampaignKey(t, CAMPAIGN_KEYS.suggestionOtherPlaceholder)
  const otherAriaLabel = translateCampaignKey(t, CAMPAIGN_KEYS.suggestionOtherAriaLabel)

  const handleSuggestionSelect = (index: number) => {
    const suggestion = suggestions[index]
    if (!suggestion) return
    onSelect({ prompt: suggestion.prompt, suggestionIndex: index })
  }

  const handleOtherActivate = () => {
    onOtherActivate?.()
    setOtherActive(true)
  }

  const handleOtherSubmit = () => {
    const trimmed = otherDraft.trim()
    if (!trimmed) return
    onSelect({ prompt: buildCustomCampaignPrompt(t, trimmed), suggestionIndex: 'other' })
  }

  const choices = (
    <div role="listbox" aria-label={ariaLabel} className="flex flex-col gap-1">
      {suggestions.map((suggestion, index) => (
        <ChoiceOptionRow
          key={index}
          index={index}
          text={suggestion.text}
          isMulti={false}
          isSelected={false}
          disabled={disabled}
          solidBackground={elevatedBackground}
          onClick={() => handleSuggestionSelect(index)}
        />
      ))}
      {!otherActive ? (
        <ChoiceOptionRow
          index={otherIndex}
          text={otherLabel}
          isMulti={false}
          isSelected={false}
          disabled={disabled}
          solidBackground={elevatedBackground}
          onClick={handleOtherActivate}
        />
      ) : (
        <OptionInput
          value={otherDraft}
          disabled={disabled}
          placeholder={otherPlaceholder}
          ariaLabel={otherAriaLabel}
          submitLabel={otherAriaLabel}
          keyboardShortcut={otherIndex + 1}
          solidBackground={elevatedBackground}
          onChange={setOtherDraft}
          onSubmit={handleOtherSubmit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onOtherCancel?.()
              setOtherActive(false)
              setOtherDraft('')
            }
          }}
        />
      )}
    </div>
  )

  return choices
}
