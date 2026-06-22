'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import LinkIcon from '@ux/icon/link'

import SocialConnectFlow from '@/app/[market]/develop/components/social/connect-flow/SocialConnectFlow'
import { SocialConnectionStatus, SocialConnectionStatusMessage } from '@/app/[market]/develop/components/social/shared/SocialConnectionStatusMessage'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { useChatContext } from '@/contexts/ChatContext'
import { useToolResultSync } from '@/hooks/useToolResultSync'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { CONNECT_REQUEST_FROM_PUBLISH, isMultiPlatformPublish, type MultiPlatformPendingPublish, type PendingPublishData } from '@/types/social'
import type { SocialPostData } from '@/types/social-posts'
import { formatPlatformName } from '@/utils/social/format'

type ConnectStatus = 'pending' | 'connected' | 'error'

const noop = () => {}

function SocialConnectToolRenderer({
  toolStatus,
  toolId,
  conversationId,
  result,
  isLastAssistantMessage = false,
  ...rest
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const { sendMessage } = useChatContext()
  const currentAppId = useStreamingConversationStore(state => state.currentAppId)

  const r = (toolStatus === 'completed' && result && typeof result === 'object')
    ? result as Record<string, unknown>
    : null

  const isFromHistory = !isLastAssistantMessage

  // Initialize state from result (for history reload)
  const [connectStatus, setConnectStatus] = useState<ConnectStatus>(() => {
    if (r?.connectStatus) {
      logger.debug('social-connect-tool.from-history', {
        toolId,
        connectStatus: r.connectStatus
      })
      return r.connectStatus as ConnectStatus
    }
    return 'pending'
  })

  // Get pending post data from tool result (if user tried to publish without connection)
  const postData = r?.postData as SocialPostData | undefined
  const pendingPublish = r?.pendingPublish as PendingPublishData | undefined

  // Sync to conversation history once when reaching terminal state (not from history)
  const syncResult = useToolResultSync({
    conversationId: conversationId || null,
    toolId: toolId || '',
    appId: currentAppId || ''
  })
  const hasSyncedRef = useRef(false)

  useEffect(() => {
    const isTerminalState = connectStatus === 'connected' || connectStatus === 'error'

    if (isTerminalState && !isFromHistory && r && !hasSyncedRef.current) {
      hasSyncedRef.current = true
      syncResult({ ...r, connectStatus })
    }
  }, [connectStatus, isFromHistory, r, syncResult])

  const handleConnectSuccess = useCallback(() => {
    setConnectStatus('connected')

    // Auto-publish after successful connection if there's pending publish data
    if (pendingPublish && r?.platform) {
      const platform = r.platform as string
      const requestedPlatforms = (r.platforms as string[]) || [platform]  // Platforms that need connecting

      // Normalize pendingPublish to handle both old and new formats
      // Old format: { platform, message, imageUrls }
      // New format: { platforms: [...], platformData: [...] }
      const normalizedPendingPublish: MultiPlatformPendingPublish = isMultiPlatformPublish(pendingPublish)
        ? pendingPublish  // Already in new format
        : {  // Convert legacy format to new format
            platforms: [PLATFORM_TRANSFORMS.toDisplay(platform)],
            platformData: [{
              platform: PLATFORM_TRANSFORMS.toDisplay(platform),
              message: pendingPublish.message || '',
              imageUrls: pendingPublish.imageUrls || [],
              scheduledAt: pendingPublish.scheduledAt
            }],
            message: pendingPublish.message,
            imageUrls: pendingPublish.imageUrls,
            scheduledAt: pendingPublish.scheduledAt
          }

      // For sequential flow: Check if there are more platforms to connect
      if (requestedPlatforms.length > 1) {
        // Find platforms that still need connecting (exclude the one we just connected)
        const stillNeedConnecting = requestedPlatforms.filter((plt: string) =>
          plt.toLowerCase() !== platform.toLowerCase()
        )

        if (stillNeedConnecting.length > 0) {
          // More platforms to connect - send next connect message
          const nextPlatform = stillNeedConnecting[0]
          const nextPlatformName = formatPlatformName(nextPlatform)

          logger.info('social-connect.sequential-next', {
            justConnected: platform,
            nextPlatform,
            remaining: stillNeedConnecting
          })

          sendMessage({
            content: `Connect to ${nextPlatformName}`,
            isActionRequest: false,
            customContext: {
              type: CONNECT_REQUEST_FROM_PUBLISH,
              data: {
                platforms: stillNeedConnecting,  // Pass only remaining platforms
                pendingPublish: normalizedPendingPublish,
                postData
              }
            }
          })
          return
        }
      }

      // All platforms connected - auto-publish!
      const platforms = normalizedPendingPublish.platforms

      // Defensive guard: if no platforms are present, skip auto-publish to avoid errors
      if (!platforms || platforms.length === 0) {
        logger.warn('social-connect.auto-publish-skipped', {
          reason: 'no-platforms',
          pendingPublish: normalizedPendingPublish
        })
        return
      }

      const platformNames = platforms.length === 1
        ? formatPlatformName(platforms[0])
        : platforms.slice(0, -1).map(formatPlatformName).join(', ') + ' and ' + formatPlatformName(platforms[platforms.length - 1])

      logger.info('social-connect.auto-publish', {
        platforms,
        platformNames
      })

      // Brief delay to let user see the success state before auto-publishing
      setTimeout(() => {
        sendMessage({
          content: `Publish ${postData?.styleLabel || 'post'} to ${platformNames}`,
          isActionRequest: false,
          customContext: {
            type: 'social_publish_ready',
            data: {
              platforms: normalizedPendingPublish.platforms,
              connectionVerified: true,
              pendingPublish: normalizedPendingPublish,
              postData
            }
          }
        })
      }, 1500) // 1.5 second delay
    }
  }, [postData, pendingPublish, r, sendMessage])

  if (r?.action === 'connect' && r.platform && r.appId) {
    const platformName = formatPlatformName(r.platform as string)

    // Determine which view to show
    let content
    if (isFromHistory || connectStatus !== 'pending') {
      content = (
        <SocialConnectionStatusMessage
          status={
            connectStatus === 'connected'
              ? SocialConnectionStatus.Success
              : connectStatus === 'error'
                ? SocialConnectionStatus.Error
                : SocialConnectionStatus.Incomplete
          }
          platformName={platformName}
          errorMessage={connectStatus === 'error' ? (r.errorMessage as string) : undefined}
        />
      )
    } else {
      // Active connection flow — shows existing connections first,
      // then opens platform-specific connect flow for new connections
      content = (
        <SocialConnectFlow
          platform={r.platform as string}
          appId={r.appId as string}
          state={r.state as string}
          autoOpen={isLastAssistantMessage}
          isActive={Boolean(isLastAssistantMessage)}
          onSuccess={handleConnectSuccess}
          onClose={noop}
        />
      )
    }

    return (
      <>
        <ToolHeader
          icon={<LinkIcon className="w-2 h-2" />}
          displayName={t('builder_tools_social_connect_title')}
          hasDetails={false}
          toolStatus={toolStatus}
          onOpenModal={undefined}
        />
        {content}
      </>
    )
  }

  return <DefaultToolRenderer toolStatus={toolStatus} toolId={toolId} conversationId={conversationId} result={result} {...rest} />
}

export default memo(SocialConnectToolRenderer)
