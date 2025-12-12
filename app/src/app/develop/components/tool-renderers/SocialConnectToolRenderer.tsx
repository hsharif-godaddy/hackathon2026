'use client'

import { memo } from 'react'
import LinkIcon from '@ux/icon/link'
import ToolHeader from './ToolHeader'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import DefaultToolRenderer from './DefaultToolRenderer'
import SocialConnectFlow from '../SocialConnectFlow'

function SocialConnectToolRenderer({
  toolStatus,
  result,
  ...rest
}: DefaultToolRendererProps) {
  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const r = result as any

    if (r.action === 'connect' && r.platform && r.appId) {
      return (
        <div>
          <ToolHeader
            icon={<LinkIcon className="w-2 h-2" />}
            displayName="Social Connect"
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
