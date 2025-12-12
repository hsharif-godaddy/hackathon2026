'use client'

import { memo } from 'react'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import SocialStatusWidget from '../widgets/SocialStatusWidget'
import ShieldCheckIcon from '@ux/icon/shield-check'
import ToolHeader from './ToolHeader'

function SocialStatusToolRenderer({
  toolStatus,
  result
}: DefaultToolRendererProps) {
  const r = result && typeof result === 'object' ? (result as any) : {}

  if (toolStatus === 'completed' && r.action === 'status') {
    return (
      <div>
        <ToolHeader
          icon={<ShieldCheckIcon className="w-2 h-2" />}
          displayName="Social Media Status"
          toolStatus={toolStatus}
          hasDetails={false}
          onOpenModal={undefined}
        />
        <SocialStatusWidget />
      </div>
    )
  }

  return (
    <div>
      <ToolHeader
        icon={<ShieldCheckIcon className="w-2 h-2" />}
        displayName="Social Media Status"
        toolStatus={toolStatus}
        hasDetails={false}
        onOpenModal={undefined}
      />
    </div>
  )
}

export default memo(SocialStatusToolRenderer, (prevProps, nextProps) => {
  return prevProps.toolStatus === nextProps.toolStatus &&
    prevProps.result === nextProps.result
})
