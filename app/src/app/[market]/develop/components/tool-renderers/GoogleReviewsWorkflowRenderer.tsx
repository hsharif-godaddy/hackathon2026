'use client'

import { memo, useCallback, useMemo, useState } from 'react'
import StarIcon from '@ux/icon/star'

import SocialConnectFlow from '@/app/[market]/develop/components/social/connect-flow/SocialConnectFlow'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { useChatContext } from '@/contexts/ChatContext'
import { logger } from '@/lib/request-context'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

function GoogleReviewsWorkflowRenderer({
  toolStatus,
  toolId,
  conversationId,
  result,
  isLastAssistantMessage = false,
  ...rest
}: DefaultToolRendererProps) {
  const { sendMessage } = useChatContext()
  const currentAppId = useStreamingConversationStore(state => state.currentAppId)
  const [oauthComplete, setOauthComplete] = useState(false)

  const r = (toolStatus === 'completed' && result && typeof result === 'object')
    ? result as Record<string, unknown>
    : null

  const phase = r?.phase as string | undefined
  const oauthState = useMemo(() => crypto.randomUUID(), [])

  const handleOauthSuccess = useCallback(() => {
    logger.info('google-reviews-workflow.oauth-success', { appId: currentAppId })
    setOauthComplete(true)
    sendMessage({
      content: 'I\'ve connected my Google Business Profile. Please continue.',
      isActionRequest: false,
    })
  }, [currentAppId, sendMessage])

  const handleOauthClose = useCallback(() => {
    logger.info('google-reviews-workflow.oauth-close', { appId: currentAppId })
  }, [currentAppId])

  if (phase === 'awaiting-oauth' && currentAppId) {
    return (
      <>
        <ToolHeader
          icon={<StarIcon className="w-2 h-2" />}
          displayName="Connect Google Business Profile"
          hasDetails={false}
          toolStatus={toolStatus}
          onOpenModal={undefined}
        />
        {oauthComplete ? (
          <p className="text-sm text-ux-text-secondary px-3 py-2">Connected. Fetching reviews…</p>
        ) : (
          <SocialConnectFlow
            platform="GOOGLE_BUSINESS_PROFILE"
            appId={currentAppId}
            state={oauthState}
            isActive={isLastAssistantMessage}
            autoOpen={isLastAssistantMessage}
            onSuccess={handleOauthSuccess}
            onClose={handleOauthClose}
          />
        )}
      </>
    )
  }

  if (phase === 'complete') {
    const reviewCount = (r?.reviews as unknown[])?.length ?? 0
    return (
      <ToolHeader
        icon={<StarIcon className="w-2 h-2" />}
        displayName={reviewCount > 0 ? `Loaded ${reviewCount} Google reviews` : 'No Google reviews found'}
        hasDetails={false}
        toolStatus={toolStatus}
        onOpenModal={undefined}
      />
    )
  }

  return <DefaultToolRenderer toolStatus={toolStatus} toolId={toolId} conversationId={conversationId} result={result} {...rest} />
}

export default memo(GoogleReviewsWorkflowRenderer)
