'use client'

import { useCallback, useEffect } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Growl from '@ux/growl'
import text from '@ux/text'

import CampaignDetailView from '@/app/[market]/develop/components/settings/Campaigns/CampaignDetailView'
import CampaignListView from '@/app/[market]/develop/components/settings/Campaigns/CampaignListView'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { useCampaigns } from '@/app/[market]/develop/components/settings/Campaigns/useCampaigns'
import { useOpenMarketingCampaign } from '@/app/[market]/develop/components/settings/Campaigns/useOpenMarketingCampaign'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface MarketingCanvasPaneProps {
  /** Called when the user clicks Back in list view. Omit to hide the back button. */
  onBack?: () => void
}

export default function MarketingCanvasPane({ onBack }: MarketingCanvasPaneProps = {}) {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const marketingView = useDevelopPageStore((state) => state.marketingView)
  const selectedCampaignId = useDevelopPageStore((state) => state.selectedCampaignId)
  const showMarketingList = useDevelopPageStore((state) => state.showMarketingList)
  const { openDetail } = useOpenMarketingCampaign()
  const { campaigns, getCampaignById, deleteCampaign, loading, error, fetchCampaigns } = useCampaigns(appId)

  const handleSelectCampaign = useCallback((campaign: { id: string }) => {
    openDetail(campaign.id)
  }, [openDetail])

  const handleDelete = useCallback(async () => {
    if (!selectedCampaignId) return
    const deleted = await deleteCampaign(selectedCampaignId)
    if (deleted) {
      showMarketingList()
      return
    }
    Growl.addGrowlMessage({
      id: 'campaign-delete-failed',
      title: translateCampaignKey(t, CAMPAIGN_KEYS.deleteFailed),
      emphasis: 'critical',
      lifetime: 4000,
    })
  }, [selectedCampaignId, deleteCampaign, showMarketingList, t])

  const campaign = selectedCampaignId ? getCampaignById(selectedCampaignId) : null

  useEffect(() => {
    if (marketingView !== 'detail' || loading || !selectedCampaignId || campaign) return
    showMarketingList()
    Growl.addGrowlMessage({
      id: 'campaign-not-found',
      title: translateCampaignKey(t, CAMPAIGN_KEYS.notFound),
      emphasis: 'warning',
      lifetime: 4000,
    })
  }, [marketingView, loading, selectedCampaignId, campaign, showMarketingList, t])

  const shellClass = 'h-full flex flex-col'
  const innerClass = 'relative h-full overflow-auto rounded-lg md:rounded-b-none border bg-intents-ux-box-backgroundColor'

  if (error && marketingView === 'list') {
    return (
      <div className={shellClass}>
        <div className={innerClass}>
          <Box
            gap="md"
            inlineAlignChildren="center"
            className="mx-auto w-full max-w-3xl"
            blockPadding="lg"
            inlinePadding="lg"
          >
            <text.p>{translateCampaignKey(t, CAMPAIGN_KEYS.fetchError)}</text.p>
            <Button
              design="primary"
              size="small"
              text={translateCampaignKey(t, CAMPAIGN_KEYS.retry)}
              onClick={() => { void fetchCampaigns() }}
            />
          </Box>
        </div>
      </div>
    )
  }

  if (marketingView === 'list') {
    return (
      <div className={shellClass}>
        <div className={innerClass}>
          <CampaignListView
            campaigns={campaigns}
            loading={loading}
            onSelectCampaign={handleSelectCampaign}
            onBack={onBack}
          />
        </div>
      </div>
    )
  }

  if (loading && !campaign) {
    return (
      <div className={shellClass}>
        <div className={innerClass}>
          <SettingsLoadingState fullPage title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsLoading)} />
        </div>
      </div>
    )
  }

  if (!campaign) {
    return null
  }

  return (
    <div className={shellClass}>
      <div className={innerClass}>
        <CampaignDetailView
          campaign={campaign}
          onBack={showMarketingList}
          onDelete={handleDelete}
        />
      </div>
    </div>
  )
}
