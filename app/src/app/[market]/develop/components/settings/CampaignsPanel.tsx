'use client'

import { useCallback, useEffect, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import MegaphoneIcon from '@ux/icon/megaphone'
import Tag from '@ux/tag'
import text from '@ux/text'

import CampaignDetailModal from '@/app/[market]/develop/components/settings/Campaigns/CampaignDetailModal'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import EmptyStateCard from '@/components/layout/EmptyStateCard'
import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

interface CampaignAsset {
  id: string
  assetType: 'landing-page' | 'banner' | 'blog' | 'social' | 'email' | 'ad'
  assetRef: string
  title: string
  scheduledDate?: string
  status: 'draft' | 'scheduled' | 'published' | 'sent'
  contentPreview?: string
  imageUrl?: string
}

interface Campaign {
  id: string
  name: string
  campaignType: 'landing-page' | 'banner' | 'content-only'
  status: 'draft' | 'ready' | 'active' | 'completed' | 'archived'
  offer: string
  startDate: string
  endDate: string
  landingPagePath?: string
  createdAt: string
  assets?: CampaignAsset[]
}

const STATUS_EMPHASIS: Record<string, 'info' | 'success' | 'neutral' | 'warning'> = {
  draft: 'warning',
  ready: 'info',
  active: 'success',
  completed: 'neutral',
  archived: 'neutral',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Plan Review',
  ready: 'Ready to Launch',
  active: 'Launched',
  completed: 'Completed',
  archived: 'Archived',
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function CampaignCard({ campaign, onDetails, onLaunch }: {
  campaign: Campaign
  onDetails: () => void
  onLaunch?: () => void
}) {
  const assetCount = campaign.assets?.length || 0
  const canLaunch = campaign.status === 'ready' || campaign.status === 'draft'

  return (
    <div className="border border-intents-ux-border-default rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <text.strong className="truncate">{campaign.name}</text.strong>
            <Tag emphasis={STATUS_EMPHASIS[campaign.status] || 'neutral'} size="sm">
              {STATUS_LABELS[campaign.status] || campaign.status}
            </Tag>
          </div>
          <text.span as="caption" emphasis="passive">
            {campaign.offer}
          </text.span>
          <text.span as="caption" emphasis="passive">
            {formatDate(campaign.startDate)} — {formatDate(campaign.endDate)}
            {assetCount > 0 && ` · ${assetCount} content piece${assetCount !== 1 ? 's' : ''}`}
          </text.span>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button design="secondary" size="small" onClick={onDetails}>
          Details
        </Button>
        {canLaunch && onLaunch && (
          <Button design="primary" size="small" onClick={onLaunch}>
            Launch Campaign
          </Button>
        )}
      </div>
    </div>
  )
}

export default function CampaignsPanel() {
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
        const campaignList = data.campaigns || []
        setCampaigns(campaignList)

        for (const campaign of campaignList) {
          const detailUrl = await buildDynamicAgentUrl(`campaigns/${appId}/${campaign.id}`, appId)
          const detailResp = await agentFetch(detailUrl, { siteId: appId })
          if (detailResp.ok) {
            const detail = await detailResp.json()
            if (detail?.campaign?.assets) {
              setCampaigns(prev => prev.map(c =>
                c.id === campaign.id ? { ...c, assets: detail.campaign.assets } : c
              ))
            }
          }
        }
      }
    } catch {
      // silently fail for POC
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
    } catch {
      // silently fail for POC
    }
  }, [appId])

  const handleLaunchCampaign = useCallback(async (campaignId: string) => {
    if (!appId) return
    try {
      const url = await buildDynamicAgentUrl(`campaigns/${appId}/${campaignId}/launch`, appId)
      const response = await agentFetch(url, { siteId: appId, method: 'POST' })
      if (response.ok) {
        setCampaigns(prev => prev.map(c =>
          c.id === campaignId ? { ...c, status: 'active' as const } : c
        ))
      }
    } catch {
      // silently fail for POC
    }
  }, [appId])

  const handleCreateCampaign = () => {
    setActiveChatTab(ChatTab.CHAT)
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]')
    if (input) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set
      nativeInputValueSetter?.call(input, 'create a marketing campaign')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
    }
  }

  if (!appId) {
    return (
      <Box gap="lg" className="@container">
        <EmptyStateCard
          icon={<MegaphoneIcon width={48} height={48} />}
          title="No app selected"
          description="Select an app to view its campaigns."
          ctaLabel="Go to Apps"
          onCtaClick={() => { window.location.href = '/' }}
        />
      </Box>
    )
  }

  if (loading) {
    return <SettingsLoadingState fullPage title="Loading campaigns..." />
  }

  return (
    <Box className="@container">
      <SettingsSection
        title="Marketing Campaigns"
        description="Track your marketing campaigns, content schedule, and performance"
        className="min-w-[340px]"
      >
        <div className="flex justify-end mb-4">
          <Button design="primary" size="small" onClick={handleCreateCampaign}>
            Create Campaign
          </Button>
        </div>

        {campaigns.length === 0 ? (
          <EmptyStateCard
            icon={<MegaphoneIcon width={48} height={48} />}
            title="No campaigns yet"
            description="Ask Airo to create a marketing campaign. It will generate a plan with blog posts, social content, and ads tailored to your business."
            ctaLabel="Create Campaign"
            onCtaClick={handleCreateCampaign}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                onDetails={() => setSelectedCampaign(campaign)}
                onLaunch={() => handleLaunchCampaign(campaign.id)}
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
