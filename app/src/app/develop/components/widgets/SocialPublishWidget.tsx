'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import { type Emphasis, text } from '@ux/text'

import { usePublishFlow } from '@/hooks/social/usePublishFlow'
import { useToolResultSync } from '@/hooks/useToolResultSync'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { PLATFORM_CONFIG } from '@/lib/social-platforms'
import { type PendingPublish, PublishFlowState, type PublishResult, type PublishStatus, type SocialPostData, SocialPostState } from '@/types/social-posts'
import { generateClickEID } from '@/utils/instrumentation'
import { emitPostPublished } from '@/utils/social/events'
import { formatPlatformName } from '@/utils/social/format'
import { SocialPublishStatus, SocialPublishStatusMessage } from './SocialPublishStatusMessage'

interface SocialPublishWidgetProps {
  appId: string
  publishId: string
  toolId: string
  conversationId: string | null
  initialResult?: Record<string, unknown> | string
  isLastAssistantMessage?: boolean
}

export function SocialPublishWidget({ appId, publishId, toolId, conversationId, initialResult, isLastAssistantMessage = false }: SocialPublishWidgetProps) {
  const t = useTranslations()
  const emittedRef = useRef(false)
  const publishStartedRef = useRef(false)

  const result = initialResult && typeof initialResult === 'object'
    ? initialResult as Record<string, unknown>
    : null

  // From history if not the last assistant message OR has been processed (any status except ReadyToPublish)
  // This prevents duplicate publishing on page refresh when result is already synced
  const hasBeenProcessed = result?.publishStatus &&
    result.publishStatus !== PublishFlowState.ReadyToPublish
  const isFromHistory = !isLastAssistantMessage || hasBeenProcessed

  // Capture initial history state to prevent race conditions with sync
  const initialIsFromHistoryRef = useRef(isFromHistory)

  // Initialize local state from tool result
  const [localState, setLocalState] = useState<{
    pendingPublish: PendingPublish | null
    postData: SocialPostData | null
    publishStatus: PublishStatus | null
    publishResult: PublishResult | null
  }>(() => {
    if (result) {
      logger.debug('social-publish-widget.init', {
        publishId,
        hasPublishStatus: !!result.publishStatus,
        publishStatus: result.publishStatus,
        hasPendingPublish: !!result.pendingPublish,
        isLastAssistantMessage,
        isFromHistory
      })

      if (isFromHistory && result.pendingPublish) {
        logger.info('social-publish-widget.from-history', {
          publishId,
          publishStatus: result.publishStatus
        })
        const rawPublish = result.pendingPublish as any
        const pendingPublish: PendingPublish = {
          ...rawPublish,
          publishId,
          scheduledAt: rawPublish.scheduledAt ? new Date(rawPublish.scheduledAt) : undefined
        }
        return {
          pendingPublish,
          postData: (result.postData as SocialPostData) || null,
          publishStatus: (result.publishStatus as PublishStatus) || PublishFlowState.Error,
          publishResult: (result.publishResult as PublishResult) || null
        }
      }

      // Fresh publish from tool result
      if (result.pendingPublish) {
        // If publishStatus exists in result, use it (page refresh with synced result)
        // Otherwise, initialize as ReadyToPublish (fresh publish from agent)
        const statusFromResult = result.publishStatus as PublishStatus
        const isAlreadySynced = !!statusFromResult

        logger.info('social-publish-widget.fresh-publish', {
          publishId,
          isAlreadySynced,
          statusFromResult
        })

        const rawPublish = result.pendingPublish as any
        const pendingPublish: PendingPublish = {
          ...rawPublish,
          publishId,
          scheduledAt: rawPublish.scheduledAt ? new Date(rawPublish.scheduledAt) : undefined
        }

        return {
          pendingPublish,
          postData: (result.postData as SocialPostData) || null,
          publishStatus: statusFromResult || PublishFlowState.ReadyToPublish,
          publishResult: (result.publishResult as PublishResult) || null
        }
      }
    }
    return { pendingPublish: null, postData: null, publishStatus: null, publishResult: null }
  })

  // Emit post published event on success (once)
  useEffect(() => {
    if (localState.publishStatus === PublishFlowState.Success && localState.postData?.id && !emittedRef.current) {
      emittedRef.current = true
      const state = localState.pendingPublish?.scheduledAt ? SocialPostState.SCHEDULED : SocialPostState.PUBLISHED
      emitPostPublished(localState.postData.id, state)
    }
  }, [localState.publishStatus, localState.postData?.id, localState.pendingPublish?.scheduledAt])

  const handleStatusChange = (status: PublishStatus) => {
    // Track when publish actually starts (transitions to Publishing state)
    if (status === PublishFlowState.Publishing && !publishStartedRef.current) {
      publishStartedRef.current = true
    }
    setLocalState(prev => ({ ...prev, publishStatus: status }))
  }

  const handleResultChange = (result: PublishResult) => {
    setLocalState(prev => ({ ...prev, publishResult: result }))
  }

  // Only run publish flow if this is the last message AND status is ReadyToPublish AND we haven't started yet
  // This prevents duplicate posts to social platforms when viewing conversation history or on re-renders
  const shouldPublish = isLastAssistantMessage &&
    localState.publishStatus === PublishFlowState.ReadyToPublish &&
    !publishStartedRef.current

  usePublishFlow(
    appId,
    publishId,
    localState.pendingPublish,
    shouldPublish,
    { onStatusChange: handleStatusChange, onResultChange: handleResultChange }
  )

  // Sync to conversation history once when reaching terminal state (not from history)
  const syncResult = useToolResultSync({ conversationId, toolId, appId })
  const hasSyncedRef = useRef(false)

  useEffect(() => {
    // Terminal states are Success or Error - these are final and should be synced
    const isTerminalState = localState.publishStatus === PublishFlowState.Success ||
      localState.publishStatus === PublishFlowState.Error

    // Only sync if it was NEVER from history (use initial state, not current reactive value)
    if (isTerminalState && !initialIsFromHistoryRef.current && !hasSyncedRef.current) {
      hasSyncedRef.current = true
      syncResult({
        action: 'publish',
        appId,
        publishId,
        pendingPublish: localState.pendingPublish,
        postData: localState.postData,
        publishStatus: localState.publishStatus,
        publishResult: localState.publishResult
      })
    }
  }, [localState.publishStatus, syncResult, appId, publishId, localState.pendingPublish, localState.postData, localState.publishResult])

  const { pendingPublish, publishStatus, publishResult } = localState

  const platformConfig = pendingPublish
    ? PLATFORM_CONFIG[pendingPublish.platform]
    : null

  // Don't render if we have no data
  if (!pendingPublish || !publishStatus) {
    return null
  }

  // HISTORY: Show read-only status message
  if (isFromHistory) {
    const platformName = formatPlatformName(platformConfig?.name || pendingPublish.platform)
    const platformUrl = publishResult && 'platformUrl' in publishResult ? publishResult.platformUrl : undefined

    // Map publish status to display status
    // Success -> Success, Error -> Error, transient states (ReadyToPublish, Publishing) -> Incomplete
    const displayStatus = publishStatus === PublishFlowState.Success
      ? SocialPublishStatus.Success
      : publishStatus === PublishFlowState.Error
        ? SocialPublishStatus.Error
        : SocialPublishStatus.Incomplete

    return (
      <SocialPublishStatusMessage
        status={displayStatus}
        platformName={platformName}
        platformUrl={platformUrl}
        errorMessage={publishResult && 'error' in publishResult ? publishResult.error : undefined}
        scheduledAt={localState.pendingPublish?.scheduledAt}
      />
    )
  }

  const renderPublishStatusHeading = () => {
    const renderStatusText = (textContent: string, emphasis?: Emphasis) => {
      return <text.p size={-1} text={textContent} emphasis={emphasis} />
    }

    switch (publishStatus) {
      case PublishFlowState.ReadyToPublish:
        return renderStatusText(t('builder_widgets_socialpublish_preparing'))
      case PublishFlowState.Publishing:
        return renderStatusText(t('builder_widgets_socialpublish_publishing_to', { platformName: formatPlatformName(pendingPublish.platform) }))
      case PublishFlowState.Success:
        return renderStatusText(t('builder_widgets_socialpublish_success'), 'success')
      case PublishFlowState.Error:
        return renderStatusText(t('builder_widgets_socialpublish_failed'), 'warning')
      default:
        return null
    }
  }

  const renderPublishSuccessSubtext = () => {
    if (publishStatus === PublishFlowState.Success) {
      const platformName = formatPlatformName(platformConfig?.name || (pendingPublish?.platform))
      return <div className="mb-1">
        <text.p size={-1} text={t('builder_widgets_socialpublish_live_on', { platformName })} />
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
          text={t('builder_widgets_socialpublish_view_post')}
          href={publishResult.platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-eid={generateClickEID('social.publish.view_post')}
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
        <text.p size={-2} emphasis='warning' text={publishResult?.error || t('builder_common_unknown_error')} />
      )}
    </div>
  )
}
