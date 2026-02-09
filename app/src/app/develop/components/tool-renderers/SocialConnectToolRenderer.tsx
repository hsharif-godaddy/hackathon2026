'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import LinkIcon from '@ux/icon/link'

import SocialConnectFlow from '@/app/develop/components/social/connect-flow/SocialConnectFlow'
import { SocialConnectionStatus, SocialConnectionStatusMessage } from '@/app/develop/components/social/shared/SocialConnectionStatusMessage'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useToolResultSync } from '@/hooks/useToolResultSync'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { SocialPostData } from '@/types/social-posts'
import { formatHashtags, formatPlatformName } from '@/utils/social'

type ConnectStatus = 'pending' | 'connected' | 'error'

function SocialConnectToolRenderer({
  toolStatus,
  toolId,
  conversationId,
  result,
  isLastAssistantMessage = false,
  ...rest
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const { sendMessage } = useWebSocketContext()
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
  const pendingPublish = r?.pendingPublish as { platform: string; message: string; imageUrls: string[] } | undefined

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

    if (postData && r?.platform && postData.platform.toLowerCase() === (r.platform as string).toLowerCase()) {
      const platformName = formatPlatformName(postData.platform)

      // Re-transform post data in case it was edited, or use the existing pendingPublish
      const publishData = pendingPublish || {
        platform: PLATFORM_TRANSFORMS.toDisplay(postData.platform),
        message: [postData.content, postData.callToAction, formatHashtags(postData.hashtags)].filter(Boolean).join('\n\n'),
        imageUrls: postData.images?.map(img => img.url) || [],
      }

      sendMessage(
        `Publish ${postData.styleLabel} to ${platformName}`,
        undefined,
        undefined,
        undefined,
        false,
        {
          type: 'social_publish_ready',
          data: {
            platform: postData.platform,
            connectionVerified: true,
            pendingPublish: publishData,
            postData
          },
          persistence: 'ephemeral'
        }
      )
    }
  }, [postData, pendingPublish, r, sendMessage])

  if (r?.action === 'connect' && r.platform && r.appId) {
    const platformName = formatPlatformName(r.platform as string)

    // Determine which view to show
    let content
    if (isFromHistory) {
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
      // Active connection flow
      content = (
        <SocialConnectFlow
          platform={r.platform as string}
          appId={r.appId as string}
          state={r.state as string}
          autoOpen={isLastAssistantMessage}
          isActive={Boolean(isLastAssistantMessage)}
          onSuccess={handleConnectSuccess}
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
