'use client'

import { memo } from 'react'
import LinkIcon from '@ux/icon/link'

import SocialConnectFlow from '@/app/develop/components/SocialConnectFlow'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import DefaultToolRenderer from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { useTranslations } from '@/hooks/useTranslations'

function SocialConnectToolRenderer({
  toolStatus,
  result,
  ...rest
}: DefaultToolRendererProps) {
  const t = useTranslations();
  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const r = result as any

    if (r.action === 'connect' && r.platform && r.appId) {
      return (
        <div>
          <ToolHeader
            icon={<LinkIcon className="w-2 h-2" />}
            displayName={t('builder_tools_social_connect_title')}
            hasDetails={false}
            toolStatus={toolStatus}
            onOpenModal={undefined}
          />
          <SocialConnectFlow
            platform={r.platform}
            appId={r.appId}
            state={r.state}
          />
        </div>
      )
    }
  }

  return <DefaultToolRenderer toolStatus={toolStatus} result={result} {...rest} />
}

export default memo(SocialConnectToolRenderer)
