'use client'

import { useEffect, useRef } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Card, { spaceOptions } from '@ux/card'
import SparklesIcon from '@ux/icon/sparkles'
import XIcon from '@ux/icon/x'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import { useLatestNBAs } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import CampaignSuggestionChoices from '@/app/[market]/develop/components/settings/Campaigns/CampaignSuggestionChoices'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { useCampaigns } from '@/app/[market]/develop/components/settings/Campaigns/useCampaigns'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useCampaignSuggestions } from '@/app/[market]/develop/hooks/useCampaignSuggestions'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

export default function CampaignSuggestionBanner() {
  const appId = useAppIdFromParams()
  const { suggestions, loading, dismissed, dismiss, mounted } = useCampaignSuggestions(appId)
  const { campaigns } = useCampaigns(appId ?? undefined)
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const latestNBA = useLatestNBAs()
  const t = useTranslations()
  const hasLoggedImpressionRef = useRef(false)
  const latchedRef = useRef(false)
  const prevAppIdRef = useRef(appId)

  const hasCampaigns = campaigns.length > 0
  const canOffer = mounted && !dismissed && !loading && suggestions.length > 0 && !hasCampaigns

  useEffect(() => {
    if (!mounted || !hasCampaigns || dismissed) return
    logClickEvent('chat.campaignSuggestion.autoDismiss', { reason: 'hasCampaigns' })()
    dismiss()
  }, [mounted, hasCampaigns, dismissed, dismiss])

  // Latch visibility so the banner does not flicker away during streaming/loading.
  if (prevAppIdRef.current !== appId) {
    prevAppIdRef.current = appId
    latchedRef.current = false
    hasLoggedImpressionRef.current = false
  }

  if (dismissed) {
    latchedRef.current = false
  } else if (canOffer) {
    latchedRef.current = true
  }

  const shouldShow = latchedRef.current && canOffer && !latestNBA
  const choicesDisabled = isStreaming || isLoading

  useEffect(() => {
    if (shouldShow && !hasLoggedImpressionRef.current) {
      logImpressionEvent('chat.campaignSuggestion.view', { suggestionCount: suggestions.length })()
      hasLoggedImpressionRef.current = true
    }
  }, [shouldShow, suggestions.length])

  if (!shouldShow) return null

  const title = translateCampaignKey(t, CAMPAIGN_KEYS.suggestionTitle)

  const handleSelect = ({ prompt, suggestionIndex }: { prompt: string; suggestionIndex: number | 'other' }) => {
    if (!sendUserMessage) return
    logClickEvent('chat.campaignSuggestion.select', {
      suggestionIndex: suggestionIndex === 'other' ? -1 : suggestionIndex,
      selectionType: suggestionIndex === 'other' ? 'other' : 'preset',
    })()
    sendUserMessage(prompt)
    dismiss()
  }

  const handleDismiss = () => {
    logClickEvent('chat.campaignSuggestion.dismiss')()
    dismiss()
  }

  const handleOtherActivate = () => {
    logClickEvent('chat.campaignSuggestion.otherExpand')()
  }

  const handleOtherCancel = () => {
    logClickEvent('chat.campaignSuggestion.otherCancel')()
  }

  return (
    <div className="mb-2">
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
            disabled={choicesDisabled}
            elevatedBackground
            onOtherActivate={handleOtherActivate}
            onOtherCancel={handleOtherCancel}
            onSelect={handleSelect}
          />
        </Box>
      </Card>
    </div>
  )
}
