'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import MegaphoneIcon from '@ux/icon/megaphone'
import text from '@ux/text'

import CampaignCard from '@/app/[market]/develop/components/settings/Campaigns/CampaignCard'
import CampaignSuggestionCard from '@/app/[market]/develop/components/settings/Campaigns/CampaignSuggestionCard'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { focusChatWithCreateCampaignPrompt } from '@/app/[market]/develop/components/settings/Campaigns/createCampaignInChat'
import { useCampaigns } from '@/app/[market]/develop/components/settings/Campaigns/useCampaigns'
import { useOpenMarketingCampaign } from '@/app/[market]/develop/components/settings/Campaigns/useOpenMarketingCampaign'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useCampaignSuggestions } from '@/app/[market]/develop/hooks/useCampaignSuggestions'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useTranslations } from '@/hooks/useTranslations'
import { logClickEvent } from '@/utils/instrumentation'

export default function CampaignsPanel() {
  const t = useTranslations()
  const router = useRouter()
  const appId = useAppIdFromParams()
  const { campaigns, loading, error, fetchCampaigns } = useCampaigns(appId)
  const { openDetail, openList } = useOpenMarketingCampaign()
  const { suggestions, dismissed, dismiss, mounted } = useCampaignSuggestions(appId)

  const handleCreateCampaign = useCallback((prompt?: string, source: 'header' | 'empty_state' | 'suggestion' = 'header') => {
    logClickEvent('settings.campaigns.create', { source })()
    focusChatWithCreateCampaignPrompt(t, prompt)
  }, [t])

  if (!appId) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<MegaphoneIcon width={48} height={48} />}
          title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsNoAppTitle)}
          description={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsNoAppDescription)}
          ctaLabel={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsGoToApps)}
          onCtaClick={() => router.push('/')}
        />
      </Box>
    )
  }

  if (loading) {
    return <SettingsLoadingState fullPage title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsLoading)} />
  }

  if (error) {
    return (
      <Box gap="md" inlineAlignChildren="center" blockPadding="lg" inlinePadding="lg">
        <text.p>{translateCampaignKey(t, CAMPAIGN_KEYS.fetchError)}</text.p>
        <Button
          design="primary"
          size="small"
          text={translateCampaignKey(t, CAMPAIGN_KEYS.retry)}
          onClick={() => { void fetchCampaigns() }}
        />
      </Box>
    )
  }

  return (
    <Box className="@container">
      <SettingsSection
        title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsTitle)}
        description={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsDescription)}
        className="min-w-[340px]"
      >
        <Box orientation="horizontal" inlineAlignChildren="end" gap="sm">
          <Button design="secondary" size="small" onClick={openList} text={translateCampaignKey(t, CAMPAIGN_KEYS.marketingTab)} />
          <Button design="primary" size="small" onClick={() => handleCreateCampaign()} text={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsCreate)} />
        </Box>

        {campaigns.length === 0 ? (
          mounted && !dismissed && suggestions.length > 0 ? (
            <CampaignSuggestionCard
              suggestions={suggestions}
              onSelect={(prompt) => { dismiss(); handleCreateCampaign(prompt, 'suggestion') }}
              onDismiss={dismiss}
            />
          ) : (
            <EmptyStateCard
              icon={<MegaphoneIcon width={48} height={48} />}
              title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsEmptyTitle)}
              description={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsEmptyDescription)}
              ctaLabel={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsCreate)}
              onCtaClick={() => handleCreateCampaign(undefined, 'empty_state')}
            />
          )
        ) : (
          <Box gap="md">
            {campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                showLabels
                onDetails={() => openDetail(campaign.id)}
              />
            ))}
          </Box>
        )}
      </SettingsSection>
    </Box>
  )
}
