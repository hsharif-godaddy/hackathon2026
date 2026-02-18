'use client'

import { memo } from 'react'
import SendIcon from '@ux/icon/send'

import { PublishWidget } from '@/app/develop/components/social/post/PublishWidget'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { useTranslations } from '@/hooks/useTranslations'

function SocialPublishToolRenderer({
  toolStatus,
  toolId,
  conversationId,
  result,
  isLastAssistantMessage = false,
  ...rest
}: DefaultToolRendererProps) {
  const t = useTranslations()

  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const r = result as Record<string, unknown>

    if (r.action === 'publish' && r.appId && r.publishId && toolId) {
      return (
        <div>
          <ToolHeader
            icon={<SendIcon className="w-2 h-2" />}
            displayName={t('builder_tools_socialpublish_title')}
            hasDetails={false}
            toolStatus={toolStatus}
            onOpenModal={undefined}
          />
          <PublishWidget
            appId={r.appId as string}
            publishId={r.publishId as string}
            toolId={toolId}
            conversationId={conversationId ?? null}
            initialResult={result}
            isLastAssistantMessage={isLastAssistantMessage}
          />
        </div>
      )
    }
  }

  return <DefaultToolRenderer toolStatus={toolStatus} toolId={toolId} conversationId={conversationId} result={result} {...rest} />
}

export default memo(SocialPublishToolRenderer)
