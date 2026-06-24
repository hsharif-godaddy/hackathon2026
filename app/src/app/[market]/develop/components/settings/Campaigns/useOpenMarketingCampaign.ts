'use client'

import { usePathname } from 'next/navigation'
import { useCallback } from 'react'
import Growl from '@ux/growl'

import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface UseOpenMarketingCampaignResult {
  openList: () => void
  openDetail: (campaignId: string) => void
  isEnabled: boolean
}

export function useOpenMarketingCampaign(): UseOpenMarketingCampaignResult {
  const t: ReturnType<typeof useTranslations> = useTranslations()
  const isEnabled: boolean = useSwitchboard('appbuilder-marketing-campaigns') === true
  const isCanvasTabsEnabled: boolean = useCommanderCanvasTabsEnabled()
  const pathname: string | null = usePathname()
  const isCommanderRoute: boolean = pathname?.includes('/commander/') ?? false
  const useCanvasTabs: boolean = isCanvasTabsEnabled && isCommanderRoute
  const openMarketingList: () => void = useDevelopPageStore((state) => state.openMarketingList)
  const openMarketingDetail: (campaignId: string) => void = useDevelopPageStore((state) => state.openMarketingDetail)

  const notifyDisabled: () => void = useCallback((): void => {
    Growl.addGrowlMessage({
      id: 'marketing-campaigns-disabled',
      title: translateCampaignKey(t, CAMPAIGN_KEYS.disabledForAccount),
      emphasis: 'warning',
      lifetime: 4000,
    })
  }, [t])

  const openList: () => void = useCallback((): void => {
    if (!isEnabled) {
      notifyDisabled()
      return
    }
    if (useCanvasTabs) {
      useCommanderStore.getState().openCanvas(CanvasId.SettingsMarketing)
      useDevelopPageStore.getState().showMarketingList()
      return
    }
    openMarketingList()
  }, [isEnabled, useCanvasTabs, notifyDisabled, openMarketingList])

  const openDetail: (campaignId: string) => void = useCallback((campaignId: string): void => {
    if (!isEnabled) {
      notifyDisabled()
      return
    }
    if (useCanvasTabs) {
      useCommanderStore.getState().openCanvas(CanvasId.SettingsMarketing)
      useDevelopPageStore.getState().showMarketingDetail(campaignId)
      return
    }
    openMarketingDetail(campaignId)
  }, [isEnabled, useCanvasTabs, notifyDisabled, openMarketingDetail])

  return { openList, openDetail, isEnabled }
}
