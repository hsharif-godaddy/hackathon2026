'use client'

import { useEffect, useRef, useState } from 'react'
import MegaphoneIcon from '@ux/icon/megaphone'

import CampaignCard from '@/app/[market]/develop/components/settings/Campaigns/CampaignCard'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import type { Campaign } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { useOpenMarketingCampaign } from '@/app/[market]/develop/components/settings/Campaigns/useOpenMarketingCampaign'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'

export default function CampaignPlanToolRenderer({
  toolName,
  toolStatus,
  result,
  toolId,
  conversationId,
  ...rest
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const { openDetail } = useOpenMarketingCampaign()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (initializedRef.current || toolStatus !== 'completed' || !result || typeof result !== 'object') return

    const resultObj = result as Record<string, unknown>
    let campaignData: Campaign | null = null

    if (resultObj.widget && typeof resultObj.widget === 'object') {
      const widget = resultObj.widget as Record<string, unknown>
      if (widget.widgetData && typeof widget.widgetData === 'object') {
        const widgetData = widget.widgetData as Record<string, unknown>
        campaignData = widgetData.campaign as Campaign | null
      }
    } else if (resultObj.campaign) {
      campaignData = resultObj.campaign as Campaign
    }

    if (campaignData) {
      initializedRef.current = true
      setCampaign(campaignData)
    }
  }, [toolStatus, result])

  useEffect(() => {
    if (!campaign?.id || !appId) return
    let active = true
    const fetchLiveStatus = async (): Promise<void> => {
      try {
        const url = await buildDynamicAgentUrl(`campaigns/${appId}/${campaign.id}`, appId)
        const response = await agentFetch(url, { siteId: appId })
        if (!active || !response.ok) return
        const data = await response.json() as { campaign?: Campaign }
        if (data?.campaign) {
          setCampaign(data.campaign)
        }
      } catch (error) {
        if (active) {
          logger.warn('campaigns.liveStatus.failed', { appId, campaignId: campaign.id, error })
        }
      }
    }
    void fetchLiveStatus()
    return () => { active = false }
  }, [campaign?.id, appId])

  if (toolStatus === 'error' || (toolStatus === 'completed' && !campaign)) {
    return <DefaultToolRenderer toolName={toolName} toolStatus={toolStatus} result={result} toolId={toolId} conversationId={conversationId} {...rest} />
  }

  if (campaign?.status === 'draft') {
    return null
  }

  if (toolStatus !== 'completed' || !campaign) {
    return (
      <ToolHeader
        icon={<MegaphoneIcon className="w-3 h-3" />}
        displayName={translateCampaignKey(t, CAMPAIGN_KEYS.creatingPlan)}
        toolStatus={toolStatus}
        hasDetails={false}
      />
    )
  }

  return (
    <CampaignCard
      campaign={campaign}
      onDetails={() => openDetail(campaign.id)}
      className="mt-2"
    />
  )
}
