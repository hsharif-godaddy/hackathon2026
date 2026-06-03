'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import MegaphoneIcon from '@ux/icon/megaphone'
import Tag from '@ux/tag'
import text from '@ux/text'

import CampaignDetailModal from '@/app/[market]/develop/components/settings/Campaigns/CampaignDetailModal'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { useToolResultSync } from '@/hooks/useToolResultSync'
import { agentFetch } from '@/lib/agent-fetch'
import { useIsActivelyStreaming, useIsLoading,useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

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
  appId: string
  name: string
  campaignType: 'landing-page' | 'banner' | 'content-only'
  status: 'draft' | 'ready' | 'active' | 'completed' | 'archived'
  offer: string
  startDate: string
  endDate: string
  landingPagePath?: string
  createdAt: string
  updatedAt: string
  assets?: CampaignAsset[]
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_CONFIG: Record<string, { label: string; emphasis: 'info' | 'success' | 'warning' | 'neutral' }> = {
  draft: { label: 'Plan Review', emphasis: 'warning' },
  ready: { label: 'Ready to Launch', emphasis: 'info' },
  active: { label: 'Launched', emphasis: 'success' },
  completed: { label: 'Completed', emphasis: 'neutral' },
}

export default function CampaignPlanToolRenderer({
  toolName,
  toolStatus,
  result,
  toolId,
  conversationId,
  ...rest
}: DefaultToolRendererProps) {
  const currentAppId = useStreamingConversationStore(state => state.currentAppId)
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [isLaunching, setIsLaunching] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const initializedRef = useRef(false)

  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()

  const syncResult = useToolResultSync({
    conversationId: conversationId || null,
    toolId: toolId || '',
    appId: currentAppId || ''
  })

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

  const handleLaunch = useCallback(async () => {
    if (!campaign || !currentAppId) return
    setIsLaunching(true)

    try {
      const url = await buildDynamicAgentUrl(`campaigns/${currentAppId}/${campaign.id}/launch`, currentAppId)
      const response = await agentFetch(url, {
        siteId: currentAppId,
        method: 'POST',
      })

      if (response.ok) {
        const data = await response.json()
        const updated = data.campaign || { ...campaign, status: 'active' as const }
        setCampaign(updated)
        syncResult({ widget: { widgetData: { campaign: updated } } })
      }
    } catch {
      const updated = { ...campaign, status: 'active' as const }
      setCampaign(updated)
      syncResult({ widget: { widgetData: { campaign: updated } } })
    } finally {
      setIsLaunching(false)
    }
  }, [campaign, currentAppId, syncResult])

  if (toolStatus === 'error' || (toolStatus === 'completed' && !campaign)) {
    return <DefaultToolRenderer toolName={toolName} toolStatus={toolStatus} result={result} toolId={toolId} conversationId={conversationId} {...rest} />
  }

  if (campaign?.status === 'draft') {
    return null
  }

  const displayName = campaign
    ? `Campaign Plan: ${campaign.name}`
    : 'Creating campaign plan...'

  const assetCount = campaign?.assets?.length || 0
  const isLaunched = campaign?.status === 'active'
  const isReady = campaign?.status === 'ready'
  const statusConfig = STATUS_CONFIG[campaign?.status || 'draft'] || STATUS_CONFIG.draft

  return (
    <div>
      <ToolHeader
        icon={<MegaphoneIcon className="w-3 h-3" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={!!campaign}
        onOpenModal={campaign ? () => setIsModalOpen(true) : undefined}
      />

      {toolStatus === 'completed' && campaign && (
        <div className="mt-2 rounded-lg border border-intents-ux-border-default p-4">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <text.strong>{campaign.name}</text.strong>
              <text.span as="caption" emphasis="neutral">
                {campaign.offer}
              </text.span>
              <text.span as="caption" emphasis="passive">
                {formatDate(campaign.startDate)} — {formatDate(campaign.endDate)}
              </text.span>
              {assetCount > 0 && (
                <text.span as="caption" emphasis="passive">
                  {assetCount} content piece{assetCount !== 1 ? 's' : ''} planned
                </text.span>
              )}
            </div>
            <Tag emphasis={statusConfig.emphasis} size="sm">
              {statusConfig.label}
            </Tag>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              design="secondary"
              size="small"
              onClick={() => setIsModalOpen(true)}
            >
              Details
            </Button>

            {isReady && !isLaunched && (
              <Button
                design="primary"
                size="small"
                onClick={handleLaunch}
                disabled={isLaunching || isStreaming || isLoading}
              >
                {isLaunching ? 'Launching...' : 'Launch Campaign'}
              </Button>
            )}
          </div>

          {isReady && !isLaunched && (
            <div className="mt-3 p-2 rounded bg-intents-ux-feedbackInfo-backgroundColor text-intents-ux-feedbackInfo-textColor text-sm">
              Content generated! Review the details, then launch when ready.
            </div>
          )}

          {isLaunched && (
            <div className="mt-3 p-2 rounded bg-intents-ux-feedbackPositive-backgroundColor text-intents-ux-feedbackPositive-textColor text-sm">
              Campaign launched! Content will be published according to schedule.
            </div>
          )}
        </div>
      )}

      {campaign && (
        <CampaignDetailModal
          campaign={campaign}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  )
}
