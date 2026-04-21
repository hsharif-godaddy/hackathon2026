'use client'

import { memo } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'
import TextLockup from '@ux/text-lockup'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'
import { SocialSectionHeader } from '../shared/SocialSectionHeader'

interface SocialConnectionWarningProps {
  platformName: string
  Icon: React.ComponentType<{ className?: string }> | null
  connectionName?: string
  onChangeConnection: () => void
  onClose?: () => void
}

export const SocialConnectionWarning = memo(function SocialConnectionWarning({
  platformName,
  Icon,
  connectionName,
  onChangeConnection,
  onClose,
}: SocialConnectionWarningProps) {
  const t = useTranslations()

  return (
    <div>
      <SocialSectionHeader Icon={Icon} title={t('builder_social_platform_already_connected', { platformName })} />

      <Box elevation="card" blockPadding="md" inlinePadding="md">
        <TextLockup
          emphasis="warning"
          size="sm"
          title={connectionName
            ? t('builder_social_site_connected_to_connection', { connectionName })
            : t('builder_social_site_has_platform_connection', { platformName })}
        >
          <text.p text={t('builder_social_can_change_connection')} />
        </TextLockup>
      </Box>

      <Box gap="sm" orientation="horizontal" blockAlignChildren="end" className="mt-5">
        <Button
          design="secondary"
          onClick={onClose}
          text={t('builder_common_cancel')}
          data-eid={generateClickEID('social.connect.cancel')}
        />
        <Button
          design="primary"
          onClick={onChangeConnection}
          text={t('builder_social_change_connection')}
          data-eid={generateClickEID('social.connect.change_connection')}
        />
      </Box>
    </div>
  )
})
