'use client'

import { memo } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'
import { formatPlatformName } from '@/utils/social/format'

interface SocialAuthPromptProps {
  platformName: string
  onConnect: () => void
  isLoading: boolean
  onClose?: () => void
}

export const SocialAuthPrompt = memo(function SocialAuthPrompt({
  platformName,
  onConnect,
  isLoading,
  onClose
}: SocialAuthPromptProps) {
  const t = useTranslations()
  const platform = formatPlatformName(platformName)

  return (
    <Box orientation="vertical" gap="md">
      <text.span as="paragraph" text={t('builder_social_auth_popup_instruction')} />
      <text.span
        as="paragraph"
        emphasis="passive"
        text={t('builder_social_auth_popup_fallback_button', { buttonLabel: t('builder_social_connect_platform', { platformName: platform })})}
      />
      <Box gap="sm" orientation="horizontal" blockAlignChildren="end" className="mt-5">
        <Button
          design="secondary"
          onClick={onClose}
          text={t('builder_common_cancel')}
          data-eid={generateClickEID('social.connect.cancel')}
        />
        <Button
          design="primary"
          onClick={onConnect}
          disabled={isLoading}
          text={t('builder_social_connect_platform', { platformName: platform })}
          data-eid={generateClickEID('social.connect.auth_prompt')}
        />
      </Box>
    </Box>
  )
})
