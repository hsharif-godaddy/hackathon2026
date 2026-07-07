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
import type { Campaign } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { useTranslations } from '@/hooks/useTranslations'
import { logClickEvent } from '@/utils/instrumentation'

interface CampaignListViewProps {
  campaigns: Campaign[]
  loading: boolean
  onSelectCampaign: (campaign: Campaign) => void
}

export default function CampaignListView({ campaigns, loading, onSelectCampaign }: CampaignListViewProps) {
  const t = useTranslations()
  const router = useRouter()
  const appId = useAppIdFromParams()

  const handleCreate = useCallback((): void => {
    logClickEvent('settings.campaigns.create')()
    focusChatWithCreateCampaignPrompt(t)
  }, [t])

  if (!appId) {
    return (
      <EmptyStateCard
        icon={<MegaphoneIcon width={48} height={48} />}
        title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsNoAppTitle)}
        description={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsNoAppDescription)}
        ctaLabel={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsGoToApps)}
        onCtaClick={() => router.push('/')}
      />
    )
  }

  if (loading) {
    return <SettingsLoadingState fullPage title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsLoading)} />
  }

  return (
    <Box gap="lg" className="w-full p-5">
      <Box gap="sm">
        <Box
          orientation="horizontal"
          blockAlignChildren="spaceBetween"
          inlineAlignChildren="center"
          gap="md"
        >
          <text.span as="title" size={2} className="truncate flex-1 min-w-0">
            {translateCampaignKey(t, CAMPAIGN_KEYS.campaignsTitle)}
          </text.span>

          <Button
            design="primary"
            size="small"
            onClick={handleCreate}
            text={translateCampaignKey(t, CAMPAIGN_KEYS.createNew)}
            className="shrink-0"
          />
        </Box>

        <text.span as="caption" emphasis="passive">
          {translateCampaignKey(t, CAMPAIGN_KEYS.listPageDescription)}
        </text.span>
      </Box>

      {campaigns.length === 0 ? (
        <EmptyStateCard
          icon={<MegaphoneIcon width={48} height={48} />}
          title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsEmptyTitle)}
          description={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsEmptyDescription)}
          ctaLabel={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsCreate)}
          onCtaClick={handleCreate}
        />
      ) : (
        <Box gap="md">
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              showLabels
              onDetails={() => onSelectCampaign(campaign)}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}
