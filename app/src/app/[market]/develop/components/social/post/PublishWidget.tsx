'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { usePublishFlow } from '@/hooks/social/usePublishFlow'
import { useToolResultSync } from '@/hooks/useToolResultSync'
import { useTranslations } from '@/hooks/useTranslations'
import { useUserLocale } from '@/hooks/useUserLocale'
import { logger } from '@/lib/request-context'
import { type PublishablePlatform } from '@/lib/social-platforms'
import { type PendingPublish, type PublishAction, PublishFlowState, type SocialPostData, SocialPostState } from '@/types/social-posts'
import { generateClickEID } from '@/utils/instrumentation'
import { emitPostPublished } from '@/utils/social/events'
import { formatPlatformName } from '@/utils/social/format'
import { formatScheduledDateTime } from '@/utils/social/scheduling'

interface SocialPublishWidgetProps {
  appId: string
  publishId: string
  toolId: string
  conversationId: string | null
  initialResult?: Record<string, unknown> | string
  isLastAssistantMessage?: boolean
}

type LocalState = {
  pendingPublish: PendingPublish | null
  postData: SocialPostData | null
  platformStatuses: Record<PublishablePlatform, { status: PublishFlowState; result?: any; error?: string }>
  overallStatus: PublishFlowState | null
  initialized: boolean
  isFromHistory: boolean
  publishStarted: boolean
}

function publishReducer(state: LocalState, action: PublishAction): LocalState {
  switch (action.type) {
    case 'PLATFORM_STATUS_CHANGE':
      return {
        ...state,
        platformStatuses: {
          ...state.platformStatuses,
          [action.platform]: {
            ...state.platformStatuses[action.platform],
            status: action.status
          }
        }
      }
    case 'PLATFORM_RESULT_CHANGE':
      return {
        ...state,
        platformStatuses: {
          ...state.platformStatuses,
          [action.platform]: {
            ...state.platformStatuses[action.platform],
            result: action.result
          }
        }
      }
    case 'BATCH_PLATFORM_UPDATE':
      // Batch update for status and result together to reduce race conditions
      return {
        ...state,
        platformStatuses: {
          ...state.platformStatuses,
          [action.platform]: {
            ...state.platformStatuses[action.platform],
            status: action.status,
            ...(action.result !== undefined && { result: action.result })
          }
        }
      }
    case 'OVERALL_STATUS_CHANGE':
      return { ...state, overallStatus: action.status }
    case 'PUBLISH_STARTED':
      return { ...state, publishStarted: true }
    default:
      return state
  }
}

export function PublishWidget({ appId, publishId, toolId, conversationId, initialResult, isLastAssistantMessage = false }: SocialPublishWidgetProps) {
  const t = useTranslations()
  const locale = useUserLocale()
  const emittedRef = useRef(false)
  const publishStartedRef = useRef(false)

  const result = initialResult && typeof initialResult === 'object'
    ? initialResult as Record<string, unknown>
    : null

  // Initialize local state from tool result using reducer pattern
  // Multi-platform: Track per-platform status
  const [localState, dispatch] = useReducer(publishReducer, null, () => {
    if (result) {
      // Determine if from history (check both old and new format)
      const hasBeenProcessed = (result.overallStatus && result.overallStatus !== PublishFlowState.ReadyToPublish) ||
        (result.publishStatus && result.publishStatus !== PublishFlowState.ReadyToPublish)
      const isFromHistory = !isLastAssistantMessage || hasBeenProcessed

      logger.debug('social-publish-widget.init', {
        publishId,
        hasOverallStatus: !!result.overallStatus,
        overallStatus: result.overallStatus,
        hasPublishStatus: !!result.publishStatus,
        publishStatus: result.publishStatus,
        hasPendingPublish: !!result.pendingPublish,
        isLastAssistantMessage,
        isFromHistory
      })

      // Check for persisted state (history reload) - new multi-platform format
      if (result.platformStatuses && result.pendingPublish) {
        const rawPublish = result.pendingPublish as any
        const platforms = rawPublish.platforms || (rawPublish.platform ? [rawPublish.platform] : [])
        const platformData = rawPublish.platformData?.map((pd: any) => ({
          ...pd,
          scheduledAt: pd.scheduledAt ? new Date(pd.scheduledAt) : undefined
        }))
        return {
          pendingPublish: { ...rawPublish, platforms, platformData, publishId, scheduledAt: rawPublish.scheduledAt ? new Date(rawPublish.scheduledAt) : undefined },
          postData: (result.postData as SocialPostData) || null,
          platformStatuses: result.platformStatuses as any,
          overallStatus: result.overallStatus as PublishFlowState,
          initialized: true,
          isFromHistory: true,
          publishStarted: true
        }
      }

      // Backwards compatibility: old single-platform format from history
      if (result.publishStatus && result.pendingPublish) {
        const rawPublish = result.pendingPublish as any
        const platform = rawPublish.platform || rawPublish.platforms?.[0]
        const platforms = platform ? [platform] : []
        const platformStatuses = platform ? {
          [platform]: {
            status: result.publishStatus as PublishFlowState,
            result: result.publishResult || undefined
          }
        } : {}
        const platformData = rawPublish.platformData?.map((pd: any) => ({
          ...pd,
          scheduledAt: pd.scheduledAt ? new Date(pd.scheduledAt) : undefined
        }))

        return {
          pendingPublish: { ...rawPublish, platforms, platformData, publishId, scheduledAt: rawPublish.scheduledAt ? new Date(rawPublish.scheduledAt) : undefined },
          postData: (result.postData as SocialPostData) || null,
          platformStatuses: platformStatuses as any,
          overallStatus: result.publishStatus as PublishFlowState,
          initialized: true,
          isFromHistory: true,
          publishStarted: true
        }
      }

      // Fresh publish only - if from history with no saved status, don't render
      if (result.pendingPublish && !isFromHistory) {
        const rawPublish = result.pendingPublish as any
        const platforms = rawPublish.platforms || (rawPublish.platform ? [rawPublish.platform] : [])

        // Ensure platformData exists (backwards compatibility). Rehydrate each
        // entry's scheduledAt — it arrives as an ISO string after JSON serialization
        // over the WebSocket, but the publish flow (publishToFacebook) requires a Date.
        const platformData = rawPublish.platformData
          ? rawPublish.platformData.map((pd: any) => ({
              ...pd,
              scheduledAt: pd.scheduledAt ? new Date(pd.scheduledAt) : undefined
            }))
          : platforms.map((platform: PublishablePlatform) => ({
              platform,
              message: rawPublish.message || '',
              imageUrls: rawPublish.imageUrls || [],
              scheduledAt: rawPublish.scheduledAt ? new Date(rawPublish.scheduledAt) : undefined
            }))

        const pending: PendingPublish = {
          ...rawPublish,
          platforms,
          platformData,
          publishId,
          scheduledAt: rawPublish.scheduledAt ? new Date(rawPublish.scheduledAt) : undefined
        }
        const initialStatuses = platforms.reduce((acc: Record<PublishablePlatform, { status: PublishFlowState }>, platform: PublishablePlatform) => {
          acc[platform] = { status: PublishFlowState.ReadyToPublish }
          return acc
        }, {} as Record<PublishablePlatform, { status: PublishFlowState }>)

        return {
          pendingPublish: pending,
          postData: (result.postData as SocialPostData) || null,
          platformStatuses: initialStatuses,
          overallStatus: PublishFlowState.ReadyToPublish,
          initialized: true,
          isFromHistory: false,
          publishStarted: false
        }
      }
    }

    return {
      pendingPublish: null,
      postData: null,
      platformStatuses: {} as Record<PublishablePlatform, { status: PublishFlowState }>,
      overallStatus: null,
      initialized: false,
      isFromHistory: false,
      publishStarted: false
    }
  })

  // Emit post published event on success
  useEffect(() => {
    if (localState.overallStatus === PublishFlowState.Success && !emittedRef.current) {
      emittedRef.current = true
      if (localState.postData?.id) {
        const state = localState.pendingPublish?.scheduledAt ? SocialPostState.SCHEDULED : SocialPostState.PUBLISHED
        emitPostPublished(localState.postData.id, state)
      }
    }
  }, [localState.overallStatus, localState.postData?.id, localState.pendingPublish?.scheduledAt])

  const handlePlatformStatusChange = useCallback((platform: PublishablePlatform, status: PublishFlowState) => {
    if (status === PublishFlowState.Publishing && !publishStartedRef.current) {
      publishStartedRef.current = true
      dispatch({ type: 'PUBLISH_STARTED' })
    }
    dispatch({ type: 'PLATFORM_STATUS_CHANGE', platform, status })
  }, [])

  const handlePlatformResultChange = useCallback((platform: PublishablePlatform, result: any) => {
    dispatch({ type: 'PLATFORM_RESULT_CHANGE', platform, result })
  }, [])

  const handleOverallStatusChange = useCallback((status: PublishFlowState) => {
    dispatch({ type: 'OVERALL_STATUS_CHANGE', status })
  }, [])

  // Run publish flow (only if fresh, not history, and not already started)
  // For multi-platform: isActiveFlow means we should execute the publish flow
  const isActiveFlow = localState.initialized &&
    localState.overallStatus === PublishFlowState.ReadyToPublish &&
    !localState.isFromHistory &&
    !localState.publishStarted

  usePublishFlow(
    appId,
    publishId,
    localState.pendingPublish,
    isActiveFlow,
    {
      onPlatformStatusChange: handlePlatformStatusChange,
      onPlatformResultChange: handlePlatformResultChange,
      onOverallStatusChange: handleOverallStatusChange
    }
  )

  // Sync to conversation history once when reaching terminal state (not from history)
  const syncResult = useToolResultSync({ conversationId, toolId, appId })
  const hasSyncedRef = useRef(false)

  useEffect(() => {
    // Terminal states are Success or Error - these are final and should be synced
    const isTerminalState = localState.overallStatus === PublishFlowState.Success ||
      localState.overallStatus === PublishFlowState.Error

    // Only sync if it was NEVER from history (use initial state, not current reactive value)
    if (isTerminalState && !localState.isFromHistory && !hasSyncedRef.current) {
      hasSyncedRef.current = true
      syncResult({
        action: 'publish',
        appId,
        publishId,
        pendingPublish: localState.pendingPublish,
        postData: localState.postData,
        platformStatuses: localState.platformStatuses,
        overallStatus: localState.overallStatus
      })
    }
  }, [localState.overallStatus, localState.isFromHistory, syncResult, appId, publishId, localState.pendingPublish, localState.postData, localState.platformStatuses])

  const { pendingPublish, platformStatuses, overallStatus } = localState

  if (!pendingPublish || !overallStatus) {
    return null
  }

  const platforms = pendingPublish.platforms
  const isMultiPlatform = platforms.length > 1
  const platformNames = platforms.map(p => formatPlatformName(p)).join(' & ')
  const isScheduled = !!pendingPublish.scheduledAt
  const scheduledDateTime = pendingPublish.scheduledAt
    ? formatScheduledDateTime(pendingPublish.scheduledAt, locale)
    : ''

  const isLoading = overallStatus === PublishFlowState.ReadyToPublish ||
                    overallStatus === PublishFlowState.Publishing

  const getErrorMessage = () => {
    for (const platform of platforms) {
      const result = platformStatuses[platform]?.result
      if (result?.error) return result.error
    }
    return t('builder_common_unknown_error')
  }

  const getSuccessfulPlatformUrls = () => {
    return platforms
      .map(platform => ({
        platform,
        url: platformStatuses[platform]?.result?.platformUrl,
        status: platformStatuses[platform]?.status
      }))
      .filter(item => item.url)
  }

  const renderStatusHeading = () => {
    switch (overallStatus) {
      case PublishFlowState.ReadyToPublish:
        return <text.p size={-1}>{t('builder_widgets_socialpublish_preparing')}</text.p>
      case PublishFlowState.Publishing:
        return <text.p size={-1}>{t('builder_widgets_socialpublish_publishing_to', { platformName: platformNames })}</text.p>
      case PublishFlowState.Success:
        return <text.p size={-1} emphasis="success">{isScheduled ? t('builder_widgets_socialschedule_success') : t('builder_widgets_socialpublish_success')}</text.p>
      case PublishFlowState.Error:
        return <text.p size={-1} emphasis="warning">{t('builder_widgets_socialpublish_failed')}</text.p>
      default:
        return null
    }
  }

  const successUrls = getSuccessfulPlatformUrls()

  return (
    <div className="rounded-md border border-intents-ux-info-borderColor bg-intents-ux-info-backgroundColor p-2 mt-2">
      <div className="flex items-center gap-1 mb-1">
        {isLoading && <Spinner size="sm" />}
        {renderStatusHeading()}
      </div>

      {overallStatus === PublishFlowState.Success && (
        <div className="mb-1">
          <text.p size={-1}>
            {isScheduled
              ? t('builder_widgets_socialschedule_will_post_on', { platformName: platformNames, dateTime: scheduledDateTime })
              : t('builder_widgets_socialpublish_live_on', { platformName: platformNames })
            }
          </text.p>
        </div>
      )}

      {overallStatus === PublishFlowState.Success && !isScheduled && successUrls.length > 0 && (
        <div className="flex flex-col gap-2">
          {successUrls.map(({ platform, url }) => (
            <Button
              key={platform}
              design="primary"
              as="external"
              size="sm"
              text={isMultiPlatform
                ? t('builder_widgets_socialpublish_view_on', { platform: formatPlatformName(platform) })
                : t('builder_widgets_socialpublish_view_post')
              }
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              data-eid={generateClickEID(`social.publish.view_post_${platform}`)}
            />
          ))}
        </div>
      )}

      {overallStatus === PublishFlowState.Error && (
        <text.p size={-2} emphasis="warning">{getErrorMessage()}</text.p>
      )}
    </div>
  )
}
