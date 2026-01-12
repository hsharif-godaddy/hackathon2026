'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import { text, type Emphasis } from '@ux/text'

import { usePublishFlow } from '@/hooks/social/usePublishFlow'
import { PublishFlowState, type PendingPublish, type PublishResult, type PublishStatus, type SocialPostData } from '@/types/social-posts'
import { useToolResultSync } from '@/hooks/useToolResultSync'
import { useTranslations } from '@/hooks/useTranslations'
import { PLATFORM_CONFIG } from '@/lib/social-platforms'
import { emitPostPublished } from '@/utils/social'

interface SocialPublishWidgetProps {
  appId: string
  publishId: string
  toolId: string
  conversationId: string | null
  initialResult?: Record<string, unknown> | string
}

export function SocialPublishWidget({ appId, publishId, toolId, conversationId, initialResult }: SocialPublishWidgetProps) {
  const t = useTranslations()
  const emittedRef = useRef(false)

  // Initialize local state from tool result (contains pendingPublish and postData)
  const [localState, setLocalState] = useState<{
    pendingPublish: PendingPublish | null
    postData: SocialPostData | null
    publishStatus: PublishStatus | null
    publishResult: PublishResult | null
    initialized: boolean
    isFromHistory: boolean
  }>(() => {
    if (initialResult && typeof initialResult === 'object') {
      const result = initialResult as Record<string, unknown>

      // Check for persisted state (from history reload)
      // If publishStatus exists in result, this is a reload - don't re-execute publish
      if (result.publishStatus && result.pendingPublish) {
        return {
          pendingPublish: { ...(result.pendingPublish as PendingPublish), publishId },
          postData: (result.postData as SocialPostData) || null,
          publishStatus: result.publishStatus as PublishStatus,
          publishResult: (result.publishResult as PublishResult) || null,
          initialized: true,
          isFromHistory: true
        }
      }

      // Fresh publish from tool result (no publishStatus means never synced before)
      if (result.pendingPublish) {
        return {
          pendingPublish: { ...(result.pendingPublish as PendingPublish), publishId },
          postData: (result.postData as SocialPostData) || null,
          publishStatus: PublishFlowState.ReadyToPublish,
          publishResult: null,
          initialized: true,
          isFromHistory: false
        }
      }
    }
    return { pendingPublish: null, postData: null, publishStatus: null, publishResult: null, initialized: false, isFromHistory: false }
  })

  // Emit post published event on success (once)
  useEffect(() => {
    if (localState.publishStatus === PublishFlowState.Success && localState.postData?.id && !emittedRef.current) {
      emittedRef.current = true
      emitPostPublished(localState.postData.id)
    }
  }, [localState.publishStatus, localState.postData?.id])

  const handleStatusChange = (status: PublishStatus) => {
    setLocalState(prev => ({ ...prev, publishStatus: status }))
  }

  const handleResultChange = (result: PublishResult) => {
    setLocalState(prev => ({ ...prev, publishResult: result }))
  }

  // Run publish flow with callbacks (only if fresh publish, not history reload)
  const isActiveFlow = localState.initialized &&
    localState.publishStatus === PublishFlowState.ReadyToPublish &&
    !localState.isFromHistory
  usePublishFlow(
    appId,
    publishId,
    localState.pendingPublish,
    isActiveFlow,
    { onStatusChange: handleStatusChange, onResultChange: handleResultChange }
  )

  // Sync local state to backend for history persistence
  useToolResultSync(
    {
      action: 'publish',
      appId,
      publishId,
      pendingPublish: localState.pendingPublish,
      postData: localState.postData,
      publishStatus: localState.publishStatus,
      publishResult: localState.publishResult
    },
    { conversationId, toolId, appId },
    {
      debounceMs: 300,
      enabled: localState.initialized && !!localState.publishStatus
    }
  )

  const { pendingPublish, publishStatus, publishResult } = localState

  const platformConfig = pendingPublish
    ? PLATFORM_CONFIG[pendingPublish.platform]
    : null

  // Don't render if we have no data
  if (!pendingPublish || !publishStatus) {
    return null
  }

  const renderPublishStatusHeading = () => {
    const renderStatusText = (textContent: string, emphasis?: Emphasis) => {
    return <text.p size={-1} text={textContent} emphasis={emphasis} />
  }

    switch (publishStatus) {
      case PublishFlowState.ReadyToPublish:
        return renderStatusText(t('builder_widgets_socialpublish_preparing', undefined, 'Preparing to publish...'))
      case PublishFlowState.Publishing:
        return renderStatusText(`${t('builder_widgets_socialpublish_publishing_to', undefined, 'Publishing to')} ${platformConfig?.name || pendingPublish.platform}...`)
      case PublishFlowState.Success:
        return renderStatusText(t('builder_widgets_socialpublish_success', undefined, 'Published successfully!'), 'success')
      case PublishFlowState.Error:
        return renderStatusText(t('builder_widgets_socialpublish_failed', undefined, 'Publishing failed'), 'warning')
      default:
        return null
    }
  }

  const renderPublishSuccessSubtext = () => {
    if (publishStatus === PublishFlowState.Success) {
      const platformName = platformConfig?.name || pendingPublish?.platform || 'platform'
      return<div className="mb-1">
        <text.p size={-1} text={t('builder_widgets_socialpublish_live_on', undefined, `Your post is now live on ${platformName}`)} />
      </div>
    }
    return null
  }

  const renderPublishStatusAction = () => {
    if (publishStatus === PublishFlowState.Success && publishResult && 'platformUrl' in publishResult && publishResult.platformUrl) {
      return (
        <Button
          design="primary"
          as="external"
          size="sm"
          text={t('builder_widgets_socialpublish_view_post', undefined, 'View post')}
          href={publishResult.platformUrl}
          target="_blank"
          rel="noopener noreferrer"
        />
      )
    }
    return null
  }

  const isLoading = publishStatus === PublishFlowState.ReadyToPublish ||
                    publishStatus === PublishFlowState.Publishing

  return (
    <div className="rounded-md border border-intents-ux-info-borderColor bg-intents-ux-info-backgroundColor p-2 mt-2">
      <div className="flex items-center gap-1 mb-1">
        {isLoading && <Spinner size="sm" />}
        {renderPublishStatusHeading()}
      </div>
      {renderPublishSuccessSubtext()}
      {renderPublishStatusAction()}
      {publishStatus === PublishFlowState.Error && (
        <text.p size={-2} emphasis='warning' text={publishResult?.error || t('builder_common_unknown_error', undefined, 'Unknown error')} />
      )}
    </div>
  )
}
