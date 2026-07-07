'use client'

import { useCallback, useEffect, useRef } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Growl from '@ux/growl'
import text from '@ux/text'

import CampaignDetailView from '@/app/[market]/develop/components/settings/Campaigns/CampaignDetailView'
import CampaignListView from '@/app/[market]/develop/components/settings/Campaigns/CampaignListView'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { SocialPostCanvasPane } from '@/app/[market]/develop/components/settings/Campaigns/SocialPostCanvasPane'
import { useCampaigns } from '@/app/[market]/develop/components/settings/Campaigns/useCampaigns'
import { useOpenMarketingCampaign } from '@/app/[market]/develop/components/settings/Campaigns/useOpenMarketingCampaign'
import { useOpenSocialPostCanvas } from '@/app/[market]/develop/components/settings/Campaigns/useOpenSocialPostCanvas'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useSocialPosts } from '@/hooks/useSocial'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

export default function MarketingCanvasPane() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const marketingView = useDevelopPageStore((state) => state.marketingView)
  const selectedCampaignId = useDevelopPageStore((state) => state.selectedCampaignId)
  const selectedSocialPost = useDevelopPageStore((state) => state.selectedSocialPost)
  const marketingSocialOrigin = useDevelopPageStore((state) => state.marketingSocialOrigin)
  const showMarketingList = useDevelopPageStore((state) => state.showMarketingList)
  const showMarketingSocialPost = useDevelopPageStore((state) => state.showMarketingSocialPost)
  const closeMarketingSocialPost = useDevelopPageStore((state) => state.closeMarketingSocialPost)
  const { openDetail } = useOpenMarketingCampaign()
  const { openFromCampaign } = useOpenSocialPostCanvas()
  const { campaigns, getCampaignById, deleteCampaign, loading, error, fetchCampaigns } = useCampaigns(appId)
  const { data: socialPosts = [], isError: isSocialPostsError, error: socialPostsError } = useSocialPosts(
    appId || '',
    Boolean(appId && (marketingView !== 'list' || selectedSocialPost)),
  )
  const pendingCampaignHydrationRef = useRef<Set<string>>(new Set())
  const lastSocialFetchErrorRef = useRef<string | null>(null)

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

  const handleEditAsset = useCallback((asset: {
    id: string
    assetType: string
    assetRef: string
    title: string
    contentPreview?: string
    imageUrl?: string
  }) => {
    if (!selectedCampaignId || asset.assetType !== 'social') return
    const fromLookup = socialPosts.find((post) => post.id === asset.assetRef)
    if (!fromLookup && asset.assetRef) {
      pendingCampaignHydrationRef.current.add(asset.assetRef)
    } else if (asset.assetRef) {
      pendingCampaignHydrationRef.current.delete(asset.assetRef)
    }
    const post = fromLookup ?? {
      id: asset.assetRef,
      styleLabel: asset.title || 'Social Post',
      content: asset.contentPreview || '',
      hashtags: [],
      images: asset.imageUrl ? [{ url: asset.imageUrl, width: 1024, height: 1024 }] : [],
    }
    openFromCampaign({
      ...post,
      campaignId: selectedCampaignId,
      campaignContentId: asset.id,
    }, selectedCampaignId)
  }, [openFromCampaign, selectedCampaignId, socialPosts])

  useEffect(() => {
    if (!isSocialPostsError) return
    const details = socialPostsError instanceof Error ? socialPostsError.message : String(socialPostsError ?? 'unknown')
    if (lastSocialFetchErrorRef.current === details) return
    lastSocialFetchErrorRef.current = details
    logger.warn('marketing.social-posts.fetch.failed', { appId, error: details })
  }, [appId, isSocialPostsError, socialPostsError, t])

  useEffect(() => {
    if (!selectedSocialPost?.id || !marketingSocialOrigin) return
    if (
      selectedSocialPost.campaignContentId
      && !pendingCampaignHydrationRef.current.has(selectedSocialPost.id)
    ) {
      return
    }
    const fromLookup = socialPosts.find((post) => post.id === selectedSocialPost.id)
    if (!fromLookup) return
    if (fromLookup.content === selectedSocialPost.content && fromLookup.images?.length === selectedSocialPost.images?.length) return
    const merged = {
      ...selectedSocialPost,
      ...fromLookup,
      campaignId: selectedSocialPost.campaignId,
      campaignContentId: selectedSocialPost.campaignContentId,
    }
    if (selectedSocialPost.campaignContentId) {
      pendingCampaignHydrationRef.current.delete(selectedSocialPost.id)
    }
    showMarketingSocialPost(merged, marketingSocialOrigin)
  }, [marketingSocialOrigin, selectedSocialPost, showMarketingSocialPost, socialPosts])

  const handleSocialBack = useCallback(() => {
    const previousCanvasId = marketingSocialOrigin?.source === 'chat'
      ? marketingSocialOrigin.previousCanvasId
      : null
    closeMarketingSocialPost()
    if (previousCanvasId) {
      useCommanderStore.getState().openCanvas(previousCanvasId)
    }
  }, [closeMarketingSocialPost, marketingSocialOrigin])

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
  const innerClass = 'relative h-full overflow-auto rounded-lg md:rounded-b-none bg-intents-ux-box-backgroundColor'

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
          />
        </div>
      </div>
    )
  }

  if (loading && !campaign && !selectedSocialPost) {
    return (
      <div className={shellClass}>
        <div className={innerClass}>
          <SettingsLoadingState fullPage title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsLoading)} />
        </div>
      </div>
    )
  }

  if (!campaign) {
    if (selectedSocialPost && appId) {
      return (
        <div className={shellClass}>
          <div className={innerClass}>
            <SocialPostCanvasPane
              post={selectedSocialPost}
              appId={appId}
              onBack={handleSocialBack}
            />
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className={shellClass}>
      <div className={innerClass}>
        {selectedSocialPost && appId ? (
          <SocialPostCanvasPane
            post={selectedSocialPost}
            appId={appId}
            onBack={handleSocialBack}
          />
        ) : (
          <CampaignDetailView
            campaign={campaign}
            onBack={showMarketingList}
            onDelete={handleDelete}
            onEditAsset={handleEditAsset}
          />
        )}
      </div>
    </div>
  )
}
