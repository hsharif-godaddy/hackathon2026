'use client'

import { memo } from 'react'
import Button from '@ux/button'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'
import { SocialSectionHeader } from '../shared/SocialSectionHeader'

interface SocialConnectionWarningProps {
  platformName: string
  Icon: React.ComponentType<{ className?: string }> | null
  connectionName?: string
  onChangeConnection: () => void
}

export const SocialConnectionWarning = memo(function SocialConnectionWarning({
  platformName,
  Icon,
  connectionName,
  onChangeConnection,
}: SocialConnectionWarningProps) {
  const t = useTranslations()

  return (
    <div className="space-y-1.5">
      <SocialSectionHeader Icon={Icon} title={t('builder_social_platform_already_connected', { platformName })} />

      <div className="rounded-md bg-intents-ux-warning-backgroundColor border border-intents-ux-warning-borderColor p-1.5">
        <text.p
          size={-2}
          className="text-intents-ux-warning-textColor"
          text={
            connectionName
              ? t('builder_social_site_connected_to_connection', { connectionName })
              : t('builder_social_site_has_platform_connection', { platformName })
          }
        />
      </div>

      <text.p size={-2} className="text-muted-foreground" text={t('builder_social_can_change_connection')} />

      <div className="flex gap-1 pt-1">
        <Button
          design="primary"
          size="sm"
          onClick={onChangeConnection}
          text={t('builder_social_change_connection')}
          data-eid={generateClickEID('social.connect.change_connection')}
        />
      </div>
    </div>
  )
})
