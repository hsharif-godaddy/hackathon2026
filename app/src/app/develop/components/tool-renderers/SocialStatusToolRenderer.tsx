'use client'

import { memo } from 'react'
import ShieldCheckIcon from '@ux/icon/shield-check'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import SocialStatusWidget from '@/app/develop/components/widgets/SocialStatusWidget'
import { useTranslations } from '@/hooks/useTranslations'

function SocialStatusToolRenderer({
  toolStatus,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const r = result && typeof result === 'object' ? (result as any) : {}

  return (
    <div>
      <ToolHeader
        icon={<ShieldCheckIcon className="w-2 h-2" />}
        displayName={t('builder_tools_socail_status_title')}
        toolStatus={toolStatus}
        hasDetails={false}
        onOpenModal={undefined}
      />
      {(toolStatus === 'completed' && r.action === 'status') && (
        <SocialStatusWidget />
      )}
    </div>
  )
}

export default memo(SocialStatusToolRenderer, (prevProps, nextProps) => {
  return prevProps.toolStatus === nextProps.toolStatus &&
    prevProps.result === nextProps.result
})
