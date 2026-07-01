'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import Card, { spaceOptions } from '@ux/card'
import SparklesIcon from '@ux/icon/sparkles'
import XIcon from '@ux/icon/x'

import CampaignSuggestionChoices from '@/app/[market]/develop/components/settings/Campaigns/CampaignSuggestionChoices'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import type { CampaignSuggestion } from '@/app/[market]/develop/hooks/useCampaignSuggestions'
import { useImpression } from '@/hooks/useImpression'
import { useTranslations } from '@/hooks/useTranslations'
import { logClickEvent } from '@/utils/instrumentation'

interface CampaignSuggestionCardProps {
  suggestions: CampaignSuggestion[]
  onSelect: (prompt: string) => void
  onDismiss: () => void
}

export default function CampaignSuggestionCard({ suggestions, onSelect, onDismiss }: CampaignSuggestionCardProps) {
  const t = useTranslations()
  const title = translateCampaignKey(t, CAMPAIGN_KEYS.suggestionTitle)

  useImpression('settings.campaignSuggestion.view', {
    customProperties: { suggestionCount: suggestions.length },
  })

  const handleSelect = ({ prompt, suggestionIndex }: { prompt: string; suggestionIndex: number | 'other' }) => {
    logClickEvent('settings.campaignSuggestion.select', {
      suggestionIndex: suggestionIndex === 'other' ? -1 : suggestionIndex,
      selectionType: suggestionIndex === 'other' ? 'other' : 'preset',
    })()
    onSelect(prompt)
  }

  const handleDismiss = () => {
    logClickEvent('settings.campaignSuggestion.dismiss')()
    onDismiss()
  }

  const handleOtherActivate = () => {
    logClickEvent('settings.campaignSuggestion.otherExpand')()
  }

  const handleOtherCancel = () => {
    logClickEvent('settings.campaignSuggestion.otherCancel')()
  }

  return (
    <Card space={{ block: spaceOptions.MD, inline: spaceOptions.MD }} data-partial="accentAiro">
      <Box orientation="vertical" gap="lg">
        <div className="flex justify-between gap-2 items-center">
          <Box orientation="horizontal" gap="sm" blockAlignChildren="center">
            <SparklesIcon />
            <span className="text-sm font-medium">{title}</span>
          </Box>
          <Button
            design="inline"
            size="sm"
            onClick={handleDismiss}
            icon={<XIcon />}
            aria-label={translateCampaignKey(t, CAMPAIGN_KEYS.suggestionDismiss)}
          />
        </div>
        <CampaignSuggestionChoices
          suggestions={suggestions}
          ariaLabel={title}
          elevatedBackground
          onOtherActivate={handleOtherActivate}
          onOtherCancel={handleOtherCancel}
          onSelect={handleSelect}
        />
      </Box>
    </Card>
  )
}
