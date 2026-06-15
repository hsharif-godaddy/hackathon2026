'use client'

import { useCallback, useEffect, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import MegaphoneIcon from '@ux/icon/megaphone'

import CampaignCard from '@/app/[market]/develop/components/settings/Campaigns/CampaignCard'
import CampaignDetailModal from '@/app/[market]/develop/components/settings/Campaigns/CampaignDetailModal'
import { CAMPAIGN_KEYS, translateCampaignKey } from '@/app/[market]/develop/components/settings/Campaigns/copy'
import type { Campaign } from '@/app/[market]/develop/components/settings/Campaigns/types'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

export default function CampaignsPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const { setActiveChatTab } = useDevelopPageStore()

  const fetchCampaigns = useCallback(async () => {
    if (!appId) return
    try {
      setLoading(true)
      const url = await buildDynamicAgentUrl(`campaigns/${appId}`, appId)
      const response = await agentFetch(url, { siteId: appId })
      if (response.ok) {
        const data = await response.json()
        const campaignList: Campaign[] = data.campaigns || []
        const assetUpdates = await Promise.all(
          campaignList.map(async function fetchDetail(campaign) {
            try {
              const detailUrl = await buildDynamicAgentUrl(`campaigns/${appId}/${campaign.id}`, appId)
              const detailResp = await agentFetch(detailUrl, { siteId: appId })
              if (!detailResp.ok) return null
              const detail = await detailResp.json()
              if (!detail?.campaign?.assets) return null
              return { id: campaign.id, assets: detail.campaign.assets as Campaign['assets'] }
            } catch (error) {
              console.warn('campaigns.fetchDetail.failed', { campaignId: campaign.id, error })
              return null
            }
          }),
        )
        const assetsById = new Map(
          assetUpdates.filter((update): update is { id: string; assets: NonNullable<Campaign['assets']> } => !!update)
            .map((update) => [update.id, update.assets]),
        )
        setCampaigns(campaignList.map((campaign) =>
          assetsById.has(campaign.id) ? { ...campaign, assets: assetsById.get(campaign.id) } : campaign,
        ))
      }
    } catch (error) {
      console.warn('campaigns.fetch.failed', { appId, error })
    } finally {
      setLoading(false)
    }
  }, [appId])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  const handleDeleteCampaign = useCallback(async (campaignId: string) => {
    if (!appId) return
    try {
      const url = await buildDynamicAgentUrl(`campaigns/${appId}/${campaignId}`, appId)
      const response = await agentFetch(url, { siteId: appId, method: 'DELETE' })
      if (response.ok) {
        setCampaigns(prev => prev.filter(c => c.id !== campaignId))
      }
    } catch (error) {
      console.warn('campaigns.delete.failed', { appId, campaignId, error })
    }
  }, [appId])

  const handleCreateCampaign = () => {
    setActiveChatTab(ChatTab.CHAT)
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]')
    if (input) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set
      nativeInputValueSetter?.call(input, translateCampaignKey(t, CAMPAIGN_KEYS.campaignsCreatePrompt))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
    }
  }

  if (!appId) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<MegaphoneIcon width={48} height={48} />}
          title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsNoAppTitle)}
          description={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsNoAppDescription)}
          ctaLabel={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsGoToApps)}
          onCtaClick={() => { window.location.href = '/' }}
        />
      </Box>
    )
  }

  if (loading) {
    return <SettingsLoadingState fullPage title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsLoading)} />
  }

  return (
    <Box className="@container">
      <SettingsSection
        title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsTitle)}
        description={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsDescription)}
        className="min-w-[340px]"
      >
        <div className="flex justify-end mb-2">
          <Button design="primary" size="small" onClick={handleCreateCampaign} text={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsCreate)} />
        </div>

        {campaigns.length === 0 ? (
          <EmptyStateCard
            icon={<MegaphoneIcon width={48} height={48} />}
            title={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsEmptyTitle)}
            description={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsEmptyDescription)}
            ctaLabel={translateCampaignKey(t, CAMPAIGN_KEYS.campaignsCreate)}
            onCtaClick={handleCreateCampaign}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                onDetails={() => setSelectedCampaign(campaign)}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      {selectedCampaign && (
        <CampaignDetailModal
          campaign={selectedCampaign}
          isOpen={!!selectedCampaign}
          onClose={() => setSelectedCampaign(null)}
          onDelete={() => {
            handleDeleteCampaign(selectedCampaign.id)
            setSelectedCampaign(null)
          }}
        />
      )}
    </Box>
  )
}
