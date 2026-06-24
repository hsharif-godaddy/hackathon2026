'use client'

import type { Campaign } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'

export const CAMPAIGNS_QUERY_KEY = 'campaigns'

export async function fetchCampaignList(appId: string): Promise<Campaign[]> {
  const url = await buildDynamicAgentUrl(`campaigns/${appId}`, appId)
  const response = await agentFetch(url, { siteId: appId })
  if (!response.ok) throw new Error('Failed to load campaigns')
  const data = await response.json() as { campaigns?: Campaign[] }
  const campaignList = data.campaigns ?? []
  return Promise.all(campaignList.map((c) => fetchCampaignWithAssets(appId, c)))
}

export async function fetchCampaignWithAssets(appId: string, campaign: Campaign): Promise<Campaign> {
  try {
    const url = await buildDynamicAgentUrl(`campaigns/${appId}/${campaign.id}`, appId)
    const response = await agentFetch(url, { siteId: appId })
    if (!response.ok) return campaign
    const detail = await response.json() as { campaign?: Campaign }
    if (!detail?.campaign?.assets) return campaign
    return { ...campaign, assets: detail.campaign.assets }
  } catch (error) {
    logger.warn('campaigns.fetchDetail.failed', { campaignId: campaign.id, error })
    return campaign
  }
}

export async function deleteCampaignRequest(appId: string, campaignId: string): Promise<boolean> {
  const url = await buildDynamicAgentUrl(`campaigns/${appId}/${campaignId}`, appId)
  const response = await agentFetch(url, { siteId: appId, method: 'DELETE' })
  return response.ok
}
