'use client'

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import MegaphoneIcon from '@ux/icon/megaphone'
import text from '@ux/text'

import CampaignCard from '@/app/[market]/develop/components/settings/Campaigns/CampaignCard'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { focusChatWithCreateCampaignPrompt } from '@/app/[market]/develop/components/settings/Campaigns/createCampaignInChat'
import { useCampaigns } from '@/app/[market]/develop/components/settings/Campaigns/useCampaigns'
import { useOpenMarketingCampaign } from '@/app/[market]/develop/components/settings/Campaigns/useOpenMarketingCampaign'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useTranslations } from '@/hooks/useTranslations'

export default function CampaignsPanel() {
  const t = useTranslations()
  const router = useRouter()
  const appId = useAppIdFromParams()
  const { campaigns, loading, error, fetchCampaigns } = useCampaigns(appId)
  const { openDetail, openList } = useOpenMarketingCampaign()

  const handleCreateCampaign = useCallback(() => {
    focusChatWithCreateCampaignPrompt(t)
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
          <Button design="primary" size="small" onClick={handleCreateCampaign} text={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsCreate)} />
        </Box>

        {campaigns.length === 0 ? (
          <EmptyStateCard
            icon={<MegaphoneIcon width={48} height={48} />}
            title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsEmptyTitle)}
            description={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsEmptyDescription)}
            ctaLabel={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsCreate)}
            onCtaClick={handleCreateCampaign}
          />
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
