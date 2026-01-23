'use client'

import { memo } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

interface SocialAuthPromptProps {
  platformName: string
  onConnect: () => void
}

export const SocialAuthPrompt = memo(function SocialAuthPrompt({
  platformName,
  onConnect
}: SocialAuthPromptProps) {
  const t = useTranslations()
  const platform = platformName.charAt(0).toUpperCase() + platformName.slice(1)

  return (
    <Box orientation="vertical" gap="md">
      <text.span as="paragraph" emphasis="info" size={-2} text={t('builder_social_auth_popup_instruction')} />
      <text.span as="paragraph" emphasis="passive" size={-2} text={t('builder_social_auth_popup_fallback')} />
      <Button design="primary" size="sm" onClick={onConnect} text={t('builder_social_connect_platform', { platformName: platform })} data-eid={generateClickEID('social.connect.auth_prompt')} />
    </Box>
  )
})
