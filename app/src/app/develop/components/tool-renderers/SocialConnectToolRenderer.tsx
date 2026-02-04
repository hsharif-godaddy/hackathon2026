'use client'

import { memo, useCallback } from 'react'
import LinkIcon from '@ux/icon/link'

import SocialConnectFlow from '@/app/develop/components/social/connect-flow/SocialConnectFlow'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useTranslations } from '@/hooks/useTranslations'
import type { SocialPostData } from '@/types/social-posts'
import { formatHashtags, formatPlatformName } from '@/utils/social'

function SocialConnectToolRenderer({
  toolStatus,
  result,
  isLastAssistantMessage = false,
  ...rest
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const { sendMessage } = useWebSocketContext()

  const r = (toolStatus === 'completed' && result && typeof result === 'object')
    ? result as Record<string, unknown>
    : null

  // Get pending post data from tool result (if user tried to publish without connection)
  const postData = r?.postData as SocialPostData | undefined
  const pendingPublish = r?.pendingPublish as { platform: string; message: string; imageUrls: string[] } | undefined

  const handleConnectSuccess = useCallback(() => {
    if (postData && r?.platform && postData.platform.toLowerCase() === (r.platform as string).toLowerCase()) {
      const platformName = formatPlatformName(postData.platform)

      // Re-transform post data in case it was edited, or use the existing pendingPublish
      const publishData = pendingPublish || {
        platform: postData.platform,
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
  }, [postData, pendingPublish, r?.platform, sendMessage])

  if (r?.action === 'connect' && r.platform && r.appId) {
    return (
      <>
        <ToolHeader
          icon={<LinkIcon className="w-2 h-2" />}
          displayName={t('builder_tools_social_connect_title')}
          hasDetails={false}
          toolStatus={toolStatus}
          onOpenModal={undefined}
        />
        <SocialConnectFlow
          platform={r.platform as string}
          appId={r.appId as string}
          state={r.state as string}
          autoOpen={isLastAssistantMessage}
          onSuccess={handleConnectSuccess}
        />
      </>
    )
  }

  return <DefaultToolRenderer toolStatus={toolStatus} result={result} {...rest} />
}

export default memo(SocialConnectToolRenderer)
