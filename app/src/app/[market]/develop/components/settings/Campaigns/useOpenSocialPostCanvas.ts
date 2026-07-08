'use client'

import { useCallback } from 'react'
import Growl from '@ux/growl'

import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import type { MarketingSocialOrigin } from '@/app/[market]/develop/components/types'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import type { SocialPostData } from '@/types/social-posts'

interface UseOpenSocialPostCanvasResult {
  openFromCampaign: (post: SocialPostData, campaignId: string) => void
  openFromChat: (post: SocialPostData) => void
  isEnabled: boolean
}

export function useOpenSocialPostCanvas(): UseOpenSocialPostCanvasResult {
  const t: ReturnType<typeof useTranslations> = useTranslations()
  const isEnabled: boolean = useSwitchboard('appbuilder-marketing-campaigns') === true
  const isCanvasTabsEnabled: boolean = useCommanderCanvasTabsEnabled()
  const useCanvasTabs: boolean = isCanvasTabsEnabled
  const activeCanvasId: CanvasId = useCommanderStore((state) => state.activeCanvasId)
  const openMarketingSocialPost: (post: SocialPostData, origin: MarketingSocialOrigin) => void = useDevelopPageStore((state) => state.openMarketingSocialPost)

  const notifyDisabled: () => void = useCallback((): void => {
    Growl.addGrowlMessage({
      id: 'marketing-campaigns-disabled',
      title: translateCampaignKey(t, CAMPAIGN_KEYS.disabledForAccount),
      emphasis: 'warning',
      lifetime: 4000,
    })
  }, [t])

  const open: (post: SocialPostData, origin: MarketingSocialOrigin) => void = useCallback((post: SocialPostData, origin: MarketingSocialOrigin): void => {
    if (!isEnabled) {
      notifyDisabled()
      return
    }
    const nextOrigin: MarketingSocialOrigin = useCanvasTabs && origin.source === 'chat'
      ? { ...origin, previousCanvasId: activeCanvasId }
      : origin
    if (useCanvasTabs) {
      useCommanderStore.getState().openCanvas(CanvasId.SettingsCampaigns)
      useDevelopPageStore.getState().showMarketingSocialPost(post, nextOrigin)
      return
    }
    openMarketingSocialPost(post, nextOrigin)
  }, [activeCanvasId, isEnabled, notifyDisabled, openMarketingSocialPost, useCanvasTabs])

  const openFromCampaign: (post: SocialPostData, campaignId: string) => void = useCallback((post: SocialPostData, campaignId: string): void => {
    open(post, { source: 'campaign', campaignId })
  }, [open])

  const openFromChat: (post: SocialPostData) => void = useCallback((post: SocialPostData): void => {
    open(post, { source: 'chat', previousCanvasId: null })
  }, [open])

  return { openFromCampaign, openFromChat, isEnabled }
}
